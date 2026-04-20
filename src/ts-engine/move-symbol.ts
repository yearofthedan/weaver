import * as path from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { computeRelativeImportPath } from "../utils/relative-path.js";
import type { TsMorphEngine } from "./engine.js";
import { ImportRewriter } from "./import-rewriter.js";
import { SymbolRef } from "./symbol-ref.js";

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
  dstSF.replaceWithText(parts.join("\n\n") + "\n");

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

/**
 * Returns the top-level statement node for the given exported symbol name,
 * or null if not found.
 */
function resolveDeclarationStatement(srcSF: SourceFile, symbolName: string): Node | null {
  const exportedDecls = srcSF.getExportedDeclarations().get(symbolName);
  if (!exportedDecls || exportedDecls.length === 0) return null;
  const rawDecl = exportedDecls[0] as Node;
  if (Node.isVariableDeclaration(rawDecl)) {
    return rawDecl.getParent().getParent() as Node;
  }
  return rawDecl as Node;
}

/**
 * Returns true if any identifier in `srcSF` outside of `declStmt`'s own subtree
 * resolves to the declaration at `declStmt`.
 */
function hasRefsOutsideDeclaration(srcSF: SourceFile, declStmt: Node): boolean {
  const declStart = declStmt.getStart();
  const declEnd = declStmt.getEnd();
  for (const identifier of srcSF.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const pos = identifier.getStart();
    if (pos >= declStart && pos < declEnd) continue;
    const decls = identifier.getSymbol()?.getDeclarations();
    if (!decls || decls.length === 0) continue;
    const resolvedDecl = decls[0];
    if (!resolvedDecl) continue;
    const resolvedStart = Node.isVariableDeclaration(resolvedDecl)
      ? resolvedDecl.getParent().getParent().getStart()
      : resolvedDecl.getStart();
    if (
      resolvedStart === declStart &&
      resolvedDecl.getSourceFile().getFilePath() === srcSF.getFilePath()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Walk the identifiers in `declStmt` and return named imports from `srcSF` that
 * the declaration depends on. Skips locally-defined identifiers and TypeScript
 * built-in lib files. Preserves import aliases.
 */
function collectTransitiveImports(
  srcSF: SourceFile,
  declStmt: Node,
): Array<{ namedImports: Array<{ name: string; alias?: string }>; resolvedAbsPath: string }> {
  const srcFilePath = srcSF.getFilePath();
  const result = new Map<
    string,
    { namedImports: Array<{ name: string; alias?: string }>; resolvedAbsPath: string }
  >();

  for (const identifier of declStmt.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const sym = identifier.getSymbol();
    if (!sym) continue;
    const resolvedSym = sym.getAliasedSymbol() ?? sym;
    const decls = resolvedSym.getDeclarations();
    if (!decls || decls.length === 0) continue;
    const resolvedDecl = decls[0];
    if (!resolvedDecl) continue;
    const resolvedPath = resolvedDecl.getSourceFile().getFilePath() as string;

    if (resolvedPath === srcFilePath) continue;
    if (
      resolvedPath.includes("/typescript/lib/") ||
      resolvedPath.includes("node_modules/typescript/lib")
    )
      continue;

    for (const importDecl of srcSF.getImportDeclarations()) {
      const namedImports = importDecl.getNamedImports();
      const matchingNamed = namedImports.find((ni) => {
        const localName = ni.getAliasNode()?.getText() ?? ni.getName();
        return localName === identifier.getText();
      });
      if (!matchingNamed) continue;

      const importedSF = importDecl.getModuleSpecifierSourceFile();
      if (!importedSF) continue;
      const importedPath = importedSF.getFilePath() as string;
      if (importedPath !== resolvedPath) continue;

      const originalName = matchingNamed.getName();
      const aliasNode = matchingNamed.getAliasNode();
      const aliasText = aliasNode?.getText();
      const namedImportEntry =
        aliasText && aliasText !== originalName
          ? { name: originalName, alias: aliasText }
          : { name: originalName };

      if (!result.has(importedPath)) {
        result.set(importedPath, {
          namedImports: [namedImportEntry],
          resolvedAbsPath: importedPath,
        });
      } else {
        const existing = result.get(importedPath)!;
        if (!existing.namedImports.some((ni) => ni.name === namedImportEntry.name)) {
          existing.namedImports.push(namedImportEntry);
        }
      }
      break;
    }
  }

  return Array.from(result.values());
}

/**
 * Find a non-exported declaration with the given name in `dstSF`, or null if none exists.
 */
function findNonExportedDeclaration(
  dstSF: SourceFile,
  symbolName: string,
): (Node & { remove(): void }) | null {
  const fn = dstSF.getFunction(symbolName);
  if (fn && !fn.isExported()) return fn as Node & { remove(): void };
  const cls = dstSF.getClass(symbolName);
  if (cls && !cls.isExported()) return cls as Node & { remove(): void };
  const iface = dstSF.getInterface(symbolName);
  if (iface && !iface.isExported()) return iface as Node & { remove(): void };
  const typeAlias = dstSF.getTypeAlias(symbolName);
  if (typeAlias && !typeAlias.isExported()) return typeAlias as Node & { remove(): void };
  const varDecl = dstSF.getVariableDeclaration(symbolName);
  if (varDecl) {
    const stmt = varDecl.getParent().getParent();
    if (Node.isVariableStatement(stmt) && !stmt.isExported()) {
      return stmt as Node & { remove(): void };
    }
  }
  return null;
}
