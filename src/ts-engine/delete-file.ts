import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { removeVueImportsOfDeletedFile } from "../plugins/vue/scan.js";
import type { TsMorphEngine } from "./engine.js";
import { tsRemoveImportersOf } from "./remove-importers.js";
import type { DeleteFileActionResult } from "./types.js";

/**
 * Engine-level action: remove all import references to `targetFile` from
 * TS/JS and Vue SFC files within the workspace, physically delete the file,
 * and invalidate the engine project cache.
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

  const workspaceRoot = path.resolve(scope.root);
  const { skipped: vueSkipped, refsRemoved: vueRefs } = removeVueImportsOfDeletedFile(
    targetFile,
    workspaceRoot,
    scope,
  );
  for (const f of vueSkipped) scope.recordSkipped(f);

  scope.fs.unlink(targetFile);
  engine.invalidateProject(targetFile);

  return { importRefsRemoved: importRefsRemoved + vueRefs };
}
