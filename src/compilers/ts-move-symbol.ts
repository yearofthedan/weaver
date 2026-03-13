import * as path from "node:path";
import type { SourceFile } from "ts-morph";
import { ImportRewriter } from "../domain/import-rewriter.js";
import { SymbolRef } from "../domain/symbol-ref.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { EngineError } from "../utils/errors.js";
import type { TsMorphCompiler } from "./ts.js";

/**
 * Perform all compiler work for a named-symbol move: symbol lookup, destination
 * preparation, importer rewriting, AST surgery, dirty-file tracking, and saving.
 *
 * Called by `TsMorphCompiler.moveSymbol`; not intended for direct use by operations.
 */
export async function tsMoveSymbol(
  tsCompiler: TsMorphCompiler,
  absSource: string,
  symbolName: string,
  absDest: string,
  scope: WorkspaceScope,
  options?: { force?: boolean },
): Promise<void> {
  const force = options?.force === true;
  const project = tsCompiler.getProjectForFile(absSource);

  let srcSF = project.getSourceFile(absSource);
  if (!srcSF) {
    srcSF = project.addSourceFileAtPath(absSource);
  }

  const sourceRef = SymbolRef.fromExport(srcSF, symbolName);

  if (!sourceRef.declarationText.trimStart().startsWith("export")) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${absSource} is not a direct export. Re-exports via 'export { }' are not supported.`,
      "NOT_SUPPORTED",
    );
  }

  // Prepare the destination directory and source file before any mutations.
  const destDir = path.dirname(absDest);
  if (!scope.fs.exists(destDir)) {
    scope.fs.mkdir(destDir, { recursive: true });
  }

  let dstSF: SourceFile;
  if (scope.fs.exists(absDest)) {
    dstSF = project.getSourceFile(absDest) ?? project.addSourceFileAtPath(absDest);
  } else {
    dstSF = project.createSourceFile(absDest, "");
  }

  let destRef: SymbolRef | null = null;
  try {
    destRef = SymbolRef.fromExport(dstSF, symbolName);
  } catch (err) {
    if (!(err instanceof EngineError) || err.code !== "SYMBOL_NOT_FOUND") {
      throw err;
    }
  }

  const symbolExistsInDest = destRef !== null;
  if (symbolExistsInDest && !force) {
    throw new EngineError(
      `Symbol '${symbolName}' already exists as an export in ${absDest}. Pass force: true to replace the existing declaration with the source version.`,
      "SYMBOL_EXISTS",
    );
  }

  // Collect importer file paths before any mutations so the AST references remain valid.
  // ImportRewriter will re-read these from disk after source and dest are saved.
  const importerPaths = project
    .getSourceFiles()
    .map((sf) => sf.getFilePath() as string)
    .filter((fp) => fp !== absSource && fp !== absDest);

  // Remove declaration from source file.
  sourceRef.remove();

  // When force is true and the symbol already exists in dest, remove it first
  // so the source version replaces it (source wins).
  if (force && symbolExistsInDest && destRef) {
    destRef.remove();
  }

  // Append the declaration to the destination file.
  const existingText = dstSF.getText();
  const separator = existingText.trimEnd().length === 0 ? "" : "\n\n";
  dstSF.replaceWithText(`${existingText.trimEnd()}${separator}${sourceRef.declarationText}\n`);

  // Save source and dest files so importers can be rewritten from disk.
  for (const sf of [srcSF, dstSF]) {
    const fp = sf.getFilePath() as string;
    if (scope.contains(fp)) {
      await sf.save();
      scope.recordModified(fp);
    } else {
      scope.recordSkipped(fp);
    }
  }

  // Rewrite import declarations in all in-project importers using ImportRewriter.
  // ImportRewriter reads from disk (files already saved above) and writes back via scope.
  new ImportRewriter().rewrite(importerPaths, symbolName, absSource, absDest, scope);

  tsCompiler.invalidateProject(absSource);
}
