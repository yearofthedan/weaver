import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { MoveResult } from "./types.js";

export async function moveFile(
  compiler: Engine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<MoveResult> {
  const absOld = assertFileExists(oldPath);
  const absNew = scope.fs.resolve(newPath);

  await compiler.moveFile(absOld, absNew, scope);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    oldPath: absOld,
    newPath: absNew,
  };
}
