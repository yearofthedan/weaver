export interface RenameResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  symbolName: string;
  newName: string;
  locationCount: number;
}

export interface MoveResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  oldPath: string;
  newPath: string;
}

export interface MoveSymbolResult {
  filesModified: string[];
  /** Impacted files outside workspace that were not written. */
  filesSkipped: string[];
  symbolName: string;
  sourceFile: string;
  destFile: string;
}

export interface Reference {
  file: string;
  line: number;
  col: number;
  length: number;
}

export interface FindReferencesResult {
  symbolName: string;
  references: Reference[];
}

export interface Definition {
  file: string;
  line: number;
  col: number;
  length: number;
}

export interface GetDefinitionResult {
  symbolName: string;
  definitions: Definition[];
}

// ─── Provider-level types ──────────────────────────────────────────────────

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

/**
 * Compiler-facing abstraction implemented by TsProvider (ts-morph) and
 * VolarProvider (@volar/typescript). Methods return normalised, real-path
 * locations — virtual `.vue.ts` paths are never exposed to callers.
 *
 * All methods that invoke the compiler are async because VolarProvider
 * requires an async initialisation step the first time a project is loaded.
 */
export interface LanguageProvider {
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

  /** Called by the engine layer after writing `path`; providers update caches. */
  notifyFileWritten(path: string, content: string): void;

  /**
   * Called after the physical file rename on disk.
   * Provider invalidates its cache, runs any post-move scans, and returns
   * `{ modified, skipped }` listing any additional files touched.
   */
  afterFileRename(
    oldPath: string,
    newPath: string,
    workspace: string,
  ): Promise<{ modified: string[]; skipped: string[] }>;

  /**
   * Called after a named export has been moved from `sourceFile` to `destFile`.
   * Providers may scan for imports of the specific symbol and rewrite them.
   * `TsProvider` is a no-op (ts-morph AST edits handle TS importers directly).
   * `VolarProvider` will scan `.vue` files in Phase 3.
   */
  afterSymbolMove(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    workspace: string,
  ): Promise<{ modified: string[]; skipped: string[] }>;
}

// ─── Engine-level types ────────────────────────────────────────────────────

export interface RefactorEngine {
  /**
   * Rename the symbol at (line, col) in filePath to newName.
   * line and col are 1-based.
   * workspace is the absolute workspace root; impacted files outside it are skipped.
   */
  rename(
    filePath: string,
    line: number,
    col: number,
    newName: string,
    workspace: string,
  ): Promise<RenameResult>;

  /**
   * Move a file from oldPath to newPath, updating all import references.
   * workspace is the absolute workspace root; impacted files outside it are skipped.
   */
  moveFile(oldPath: string, newPath: string, workspace: string): Promise<MoveResult>;

  /**
   * Move a named export from sourceFile to destFile, updating all import references.
   * destFile is created if it does not exist.
   * workspace is the absolute workspace root; impacted files outside it are skipped.
   */
  moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    workspace: string,
  ): Promise<MoveSymbolResult>;

  /**
   * Find all references to the symbol at (line, col) in filePath.
   * line and col are 1-based. Read-only — does not modify any files.
   */
  findReferences(filePath: string, line: number, col: number): Promise<FindReferencesResult>;

  /**
   * Return the definition location(s) for the symbol at (line, col) in filePath.
   * line and col are 1-based. Read-only — does not modify any files.
   */
  getDefinition(filePath: string, line: number, col: number): Promise<GetDefinitionResult>;
}

// ─── Registry ──────────────────────────────────────────────────────────────

/**
 * Lazy accessor for compiler providers scoped to a single workspace request.
 *
 * `projectProvider` returns the right provider for the project type — Volar for
 * Vue projects, TsProvider otherwise. `tsProvider` always returns TsProvider for
 * operations that need ts-morph AST access (e.g. moveSymbol).
 *
 * Both providers are lazy singletons: first call initialises, subsequent calls
 * return the cached instance.
 */
export interface ProviderRegistry {
  projectProvider(): Promise<LanguageProvider>;
  tsProvider(): Promise<import("./providers/ts.js").TsProvider>;
}
