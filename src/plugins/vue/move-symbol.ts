import * as path from "node:path";
import { parse } from "@vue/language-core";
import { EngineError } from "../../domain/errors.js";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { SymbolRef } from "../../ts-engine/symbol-ref.js";
import { createThrowawaySourceFile } from "../../ts-engine/throwaway-project.js";

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
  const sourceRef = SymbolRef.fromExport(scriptSF, symbolName);

  if (!sourceRef.declarationText.trimStart().startsWith("export")) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${sourceFile} is not a direct export. Re-exports via 'export { }' are not supported.`,
      "NOT_SUPPORTED",
    );
  }

  const declarationText = sourceRef.declarationText;

  sourceRef.remove();
  const newScript = scriptSF.getFullText();
  const newVueContent =
    vueContent.slice(0, loc.start.offset) + newScript + vueContent.slice(loc.end.offset);

  const newDestContent = composeTsDest(destFile, declarationText, scope);

  const destDir = path.dirname(destFile);
  if (!scope.fs.exists(destDir)) {
    scope.fs.mkdir(destDir, { recursive: true });
  }

  writeOrSkip(sourceFile, newVueContent, scope);
  writeOrSkip(destFile, newDestContent, scope);
}

function composeTsDest(destFile: string, declarationText: string, scope: WorkspaceScope): string {
  if (!scope.fs.exists(destFile)) {
    return `${declarationText}\n`;
  }
  const existing = scope.fs.readFile(destFile).trimEnd();
  if (existing.length === 0) return `${declarationText}\n`;
  return `${existing}\n\n${declarationText}\n`;
}

function writeOrSkip(filePath: string, content: string, scope: WorkspaceScope): void {
  if (scope.contains(filePath)) {
    scope.writeFile(filePath, content);
  } else {
    scope.recordSkipped(filePath);
  }
}
