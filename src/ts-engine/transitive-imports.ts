import { type Node, type SourceFile, SyntaxKind } from "ts-morph";

/**
 * Walk the identifiers in `declStmt` and return named imports from `srcSF` that
 * the declaration depends on. Skips locally-defined identifiers and TypeScript
 * built-in lib files. Preserves import aliases.
 */
export function collectTransitiveImports(
  srcSF: SourceFile,
  declStmt: Node,
): Array<{ namedImports: Array<{ name: string; alias?: string }>; resolvedAbsPath: string }> {
  const srcFilePath = srcSF.getFilePath();
  const result = new Map<
    string,
    { namedImports: Array<{ name: string; alias?: string }>; resolvedAbsPath: string }
  >();

  // Pre-build a map from local name → import metadata so the identifier loop
  // is O(identifiers) rather than O(identifiers × imports).
  type ImportMeta = { originalName: string; aliasText: string | undefined; importedPath: string };
  const localNameToImport = new Map<string, ImportMeta>();
  for (const importDecl of srcSF.getImportDeclarations()) {
    const importedSF = importDecl.getModuleSpecifierSourceFile();
    if (!importedSF) continue;
    const importedPath = importedSF.getFilePath() as string;
    for (const ni of importDecl.getNamedImports()) {
      const localName = ni.getAliasNode()?.getText() ?? ni.getName();
      localNameToImport.set(localName, {
        originalName: ni.getName(),
        aliasText: ni.getAliasNode()?.getText(),
        importedPath,
      });
    }
  }

  for (const identifier of declStmt.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const sym = identifier.getSymbol();
    if (!sym) continue;
    // getAliasedSymbol() is required: for type imports, getSymbol() resolves to
    // the ImportSpecifier in this file, not the declaration in the imported file.
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

    const importMeta = localNameToImport.get(identifier.getText());
    if (!importMeta || importMeta.importedPath !== resolvedPath) continue;

    const { originalName, aliasText, importedPath } = importMeta;
    const namedImportEntry =
      aliasText && aliasText !== originalName
        ? { name: originalName, alias: aliasText }
        : { name: originalName };

    if (!result.has(importedPath)) {
      result.set(importedPath, { namedImports: [namedImportEntry], resolvedAbsPath: importedPath });
    } else {
      const existing = result.get(importedPath);
      if (existing && !existing.namedImports.some((ni) => ni.name === namedImportEntry.name)) {
        existing.namedImports.push(namedImportEntry);
      }
    }
  }

  return Array.from(result.values());
}
