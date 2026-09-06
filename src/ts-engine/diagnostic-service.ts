import * as path from "node:path";
import ts from "typescript";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";

/** Cache key for the diagnostic service covering files with no tsconfig above them. */
const NO_TSCONFIG_CACHE_KEY = "__no_tsconfig__";

/**
 * The subset of `ts.LanguageService` that `get-type-errors.ts` actually calls.
 * Deliberately its own interface, not `Pick<ts.LanguageService, ...>` — unlike
 * the real API, `getProgram` here is never `undefined`, since this service has
 * no syntax-only mode to fall back to.
 */
export interface DiagnosticLanguageService {
  getSemanticDiagnostics(fileName: string): ts.Diagnostic[];
  getProgram(): ts.Program;
}

export interface DiagnosticService {
  languageService: DiagnosticLanguageService;
  /**
   * Root files the program is built from. Mutated in place (never
   * reassigned) so `createDiagnosticLanguageService`'s length check — read on
   * every call — sees an addition immediately. Mirrors `ensureProject`'s
   * single-file add on the ts-morph side.
   */
  scriptFileNames: string[];
}

function buildCompilerHost(
  compilerOptions: ts.CompilerOptions,
  tsConfigPath: string | null,
  fs: FileSystem,
): ts.CompilerHost {
  return {
    getSourceFile: (fileName, languageVersionOrOptions) => {
      let content: string | undefined;
      try {
        content = fs.readFile(fileName);
      } catch {
        return undefined;
      }
      return ts.createSourceFile(fileName, content, languageVersionOrOptions, true);
    },
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    writeFile: () => {
      // Diagnostics only — this host never emits.
    },
    getCurrentDirectory: () => (tsConfigPath ? path.dirname(tsConfigPath) : process.cwd()),
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => {
      try {
        return fs.exists(fileName);
      } catch {
        return false;
      }
    },
    readFile: (fileName) => {
      try {
        return fs.readFile(fileName);
      } catch {
        return undefined;
      }
    },
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
 * Wraps a lazily (re)built `ts.Program` behind the two methods
 * `get-type-errors.ts` needs. Rebuilds only when `scriptFileNames`'s length
 * has grown since the last build — the only way it changes, since
 * `getDiagnosticServiceForFile` only ever pushes — reusing `oldProgram` so an
 * added file doesn't force re-parsing everything already checked.
 *
 * Built on `ts.createProgram`, not `ts.createLanguageService`: driving the
 * same compiler options and file list through each produces different
 * semantic diagnostics for this codebase's own use of ts-morph's heavily
 * overloaded, conditionally-typed API (confirmed by holding both fixed and
 * switching only the API) — `createProgram` is the one that agrees with
 * `tsc`, which is the actual target this module exists to match.
 */
function createDiagnosticLanguageService(
  compilerOptions: ts.CompilerOptions,
  scriptFileNames: string[],
  host: ts.CompilerHost,
): DiagnosticLanguageService {
  let program: ts.Program | undefined;
  let builtForLength = -1;

  const getProgram = (): ts.Program => {
    if (!program || builtForLength !== scriptFileNames.length) {
      program = ts.createProgram({
        rootNames: scriptFileNames,
        options: compilerOptions,
        oldProgram: program,
        host,
      });
      builtForLength = scriptFileNames.length;
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
  };
}

/**
 * Builds a diagnostic service from an already-resolved tsconfig —
 * `compilerOptions` and `scriptFileNames` are exactly what ts-morph's own
 * project loading already computed, since tsconfig resolution (include,
 * exclude, extends) is not what ts-morph gets wrong.
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
  scriptFileNames: string[],
  tsConfigPath: string | null,
  fs: FileSystem = new NodeFileSystem(),
): DiagnosticService {
  const mutableFileNames = [...scriptFileNames];
  const host = buildCompilerHost(compilerOptions, tsConfigPath, fs);
  return {
    languageService: createDiagnosticLanguageService(compilerOptions, mutableFileNames, host),
    scriptFileNames: mutableFileNames,
  };
}

/**
 * Caches one `DiagnosticService` per tsconfig path (plus one for the
 * no-tsconfig case), so repeated lookups for the same config reuse the same
 * service instead of rebuilding a program on every call.
 */
export class DiagnosticServiceCache {
  private entries = new Map<string, DiagnosticService>();

  private cacheKey(tsConfigPath: string | null): string {
    return tsConfigPath ?? NO_TSCONFIG_CACHE_KEY;
  }

  /** Returns the cached entry for `tsConfigPath`, building it via `build` on a cache miss. */
  get(tsConfigPath: string | null, build: () => DiagnosticService): DiagnosticService {
    const key = this.cacheKey(tsConfigPath);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = build();
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** Drops the cached entry for `tsConfigPath`, if any. The next `get` rebuilds it. */
  invalidate(tsConfigPath: string | null): void {
    this.entries.delete(this.cacheKey(tsConfigPath));
  }
}
