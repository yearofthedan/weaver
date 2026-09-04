import * as path from "node:path";
import type ts from "typescript";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";

/**
 * `SourceFile.imports` and `Program.getResolvedModule` are how the compiler
 * itself walks module specifiers to resolved files. Neither is part of the
 * public TypeScript API surface (verified against the installed
 * typescript@6.0.3 by reading its compiled source) — these narrow just the
 * members `closeOverImports` needs from them.
 */
interface SourceFileWithImports extends ts.SourceFile {
  readonly imports: readonly ts.StringLiteralLike[];
}

interface ProgramWithResolvedModule extends ts.Program {
  getResolvedModule(
    containingFile: ts.SourceFile,
    moduleName: string,
    mode: ts.ResolutionMode,
  ): { resolvedModule?: ts.ResolvedModuleFull } | undefined;
}

/**
 * Starting from `roots`, follows every file's resolved module specifiers and
 * returns everything reached — the transitive closure a real build judges,
 * whether or not each file individually matches the tsconfig's `include`.
 */
function closeOverImports(roots: Iterable<string>, program: ts.Program): Set<string> {
  const resolvingProgram = program as ProgramWithResolvedModule;
  const closed = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by the length check above
    const filePath = pending.pop()!;
    // Saves reprocessing only: one file importing the same module twice pushes it twice
    // before either copy is popped. The push below independently refuses anything already
    // closed, so dropping this changes no output — which is why no black-box test can
    // pin it, and why it is not the thing keeping a cycle from looping forever.
    if (closed.has(filePath)) continue;
    closed.add(filePath);
    const sourceFile = program.getSourceFile(filePath) as SourceFileWithImports | undefined;
    if (!sourceFile) continue;
    for (const specifier of sourceFile.imports) {
      const mode = program.getModeForUsageLocation(sourceFile, specifier);
      // The first `?.` is belt-and-braces: for a specifier taken from this file's own
      // `imports`, the call always returns an object, carrying `resolvedModule: undefined`
      // when resolution failed. The second is the one that does the work.
      const resolvedFileName = resolvingProgram.getResolvedModule(sourceFile, specifier.text, mode)
        ?.resolvedModule?.resolvedFileName;
      if (resolvedFileName !== undefined && !closed.has(resolvedFileName)) {
        pending.push(resolvedFileName);
      }
    }
  }
  return closed;
}

/**
 * Decides which files a project-wide type check should cover.
 *
 * A tsconfig's own program — its `include`/`exclude` roots plus whatever
 * those files transitively import — is what a caller's build judges their
 * code against, so this closes `seedFiles` over `program`'s own module
 * resolution. `seedFiles` is each caller's own snapshot of the files its
 * build would type-check, taken before that caller's workspace walk widens
 * the project for cross-file operations like rename — what exactly the
 * snapshot holds is the caller's own contract (see `TsMorphEngine`'s
 * `ProjectEntry.seed` and `CachedService.seedFileNames`). That walk is not a
 * wider type check. `seedFiles` is `null` when there is no tsconfig — no
 * program to defer to, so `walkedFiles` is the only file set there is.
 */
export function typeCheckedFiles(
  seedFiles: Iterable<string> | null,
  walkedFiles: Iterable<string>,
  program: ts.Program,
): Set<string> {
  return seedFiles === null ? new Set(walkedFiles) : closeOverImports(seedFiles, program);
}

const MAX_OTHER_CONFIGS = 10;
const defaultFs = new NodeFileSystem();

export interface CheckedScope {
  checked: { files: number; tsconfig: string | null };
  unchecked: { files: number; reason: string; otherConfigs: string[] };
}

/**
 * A file counts toward `checked`/`unchecked` when it's the caller's own code — under the
 * workspace root, and not a dependency in `node_modules`. Both TypeScript's own default
 * library files and third-party packages live inside the checked set too (see
 * `typeCheckedFiles`'s doc comment) — a real npm install of TypeScript ships its lib files
 * from inside some `node_modules` directory, so this one check excludes both — but a caller
 * asking "how much of my code did you look at" isn't asking about either.
 */
function isOwnWorkspaceFile(filePath: string, workspaceRoot: string): boolean {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(filePath));
  // `path.relative` only returns an absolute path when the two inputs share no common
  // base (e.g. different drive letters on Windows) — unreachable on POSIX, where both
  // sides are always resolved under `/`.
  const underRoot = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return underRoot && !filePath.includes("/node_modules/");
}

/** Other `tsconfig*.json` files at `workspaceRoot` itself, excluding `usedConfigPath`. Non-recursive. */
function findOtherConfigs(
  workspaceRoot: string,
  usedConfigPath: string | null,
  fs: FileSystem,
): string[] {
  const usedResolved = usedConfigPath ? path.resolve(usedConfigPath) : null;
  let entries: ReturnType<FileSystem["readdir"]>;
  try {
    entries = fs.readdir(workspaceRoot);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /^tsconfig.*\.json$/.test(entry.name))
    .map((entry) => path.resolve(workspaceRoot, entry.name))
    .filter((abs) => abs !== usedResolved)
    .sort()
    .slice(0, MAX_OTHER_CONFIGS);
}

/**
 * Describes how much of the caller's own code `checkedFiles` covers, for a project-wide
 * type check's `checked`/`unchecked` response fields. `walkedFiles` is each engine's full
 * workspace file set (see `TsMorphEngine.getProjectSourceFilePaths` / `CachedService.scriptFileNames`)
 * — `checkedFiles` minus `walkedFiles` is empty by construction, so subtracting the other way
 * is what finds the files a tsconfig-scoped check left out.
 */
export function describeCheckedScope(
  checkedFiles: ReadonlySet<string>,
  walkedFiles: Iterable<string>,
  tsConfigPath: string | null,
  workspaceRoot: string,
  fs: FileSystem = defaultFs,
): CheckedScope {
  const checkedCount = [...checkedFiles].filter((f) => isOwnWorkspaceFile(f, workspaceRoot)).length;
  const uncheckedCount = [...walkedFiles].filter(
    (f) => isOwnWorkspaceFile(f, workspaceRoot) && !checkedFiles.has(f),
  ).length;
  return {
    checked: { files: checkedCount, tsconfig: tsConfigPath },
    unchecked: {
      files: uncheckedCount,
      reason: tsConfigPath ? `outside ${tsConfigPath}` : "no tsconfig",
      otherConfigs: findOtherConfigs(workspaceRoot, tsConfigPath, fs),
    },
  };
}
