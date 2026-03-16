import { applyRenameEdits } from "../domain/apply-rename-edits.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Compiler, MoveResult } from "../types.js";
import { assertFileExists } from "../utils/assert-file.js";

export async function moveFile(
  compiler: Compiler,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<MoveResult> {
  const absOld = assertFileExists(oldPath);
  const absNew = scope.fs.resolve(newPath);

  const edits = await compiler.getEditsForFileRename(absOld, absNew);
  applyRenameEdits(compiler, edits, scope);

  // Physical move.
  const destDir = scope.fs.resolve(absNew, "..");
  if (!scope.fs.exists(destDir)) {
    scope.fs.mkdir(destDir, { recursive: true });
  }
  scope.fs.rename(absOld, absNew);

  // Compiler cleanup (cache invalidation, post-move scans, etc.).
  // The compiler records directly into scope; files already in scope.modified
  // are skipped by the compiler to avoid double-rewriting.
  await compiler.afterFileRename(absOld, absNew, scope);

  scope.recordModified(absNew);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    oldPath: absOld,
    newPath: absNew,
  };
}
