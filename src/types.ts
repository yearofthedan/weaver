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

export interface ExtractFunctionResult {
  filesModified: string[];
  /** Always empty — extractFunction is a single-file operation. */
  filesSkipped: string[];
  functionName: string;
  /** Number of parameters on the extracted function. */
  parameterCount: number;
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

export interface ContextLine {
  line: number;
  text: string;
  isMatch: boolean;
}

export interface SearchMatch {
  file: string;
  line: number;
  col: number;
  matchText: string;
  context: ContextLine[];
}

export interface SearchTextResult {
  matches: SearchMatch[];
  /** True if the result set was capped at the internal limit. */
  truncated: boolean;
}

export interface TextEdit {
  file: string;
  line: number;
  col: number;
  oldText: string;
  newText: string;
}

export interface ReplaceTextResult {
  filesModified: string[];
  replacementCount: number;
}

export interface DeleteFileResult {
  deletedFile: string;
  filesModified: string[];
  /** Importers outside the workspace boundary — found but not written. */
  filesSkipped: string[];
  /** Total import/export declarations removed across all modified files. */
  importRefsRemoved: number;
}

export interface TypeDiagnostic {
  file: string;
  line: number;
  col: number;
  code: number;
  message: string;
}

export interface GetTypeErrorsResult {
  diagnostics: TypeDiagnostic[];
  /** Total number of errors found (may exceed diagnostics.length when truncated). */
  errorCount: number;
  /** True when the result was capped at the internal limit. */
  truncated: boolean;
}

/**
 * Optional post-write diagnostic fields added to write operation results when
 * `checkTypeErrors: true` is passed. All three fields are absent when the param
 * is omitted or false.
 */
export interface PostWriteDiagnostics {
  typeErrors: TypeDiagnostic[];
  /** True total error count across modified files (may exceed typeErrors.length). */
  typeErrorCount: number;
  /** True when results were capped at the internal limit. */
  typeErrorsTruncated: boolean;
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

// ─── Language Plugin ───────────────────────────────────────────────────────

/**
 * Contract for adding language/framework support. Each plugin provides
 * project-level detection and a `LanguageProvider` factory. The registry
 * iterates plugins in registration order; first match wins.
 *
 * Built-in plugins (e.g. Vue/Volar) are registered at module load time.
 * The TS provider is always available as the default fallback and is not
 * modelled as a plugin.
 */
export interface LanguagePlugin {
  /** Stable identifier, e.g. `"vue-volar"`. Unique among registered plugins. */
  id: string;
  /** Project-level detection. Receives the resolved tsconfig path. */
  supportsProject(tsconfigPath: string): boolean;
  /** Lazy factory — called once per plugin lifetime, result cached by the registry. */
  createProvider(): Promise<LanguageProvider>;
  /** Selective cache refresh (watcher `change` events). */
  invalidateFile?(filePath: string): void;
  /** Full cache drop (watcher `add`/`unlink` events). */
  invalidateAll?(): void;
}

// ─── Registry ──────────────────────────────────────────────────────────────

/**
 * Lazy accessor for compiler providers scoped to a single workspace request.
 *
 * `projectProvider` returns the right provider for the project type — iterates
 * registered language plugins, first match wins, TsProvider as fallback.
 * `tsProvider` always returns TsProvider for operations that need ts-morph
 * AST access (e.g. moveSymbol).
 *
 * Both providers are lazy singletons: first call initialises, subsequent calls
 * return the cached instance.
 */
export interface ProviderRegistry {
  projectProvider(): Promise<LanguageProvider>;
  tsProvider(): Promise<import("./providers/ts.js").TsProvider>;
}
