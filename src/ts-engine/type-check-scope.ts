import type ts from "typescript";

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
    const filePath = pending.pop() as string;
    if (closed.has(filePath)) continue;
    closed.add(filePath);
    const sourceFile = program.getSourceFile(filePath) as SourceFileWithImports | undefined;
    if (!sourceFile) continue;
    for (const specifier of sourceFile.imports) {
      const mode = program.getModeForUsageLocation(sourceFile, specifier);
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
