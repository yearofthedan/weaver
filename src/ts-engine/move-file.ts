import { applyRenameEdits } from "../domain/apply-rename-edits.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { TsMorphEngine } from "./engine.js";
import type { MoveFileActionResult } from "./types.js";

/**
 * Full moveFile workflow for TypeScript/JavaScript files.
 * Computes import edits, applies them, physically moves the file,
 * and runs the post-rename fallback scan.
 *
 * Precondition: `oldPath` must exist. Validation is the caller's responsibility.
 */
export async function tsMoveFile(
  engine: TsMorphEngine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<MoveFileActionResult> {
  const edits = await engine.getEditsForFileRename(oldPath, newPath);
  applyRenameEdits(engine, edits, scope);

  const destDir = scope.fs.resolve(newPath, "..");
  if (!scope.fs.exists(destDir)) {
    scope.fs.mkdir(destDir, { recursive: true });
  }
  scope.fs.rename(oldPath, newPath);

  // afterFileRename: update project graph + rewrite own imports + fallback importer scan.
  // afterFileRename stays on TsMorphEngine as a class method (not on Engine interface)
  // until the moveDirectory spec removes it.
  await engine.afterFileRename(oldPath, newPath, scope);

  scope.recordModified(newPath);

  return { oldPath, newPath };
}
