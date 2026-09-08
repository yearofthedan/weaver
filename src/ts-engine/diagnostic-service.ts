import * as path from "node:path";
import ts from "typescript";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { tsConfigCacheKey } from "../utils/ts-project.js";

/**
 * The diagnostic half of a `ts.LanguageService`, plus the two mutations the
 * engine performs on it. `getSemanticDiagnostics` and `getProgram` match the
 * real API's shape so `get-type-errors.ts` can narrow to a `Pick` of it, but
 * `getProgram` here is never `undefined` — this service has no syntax-only
 * mode to fall back to.
 */
export interface DiagnosticService {
  getSemanticDiagnostics(fileName: string): ts.Diagnostic[];
  getProgram(): ts.Program;
  /** Adds a root the tsconfig does not cover. A no-op if it is already a root. */
  addScriptFile(fileName: string): void;
}

/**
 * A compiler host that caches each `ts.SourceFile` it parses into `parsed`.
 * The map is the caller's, not this closure's, so a host built for a rebuild
 * inherits the parses of the one before it and re-parses only what the caller
 * evicted — without that, every rebuild would re-parse every root to add or
 * refresh one file.
 */
function buildCompilerHost(
  tsConfigPath: string | null,
  fs: FileSystem,
  parsed: Map<string, ts.SourceFile>,
): ts.CompilerHost {
  // An unreadable file is reported as absent, which is what a compiler host
  // expects; the error itself carries nothing a caller could act on.
  const readFile = (fileName: string): string | undefined => {
    try {
      return fs.readFile(fileName);
    } catch {
      return undefined;
    }
  };

  return {
    getSourceFile: (fileName, languageVersionOrOptions) => {
      const cached = parsed.get(fileName);
      if (cached) return cached;
      const content = readFile(fileName);
      if (content === undefined) return undefined;
      // `setParentNodes` is for consumers of the public `getProgram`, which may
      // walk upwards; diagnostics themselves never read a parent.
      const sourceFile = ts.createSourceFile(fileName, content, languageVersionOrOptions, true);
      parsed.set(fileName, sourceFile);
      return sourceFile;
    },
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    writeFile: () => {
      // Diagnostics only — this host never emits.
    },
    // Every path the engine hands this host is already absolute, so the current
    // directory is never consulted to resolve one; it is supplied because the
    // host contract requires it. That is also why mutating it survives: no
    // fixture reaches a lookup that needs it.
    getCurrentDirectory: () => (tsConfigPath ? path.dirname(tsConfigPath) : process.cwd()),
    getCanonicalFileName: (fileName) => fileName,
    // Inert while `getCanonicalFileName` is identity — that already makes every
    // comparison case-sensitive — but both must agree, so it states the same rule.
    useCaseSensitiveFileNames: () => true,
    // Never observed: this host answers diagnostics and never emits, so nothing
    // in the suite can distinguish what this returns.
    getNewLine: () => "\n",
    fileExists: (fileName) => {
      try {
        return fs.exists(fileName);
      } catch {
        return false;
      }
    },
    readFile,
    // TypeScript calls these only while discovering `@types` and node_modules,
    // which no fixture in the suite has. `directoryExists` is reached during a
    // run but its answer changes nothing without those directories to find, and
    // `getDirectories` is never called at all — both are required for a real
    // project and neither can be pinned from here. The `catch` arms need a
    // failing real filesystem, which the in-memory double cannot produce.
    directoryExists: (dirPath) => {
      try {
        return fs.exists(dirPath) && fs.stat(dirPath).isDirectory();
      } catch {
        return false;
      }
    },
    getDirectories: (dirPath) => {
      try {
        return fs
          .readdir(dirPath)
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    // Only consulted while resolving through symlinks, which no fixture uses;
    // the fallback matters for a real workspace reached through one.
    realpath: (fileName) => {
      try {
        return fs.realpath(fileName);
      } catch {
        return fileName;
      }
    },
  };
}

/**
 * Wraps a lazily (re)built `ts.Program`, rebuilt only when `addScriptFile` adds a
 * root the tsconfig did not cover. `oldProgram` is deliberately NOT passed:
 * passing it makes a moved file fail to resolve — the `moveFile` scenario *two
 * out-of-project files move in turn* goes red, and green again with `oldProgram`
 * removed and nothing else changed. What the compiler does internally to cause
 * that was not isolated, so treat the reproduction as the evidence rather than
 * reasoning from an assumed mechanism. The host's parse cache is what keeps the
 * rebuild cheap instead.
 *
 * Built on `ts.createProgram`, not `ts.createLanguageService`: driving the same
 * compiler options and file list through each produces different semantic
 * diagnostics for this codebase's own use of ts-morph's heavily overloaded,
 * conditionally-typed API (confirmed by holding both fixed and switching only
 * the API) — `createProgram` is the one that agrees with `tsc`, which is the
 * target this module exists to match.
 */
function createDiagnosticService(
  compilerOptions: ts.CompilerOptions,
  rootNames: string[],
  host: ts.CompilerHost,
): DiagnosticService {
  const roots = new Set(rootNames);
  let program: ts.Program | undefined;
  // `!program` is what forces the first build, so this only governs rebuilds.
  let stale = false;

  const getProgram = (): ts.Program => {
    if (!program || stale) {
      program = ts.createProgram({
        rootNames: [...roots],
        options: compilerOptions,
        host,
      });
      stale = false;
    }
    return program;
  };

  return {
    getProgram,
    getSemanticDiagnostics: (fileName) => {
      const prog = getProgram();
      const sourceFile = prog.getSourceFile(fileName);
      if (!sourceFile) {
        throw new Error(`Could not find source file: '${fileName}'.`);
      }
      return [...prog.getSemanticDiagnostics(sourceFile)];
    },
    addScriptFile: (fileName) => {
      if (roots.has(fileName)) return;
      roots.add(fileName);
      stale = true;
    },
  };
}

/**
 * What `DiagnosticServiceCache` needs to build a service it does not yet hold.
 * `compilerOptions` and `rootNames` are exactly what ts-morph's own project
 * loading already computed, since tsconfig resolution (include, exclude,
 * extends) is not what ts-morph gets wrong.
 */
export interface DiagnosticProjectSource {
  compilerOptions: ts.CompilerOptions;
  rootNames: string[];
  fs?: FileSystem;
}

/**
 * Caches one `DiagnosticService` per tsconfig path (plus one for the
 * no-tsconfig case), so repeated lookups for the same config reuse the same
 * program instead of rebuilding one on every call.
 *
 * The parse cache outlives the service that used it, which is what makes a
 * rebuild cheap: `refreshFile` re-parses one file, `invalidate` re-parses all
 * of them. Retaining parses is only safe because those two are the sole
 * routes to a stale entry — a change on disk that reaches neither would be
 * checked against the content weaver last parsed.
 */
export class DiagnosticServiceCache {
  private entries = new Map<
    string,
    { parsed: Map<string, ts.SourceFile>; service?: DiagnosticService }
  >();

  /**
   * Returns the cached service for `tsConfigPath`, building it from `load()` on
   * a cache miss.
   *
   * The service is built on a host of this module's own rather than ts-morph's,
   * because what ts-morph gets wrong is source-file *creation*:
   * `@ts-morph/common`'s `DocumentRegistry` always passes a bare `ScriptTarget`
   * into `ts.createLanguageServiceSourceFile`, so `impliedNodeFormat` is never
   * computed and every file resolves as CommonJS under `module: NodeNext`. The
   * host built here reads through `fs` instead of `node:fs` — which also makes
   * it driveable against `InMemoryFileSystem` in a test — and hands
   * `ts.createSourceFile` the `CreateSourceFileOptions` the compiler itself
   * resolves per file, so `impliedNodeFormat` is computed rather than dropped.
   */
  get(tsConfigPath: string | null, load: () => DiagnosticProjectSource): DiagnosticService {
    const key = tsConfigCacheKey(tsConfigPath);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { parsed: new Map() };
      this.entries.set(key, entry);
    }
    if (!entry.service) {
      const { compilerOptions, rootNames, fs = new NodeFileSystem() } = load();
      entry.service = createDiagnosticService(
        compilerOptions,
        rootNames,
        buildCompilerHost(tsConfigPath, fs, entry.parsed),
      );
    }
    return entry.service;
  }

  /** Drops the cached service for `tsConfigPath` and every parse behind it. */
  invalidate(tsConfigPath: string | null): void {
    this.entries.delete(tsConfigCacheKey(tsConfigPath));
  }

  /**
   * Evicts `filePath`'s parse from every tsconfig that parsed it. A file can be
   * a root of more than one program — a nested config including `../shared`, say
   * — and evicting only the config nearest the file leaves the other answering
   * from the text that was there before the write.
   */
  evictFile(filePath: string): void {
    for (const entry of this.entries.values()) {
      if (entry.parsed.delete(filePath)) entry.service = undefined;
    }
  }

  /**
   * Evicts `filePath`'s parse, and the cached service with it so the next `get`
   * rebuilds the program while every other file's parse survives. A path the
   * program never parsed is a no-op.
   */
  refreshFile(tsConfigPath: string | null, filePath: string): void {
    const entry = this.entries.get(tsConfigCacheKey(tsConfigPath));
    // Only a file the program actually parsed can go stale, and rebuilding for
    // one it never held would discard a whole program for nothing. This is what
    // lets a caller evict on every write without knowing which paths carry a
    // parse — a `.md` write costs a lookup, a `.mts` write is not missed.
    if (entry?.parsed.delete(filePath)) entry.service = undefined;
  }

  /**
   * Evicts the diagnostic service and every parse across all tsconfigs, so the
   * next `get` rebuilds from disk. Entry keys survive so which tsconfigs the
   * daemon has seen is not lost; only the retained program and its source files
   * are dropped.
   */
  evictAll(): void {
    for (const entry of this.entries.values()) {
      entry.service = undefined;
      entry.parsed.clear();
    }
  }
}
