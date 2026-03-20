import type { WorkspaceScope } from "../domain/workspace-scope.js";

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

  /**
   * Return rename locations or `null` if no renameable symbol exists at
   * `offset`. Throws `EngineError("RENAME_NOT_ALLOWED")` if the symbol exists
   * but cannot be renamed.
   */
  getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null>;

  /** Return reference locations or `null` if no symbol at `offset`. */
  getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null>;

  /** Return definition locations or `null` if no symbol at `offset`. */
  getDefinitionAtPosition(file: string, offset: number): Promise<DefinitionLocation[] | null>;

  /** Return text edits to apply when `oldPath` is moved to `newPath`. */
  getEditsForFileRename(oldPath: string, newPath: string): Promise<FileTextEdit[]>;

  /**
   * Read file content — may consult an internal cache.
   * Called by the shared engine layer before and after writes.
   */
  readFile(path: string): string;

  /** Called by the engine layer after writing `path`; compilers update caches. */
  notifyFileWritten(path: string, content: string): void;

  /**
   * Called after the physical file rename on disk.
   * Compiler invalidates its cache, runs any post-move scans, and records
   * any additional files touched directly into `scope`.
   *
   * Files already in `scope.modified` are skipped to avoid double-rewriting.
   */
  afterFileRename(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<void>;

  /**
   * Called after a named export has been moved from `sourceFile` to `destFile`.
   * Compilers scan for imports of the specific symbol and rewrite them.
   * `TsMorphEngine` walks workspace TS files to catch out-of-project importers.
   * `VolarCompiler` scans `.vue` SFC script blocks.
   *
   * Files already in `scope.modified` are skipped to avoid double-rewriting.
   * Modified and skipped files are recorded directly into `scope`.
   */
  afterSymbolMove(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
  ): Promise<void>;

  /**
   * Move all source files in `oldPath` to `newPath`, rewriting imports across
   * the project atomically. Only handles source files the compiler understands.
   * Non-source files (json, css, images) are the caller's responsibility.
   * Records all modified files into `scope`.
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
}

export interface LanguagePlugin {
  /** Stable identifier, e.g. `"vue-volar"`. Unique among registered plugins. */
  id: string;
  /** Project-level detection. Receives the resolved tsconfig path. */
  supportsProject(tsconfigPath: string): boolean;
  /** Lazy factory — called once per plugin lifetime, result cached by the registry. */
  createCompiler(): Promise<Engine>;
  /** Selective cache refresh (watcher `change` events). */
  invalidateFile?(filePath: string): void;
  /** Full cache drop (watcher `add`/`unlink` events). */
  invalidateAll?(): void;
}

export interface DeleteFileActionResult {
  importRefsRemoved: number;
}

export interface EngineRegistry {
  projectCompiler(): Promise<Engine>;
  tsCompiler(): Promise<import("./engine.js").TsMorphEngine>;
}
