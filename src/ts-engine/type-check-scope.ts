/**
 * Decides which files a project-wide type check should cover.
 *
 * A tsconfig's own program — its `include`/`exclude` plus whatever those files
 * transitively import — is what a caller's build judges their code against.
 * Both engines also walk the whole workspace to widen the reference graph for
 * operations like rename; that walk is not a wider type check, so `seedFiles`
 * (the tsconfig program's own file set, resolved by the caller before its walk
 * runs) is what gets checked when a tsconfig exists. With no tsconfig there is
 * no program to defer to, so the walk is the only file set there is.
 */
export function typeCheckedFiles(
  hasTsConfig: boolean,
  seedFiles: Iterable<string>,
  walkedFiles: Iterable<string>,
): Set<string> {
  return hasTsConfig ? new Set(seedFiles) : new Set(walkedFiles);
}
