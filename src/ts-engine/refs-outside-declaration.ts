import { Node, type SourceFile, SyntaxKind } from "ts-morph";

/**
 * Returns true if any identifier in `srcSF` outside of `declStmt`'s own subtree
 * resolves to the declaration at `declStmt`.
 */
export function hasRefsOutsideDeclaration(srcSF: SourceFile, declStmt: Node): boolean {
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
