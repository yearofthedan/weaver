import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { TsMorphEngine } from "./engine.js";
import { tsRemoveImportersOf } from "./remove-importers.js";
import type { DeleteFileActionResult } from "./types.js";

/**
 * Engine-level action: remove all import references to `targetFile` from
 * TS/JS files within the workspace, physically delete the file,
 * and invalidate the engine project cache.
 *
 * Vue SFC cleanup is NOT done here — that is the responsibility of the
 * caller (e.g. VolarEngine.deleteFile) so that the core engine does not
 * depend on the Vue plugin layer.
 *
 * `targetFile` must be an absolute path. `scope` controls workspace boundary
 * enforcement and file write tracking.
 */
export async function tsDeleteFile(
  engine: TsMorphEngine,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<DeleteFileActionResult> {
  const importRefsRemoved = await tsRemoveImportersOf(engine, targetFile, scope);

  scope.fs.unlink(targetFile);
  engine.invalidateProject(targetFile);

  return { importRefsRemoved };
}
