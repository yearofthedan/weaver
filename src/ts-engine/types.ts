import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { RenameResult } from "../operations/types.js";

export interface ExtractFunctionResult {
  filesModified: string[];
  /** Always empty — extractFunction is a single-file operation. */
  filesSkipped: string[];
  functionName: string;
  /** Number of parameters on the extracted function. */
  parameterCount: number;
}

export interface SpanLocation {
  fileName: string;
  textSpan: { start: number; length: number };
}

export interface DefinitionLocation extends SpanLocation {
  /** Symbol name returned by the compiler. */
  name: string;
}

export interface FileTextEdit {
  fileName: string;
  textChanges: { span: { start: number; length: number }; newText: string }[];
}

export interface Engine {
  /** Convert 1-based line/col to a 0-based byte offset. Synchronous — no I/O. */
  resolveOffset(file: string, line: number, col: number): number;

  /** Return reference locations or `null` if no symbol at `offset`. */
  getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null>;

  /** Return definition locations or `null` if no symbol at `offset`. */
  getDefinitionAtPosition(file: string, offset: number): Promise<DefinitionLocation[] | null>;

  /**
   * Read file content — may consult an internal cache.
   * Called by the shared engine layer before and after writes.
   */
  readFile(path: string): string;

  /**
   * Full rename workflow: resolve the symbol at `file`:`line`:`col`, collect all
   * rename locations from the language service, apply text edits within the
   * workspace boundary, and return the result.
   *
   * Throws `SYMBOL_NOT_FOUND` when no renameable symbol exists at the position.
   * Throws `RENAME_NOT_ALLOWED` when the symbol exists but cannot be renamed.
   *
   * Precondition: `file` must exist (validated by the operation layer).
   */
  rename(
    file: string,
    line: number,
    col: number,
    newName: string,
    scope: WorkspaceScope,
  ): Promise<RenameResult>;

  /**
   * Full moveFile workflow: compute import edits, apply them, physically move
   * the file, run post-rename scans (own imports + importers), and record the
   * new path as modified.
   *
   * Precondition: `oldPath` must exist.
   */
  moveFile(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<MoveFileActionResult>;

  /**
   * Full moveSymbol workflow: performs AST surgery on in-project files via the
   * TypeScript language service, then scans all workspace files for any import
   * of `symbolName` from `sourceFile` that the language service missed
   * (e.g. files outside `tsconfig.include`, Vue SFC script blocks).
   *
   * `sourceFile` must be an absolute path that exists. `destFile` is created
   * if it doesn't exist. All side effects are recorded into `scope`.
   * Throws `SYMBOL_NOT_FOUND` if the symbol is absent, `SYMBOL_EXISTS` if the
   * symbol already exists in `destFile` (unless `options.force` is `true`).
   */
  moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
    options?: { force?: boolean },
  ): Promise<void>;

  /**
   * Full moveDirectory workflow: rewrite imports for all source files atomically,
   * physically move the entire directory tree (source and non-source), and record
   * all moved files into scope.
   *
   * Precondition: `oldPath` must exist and be a valid directory. Validation is
   * the caller's responsibility.
   */
  moveDirectory(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<{ filesMoved: string[] }>;

  /**
   * Full delete workflow: remove all import references to `targetFile` from
   * TS/JS and Vue SFC files within the workspace, physically delete the file,
   * and invalidate the project cache.
   *
   * `targetFile` must be an absolute path that has already been validated by
   * the operation layer (exists, not sensitive). `scope` controls workspace
   * boundary enforcement and file write tracking.
   */
  deleteFile(targetFile: string, scope: WorkspaceScope): Promise<DeleteFileActionResult>;

  /**
   * Full extractFunction workflow: compute extraction edits via the TypeScript
   * language service, substitute the caller-provided name for the compiler's
   * generated name, write the result, and return the function metadata.
   *
   * `.vue` paths throw `NOT_SUPPORTED`. Precondition: `file` must exist
   * (validated by the operation layer).
   */
  extractFunction(
    file: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    functionName: string,
    scope: WorkspaceScope,
  ): Promise<ExtractFunctionResult>;
}

export interface LanguagePlugin {
  /** Stable identifier, e.g. `"vue-volar"`. Unique among registered plugins. */
  id: string;
  /** Project-level detection. Receives the resolved tsconfig path. */
  supportsProject(tsconfigPath: string): boolean;
  /**
   * Lazy factory — called once per plugin lifetime, result cached by the registry.
   * Receives the TsMorphEngine so the plugin can delegate TS operations to it.
   */
  createEngine(tsEngine: import("./engine.js").TsMorphEngine): Promise<Engine>;
  /** Selective cache refresh (watcher `change` events). */
  invalidateFile?(filePath: string): void;
  /** Full cache drop (watcher `add`/`unlink` events). */
  invalidateAll?(): void;
}

export interface DeleteFileActionResult {
  importRefsRemoved: number;
}

export interface MoveFileActionResult {
  oldPath: string;
  newPath: string;
}

export interface EngineRegistry {
  /** Returns the project engine — Vue plugin if detected, TsMorphEngine otherwise. */
  projectEngine(): Promise<Engine>;
  /** Always returns TsMorphEngine for AST-level operations (e.g. moveSymbol, extractFunction). */
  tsEngine(): Promise<import("./engine.js").TsMorphEngine>;
}
