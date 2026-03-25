import { Node, type SourceFile } from "ts-morph";
import { EngineError } from "../domain/errors.js";

/**
 * A resolved, named export in a ts-morph SourceFile.
 *
 * Encapsulates symbol lookup, declaration-text extraction, direct-export
 * detection, and AST removal. Use the static factory `fromExport()` to
 * construct instances.
 */
export class SymbolRef {
  /** Absolute path of the file containing this symbol. */
  readonly filePath: string;

  /** The exported name. */
  readonly name: string;

  /** Full text of the top-level statement (includes `export` keyword). */
  readonly declarationText: string;

  private readonly _removeFn: () => void;
  private readonly _isDirectExport: boolean;
  private _removed = false;

  private constructor(
    filePath: string,
    name: string,
    declarationText: string,
    removeFn: () => void,
    isDirectExport: boolean,
  ) {
    this.filePath = filePath;
    this.name = name;
    this.declarationText = declarationText;
    this._removeFn = removeFn;
    this._isDirectExport = isDirectExport;
  }

  /**
   * Resolve an exported symbol by name from a ts-morph SourceFile.
   *
   * Takes the first declaration when multiple exist. Throws `EngineError`
   * with code `SYMBOL_NOT_FOUND` if the name is not found among the file's
   * exported declarations.
   */
  static fromExport(sourceFile: SourceFile, symbolName: string): SymbolRef {
    const exportedDecls = sourceFile.getExportedDeclarations().get(symbolName);
    if (!exportedDecls) {
      throw new EngineError(
        `Symbol '${symbolName}' not found as an export in ${sourceFile.getFilePath()}`,
        "SYMBOL_NOT_FOUND",
      );
    }

    const rawDecl = exportedDecls[0] as Node;
    // VariableDeclaration is nested inside VariableDeclarationList → VariableStatement.
    // Navigate up two levels to get the removable top-level statement that carries
    // the full text including the `export const` prefix.
    const stmt = Node.isVariableDeclaration(rawDecl)
      ? (rawDecl.getParent().getParent() as Node & { remove(): void })
      : (rawDecl as Node & { remove(): void });

    const declarationText = stmt.getText();
    const removeFn = () => stmt.remove();

    // A direct export lives in the same file as the queried source file.
    // A re-export (export { X } from "./y") resolves the declaration to the
    // original source module — so the declaration's file differs from the
    // queried file.
    const isDirectExport = rawDecl.getSourceFile().getFilePath() === sourceFile.getFilePath();

    return new SymbolRef(
      sourceFile.getFilePath() as string,
      symbolName,
      declarationText,
      removeFn,
      isDirectExport,
    );
  }

  /**
   * Whether this is a direct export (not a re-export via `export { } from`).
   *
   * Returns false when the symbol is re-exported from another module, e.g.
   * `export { Baz } from "./other"`. Returns true when the declaration lives
   * in the same file as the queried source file.
   */
  isDirectExport(): boolean {
    return this._isDirectExport;
  }

  /**
   * Remove this symbol's declaration from the source AST. Idempotent — a
   * second call is a no-op and does not throw.
   */
  remove(): void {
    if (this._removed) return;
    this._removed = true;
    this._removeFn();
  }
}
