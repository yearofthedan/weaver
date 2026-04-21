import { Node, type SourceFile } from "ts-morph";

/**
 * Find a non-exported declaration with the given name in `dstSF`, or null if none exists.
 */
export function findNonExportedDeclaration(
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
