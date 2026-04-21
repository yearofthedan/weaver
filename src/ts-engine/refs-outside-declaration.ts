import { Node, type SourceFile, SyntaxKind } from "ts-morph";

/**
 * Returns true if any identifier in `srcSF` outside of `declStmt`'s own subtree
 * resolves to the declaration at `declStmt`.
 */
export function hasRefsOutsideDeclaration(srcSF: SourceFile, declStmt: Node): boolean {
  const innerIdentifiers = new Set(declStmt.getDescendantsOfKind(SyntaxKind.Identifier));
  for (const identifier of srcSF.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (innerIdentifiers.has(identifier)) continue;
    const [resolvedDecl] = identifier.getSymbol()?.getDeclarations() ?? [];
    if (!resolvedDecl) continue;
    const resolvedStmt = Node.isVariableDeclaration(resolvedDecl)
      ? resolvedDecl.getVariableStatement()
      : resolvedDecl;
    if (resolvedStmt === declStmt) return true;
  }
  return false;
}
