import * as path from "node:path";
import { Node, type SourceFile } from "ts-morph";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { computeRelativeImportPath } from "../utils/relative-path.js";
import type { TsMorphEngine } from "./engine.js";
import { ImportRewriter } from "./import-rewriter.js";
import { findNonExportedDeclaration } from "./non-exported-declaration.js";
import { hasRefsOutsideDeclaration } from "./refs-outside-declaration.js";
import { SymbolRef } from "./symbol-ref.js";
import { collectTransitiveImports } from "./transitive-imports.js";

/**
 * Perform all compiler work for a named-symbol move: symbol lookup, destination
 * preparation, importer rewriting, AST surgery, dirty-file tracking, and saving.
 *
 * Called by `TsMorphEngine.moveSymbol`; not intended for direct use by operations.
 */
export async function tsMoveSymbol(
  tsCompiler: TsMorphEngine,
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

  if (!symbolExistsInDest) {
    const nonExportedConflict = findNonExportedDeclaration(dstSF, symbolName);
    if (nonExportedConflict !== null) {
      if (!force) {
        throw new EngineError(
          `Symbol '${symbolName}' already exists as a non-exported declaration in ${absDest}. Pass force: true to replace it.`,
          "SYMBOL_EXISTS",
        );
      }
      nonExportedConflict.remove();
    }
  }

  // Collect importer paths before any mutations so AST references remain valid.
  const importerPaths = project
    .getSourceFiles()
    .map((sf) => sf.getFilePath() as string)
    .filter((fp) => fp !== absSource && fp !== absDest);

  // Resolve AST node before removal — needed for identifier walks below.
  const declStmt = resolveDeclarationStatement(srcSF, symbolName);

  const sourceHasRemainingRefs = declStmt !== null && hasRefsOutsideDeclaration(srcSF, declStmt);
  const transitiveImports = declStmt !== null ? collectTransitiveImports(srcSF, declStmt) : [];

  sourceRef.remove();

  if (force && symbolExistsInDest && destRef) {
    destRef.remove();
  }

  const rewriter = new ImportRewriter();
  const newImportLines = transitiveImports
    .filter(
      (imp) =>
        !dstSF
          .getImportDeclarations()
          .some((id) =>
            rewriter.matchesDestSpecifier(
              id.getModuleSpecifierValue(),
              absDest,
              imp.resolvedAbsPath,
            ),
          ),
    )
    .map((imp) => {
      const specifier = computeRelativeImportPath(absDest, imp.resolvedAbsPath);
      const names = imp.namedImports
        .map((n) => (n.alias ? `${n.name} as ${n.alias}` : n.name))
        .join(", ");
      return `import { ${names} } from "${specifier}";`;
    });

  const existingText = dstSF.getText().trimEnd();
  const parts: string[] = [...newImportLines];
  if (existingText.length > 0) parts.push(existingText);
  parts.push(sourceRef.declarationText);
  dstSF.replaceWithText(`${parts.join("\n\n")}\n`);

  for (const sf of [srcSF, dstSF]) {
    const fp = sf.getFilePath() as string;
    if (scope.contains(fp)) {
      await sf.save();
      scope.recordModified(fp);
    } else {
      scope.recordSkipped(fp);
    }
  }

  if (sourceHasRemainingRefs && scope.contains(absSource)) {
    const relPath = computeRelativeImportPath(absSource, absDest);
    const currentSrc = scope.fs.readFile(absSource);
    scope.writeFile(absSource, `import { ${symbolName} } from "${relPath}";\n${currentSrc}`);
  }

  // ImportRewriter reads from disk (files already saved above) and writes back via scope.
  new ImportRewriter().rewrite(importerPaths, symbolName, absSource, absDest, scope);

  tsCompiler.invalidateProject(absSource);
}

function resolveDeclarationStatement(srcSF: SourceFile, symbolName: string): Node | null {
  const rawDecl = srcSF.getExportedDeclarations().get(symbolName)?.[0];
  if (!rawDecl) return null;
  if (Node.isVariableDeclaration(rawDecl)) {
    return rawDecl.getVariableStatement() ?? null;
  }
  return rawDecl;
}
