import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Compiler, MoveResult } from "../types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { applyTextEdits } from "../utils/text-utils.js";

export async function moveFile(
  compiler: Compiler,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<MoveResult> {
  const absOld = assertFileExists(oldPath);
  const absNew = scope.fs.resolve(newPath);

  const edits = await compiler.getEditsForFileRename(absOld, absNew);

  for (const edit of edits) {
    if (!scope.contains(edit.fileName)) {
      scope.recordSkipped(edit.fileName);
      continue;
    }
    const original = compiler.readFile(edit.fileName);
    const updated = applyTextEdits(original, edit.textChanges);
    scope.writeFile(edit.fileName, updated);
    compiler.notifyFileWritten(edit.fileName, updated);
  }

  // Physical move.
  const destDir = scope.fs.resolve(absNew, "..");
  if (!scope.fs.exists(destDir)) {
    scope.fs.mkdir(destDir, { recursive: true });
  }
  scope.fs.rename(absOld, absNew);

  // Compiler cleanup (cache invalidation, post-move scans, etc.).
  // Pass the already-modified set so the fallback scan can skip files that were
  // already rewritten by getEditsForFileRename.
  const { modified: extraModified, skipped: extraSkipped } = await compiler.afterFileRename(
    absOld,
    absNew,
    scope.root,
    new Set(scope.modified),
  );

  for (const f of extraModified) {
    scope.recordModified(f);
  }
  for (const f of extraSkipped) {
    scope.recordSkipped(f);
  }

  scope.recordModified(absNew);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    oldPath: absOld,
    newPath: absNew,
  };
}
