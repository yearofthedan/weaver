import { Node, type SourceFile } from "ts-morph";
import { EngineError } from "../utils/errors.js";

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

  private constructor(
    filePath: string,
    name: string,
    declarationText: string,
    removeFn: () => void,
  ) {
    this.filePath = filePath;
    this.name = name;
    this.declarationText = declarationText;
    this._removeFn = removeFn;
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

    return new SymbolRef(sourceFile.getFilePath() as string, symbolName, declarationText, removeFn);
  }

  /**
   * Whether this is a direct export (not a re-export via `export { } from`).
   *
   * Stub implementation — full behaviour delivered in a later slice.
   */
  isDirectExport(): boolean {
    return this.declarationText.startsWith("export");
  }

  /**
   * Remove this symbol's declaration from the source AST. Idempotent — a
   * second call is a no-op and does not throw.
   */
  remove(): void {
    this._removeFn();
  }
}
