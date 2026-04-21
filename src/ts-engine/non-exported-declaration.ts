import {
  type ClassDeclaration,
  type FunctionDeclaration,
  type InterfaceDeclaration,
  Node,
  type SourceFile,
  type TypeAliasDeclaration,
  type VariableStatement,
} from "ts-morph";

type RemovableDeclaration =
  | FunctionDeclaration
  | ClassDeclaration
  | InterfaceDeclaration
  | TypeAliasDeclaration
  | VariableStatement;

/**
 * Find a non-exported declaration with the given name in `dstSF`, or null if none exists.
 */
export function findNonExportedDeclaration(
  dstSF: SourceFile,
  symbolName: string,
): RemovableDeclaration | null {
  const fn = dstSF.getFunction(symbolName);
  if (fn && !fn.isExported()) return fn;
  const cls = dstSF.getClass(symbolName);
  if (cls && !cls.isExported()) return cls;
  const iface = dstSF.getInterface(symbolName);
  if (iface && !iface.isExported()) return iface;
  const typeAlias = dstSF.getTypeAlias(symbolName);
  if (typeAlias && !typeAlias.isExported()) return typeAlias;
  const varDecl = dstSF.getVariableDeclaration(symbolName);
  if (varDecl) {
    const stmt = varDecl.getParent().getParent();
    if (Node.isVariableStatement(stmt)) {
      return stmt.isExported() ? null : stmt;
    }
  }
  return null;
}
