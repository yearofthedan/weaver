import * as path from "node:path";
import { parse } from "@vue/language-core";
import type { SourceFile } from "ts-morph";
import { EngineError } from "../../domain/errors.js";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { ImportRewriter } from "../../ts-engine/import-rewriter.js";
import { resolveDeclarationStatement } from "../../ts-engine/move-symbol.js";
import { hasRefsOutsideDeclaration } from "../../ts-engine/refs-outside-declaration.js";
import { SymbolRef } from "../../ts-engine/symbol-ref.js";
import { createThrowawaySourceFile } from "../../ts-engine/throwaway-project.js";
import { walkFiles } from "../../utils/file-walk.js";
import { computeRelativeImportPath } from "../../utils/relative-path.js";
import { findTsConfigForFile } from "../../utils/ts-project.js";
import { updateVueImportsAfterSymbolMove } from "./scan.js";

/**
 * Move a named export from a `.vue` SFC's `<script setup>` block to another
 * file (either `.ts` or `.vue`), preserving the rest of the source SFC.
 *
 * Transitive imports used by the moved symbol are not carried — type errors in
 * the destination identify what is missing.
 */
export async function vueMoveSymbol(
  sourceFile: string,
  symbolName: string,
  destFile: string,
  scope: WorkspaceScope,
  _options?: { force?: boolean },
): Promise<void> {
  const vueContent = scope.fs.readFile(sourceFile);
  const { descriptor } = parse(vueContent);

  if (!descriptor.scriptSetup) {
    throw new EngineError(
      `<script setup> block is required to move a symbol from ${sourceFile}`,
      "NOT_SUPPORTED",
    );
  }

  const { loc, content: scriptContent } = descriptor.scriptSetup;

  const scriptSF = createThrowawaySourceFile("__script__.ts", scriptContent);

  if (isReExport(scriptSF, symbolName)) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${sourceFile} is a re-export via 'export { } from'. Re-exports are not supported.`,
      "NOT_SUPPORTED",
    );
  }

  const sourceRef = SymbolRef.fromExport(scriptSF, symbolName);

  if (!sourceRef.declarationText.trimStart().startsWith("export")) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${sourceFile} is not a direct export.`,
      "NOT_SUPPORTED",
    );
  }

  const declarationText = sourceRef.declarationText;

  const declStmt = resolveDeclarationStatement(scriptSF, symbolName);
  const needsSelfImport = declStmt !== null && hasRefsOutsideDeclaration(scriptSF, declStmt);

  sourceRef.remove();
  let newScript = scriptSF.getFullText();
  if (needsSelfImport) {
    const specifier = computeRelativeImportPath(sourceFile, destFile);
    newScript = `\nimport { ${symbolName} } from "${specifier}";${newScript}`;
  }
  const newVueContent =
    vueContent.slice(0, loc.start.offset) + newScript + vueContent.slice(loc.end.offset);

  const newDestContent = destFile.endsWith(".vue")
    ? composeVueDest(destFile, declarationText, scope)
    : composeTsDest(destFile, declarationText, scope);

  scope.fs.mkdir(path.dirname(destFile), { recursive: true });

  writeOrSkip(sourceFile, newVueContent, scope);
  writeOrSkip(destFile, newDestContent, scope);

  rewriteImporters(sourceFile, destFile, symbolName, scope);
}

function rewriteImporters(
  sourceFile: string,
  destFile: string,
  symbolName: string,
  scope: WorkspaceScope,
): void {
  const tsConfig = findTsConfigForFile(sourceFile);
  const searchRoot = tsConfig ? path.dirname(tsConfig) : scope.root;

  updateVueImportsAfterSymbolMove(symbolName, sourceFile, destFile, searchRoot, scope);

  const rewriter = new ImportRewriter();
  const alreadyModified = new Set(scope.modified);
  for (const file of walkFiles(searchRoot, [".ts", ".tsx"])) {
    if (alreadyModified.has(file)) continue;
    const content = scope.fs.readFile(file);
    const rewritten = rewriter.rewriteScript(
      file,
      content,
      symbolName,
      sourceFile,
      destFile,
      scope,
    );
    if (rewritten !== null) {
      scope.writeFile(file, rewritten);
    }
  }
}

function composeTsDest(destFile: string, declarationText: string, scope: WorkspaceScope): string {
  if (!scope.fs.exists(destFile)) {
    return `${declarationText}\n`;
  }
  const existing = scope.fs.readFile(destFile).trimEnd();
  if (existing.length === 0) return `${declarationText}\n`;
  return `${existing}\n\n${declarationText}\n`;
}

function composeVueDest(destFile: string, declarationText: string, scope: WorkspaceScope): string {
  const newBlock = `<script setup lang="ts">\n${declarationText}\n</script>\n`;

  if (!scope.fs.exists(destFile)) {
    return newBlock;
  }

  const existing = scope.fs.readFile(destFile);
  const { descriptor } = parse(existing);

  if (descriptor.scriptSetup) {
    const { loc, content: scriptContent } = descriptor.scriptSetup;
    const newScriptContent = `${scriptContent.replace(/\s*$/, "")}\n\n${declarationText}\n`;
    return existing.slice(0, loc.start.offset) + newScriptContent + existing.slice(loc.end.offset);
  }

  if (descriptor.template) {
    const templateStart = descriptor.template.loc.start.offset;
    // Walk back to the opening `<template` to capture any preceding whitespace.
    const openIdx = existing.lastIndexOf("<template", templateStart);
    const insertAt = openIdx >= 0 ? openIdx : templateStart;
    return `${existing.slice(0, insertAt)}${newBlock}\n${existing.slice(insertAt)}`;
  }

  const trimmedExisting = existing.replace(/\s*$/, "");
  return trimmedExisting.length > 0 ? `${trimmedExisting}\n\n${newBlock}` : newBlock;
}

function isReExport(scriptSF: SourceFile, symbolName: string): boolean {
  for (const decl of scriptSF.getExportDeclarations()) {
    if (!decl.getModuleSpecifierValue()) continue;
    for (const spec of decl.getNamedExports()) {
      const exportedAs = spec.getAliasNode()?.getText() ?? spec.getName();
      if (exportedAs === symbolName) return true;
    }
  }
  return false;
}

function writeOrSkip(filePath: string, content: string, scope: WorkspaceScope): void {
  if (scope.contains(filePath)) {
    scope.writeFile(filePath, content);
  } else {
    scope.recordSkipped(filePath);
  }
}
