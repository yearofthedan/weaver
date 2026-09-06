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
 * A compiler host that caches each `ts.SourceFile` it parses, for the lifetime of
 * the service that owns it. `addScriptFile` rebuilds the program, and without
 * this every rebuild would re-parse every root to add one file. The cache cannot
 * go stale: the only thing that invalidates a file is `invalidateProject`, which
 * drops the whole service and this host with it.
 */
function buildCompilerHost(tsConfigPath: string | null, fs: FileSystem): ts.CompilerHost {
  const parsed = new Map<string, ts.SourceFile>();

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
    // host contract requires it.
    getCurrentDirectory: () => (tsConfigPath ? path.dirname(tsConfigPath) : process.cwd()),
    getCanonicalFileName: (fileName) => fileName,
    // Inert while `getCanonicalFileName` is identity — that already makes every
    // comparison case-sensitive — but both must agree, so it states the same rule.
    useCaseSensitiveFileNames: () => true,
    // Never observed: this host answers diagnostics and never emits.
    getNewLine: () => "\n",
    fileExists: (fileName) => {
      try {
        return fs.exists(fileName);
      } catch {
        return false;
      }
    },
    readFile,
    // TypeScript calls `directoryExists` and `getDirectories` only while
    // discovering `@types` and node_modules, which no fixture in the test suite
    // has — they are required for a real project and unreachable from a test.
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
 * Builds a diagnostic service from an already-resolved tsconfig —
 * `compilerOptions` and `rootNames` are exactly what ts-morph's own project
 * loading already computed, since tsconfig resolution (include, exclude,
 * extends) is not what ts-morph gets wrong.
 *
 * What it gets wrong is source-file *creation*: `@ts-morph/common`'s
 * `DocumentRegistry` always passes a bare `ScriptTarget` into
 * `ts.createLanguageServiceSourceFile`, so `impliedNodeFormat` is never
 * computed and every file resolves as CommonJS under `module: NodeNext`.
 * The host built here reads through `fs` instead of `node:fs` — which also
 * makes it driveable against `InMemoryFileSystem` in a test — and hands
 * `ts.createSourceFile` the `CreateSourceFileOptions` the compiler itself
 * resolves per file, so `impliedNodeFormat` is computed rather than dropped.
 */
export function buildDiagnosticService(
  compilerOptions: ts.CompilerOptions,
  rootNames: string[],
  tsConfigPath: string | null,
  fs: FileSystem = new NodeFileSystem(),
): DiagnosticService {
  return createDiagnosticService(compilerOptions, rootNames, buildCompilerHost(tsConfigPath, fs));
}

/**
 * Caches one `DiagnosticService` per tsconfig path (plus one for the
 * no-tsconfig case), so repeated lookups for the same config reuse the same
 * program instead of rebuilding one on every call.
 */
export class DiagnosticServiceCache {
  private entries = new Map<string, DiagnosticService>();

  /** Returns the cached entry for `tsConfigPath`, building it via `build` on a cache miss. */
  get(tsConfigPath: string | null, build: () => DiagnosticService): DiagnosticService {
    const key = tsConfigCacheKey(tsConfigPath);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = build();
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Drops the cached entry for `tsConfigPath`, if any. The next `get` rebuilds it. */
  invalidate(tsConfigPath: string | null): void {
    this.entries.delete(tsConfigCacheKey(tsConfigPath));
  }
}
