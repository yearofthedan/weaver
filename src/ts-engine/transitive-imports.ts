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
        const existing = result.get(importedPath);
        if (existing && !existing.namedImports.some((ni) => ni.name === namedImportEntry.name)) {
          existing.namedImports.push(namedImportEntry);
        }
      }
      break;
    }
  }

  return Array.from(result.values());
}
