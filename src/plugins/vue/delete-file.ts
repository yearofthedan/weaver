import * as path from "node:path";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { tsDeleteFile } from "../../ts-engine/delete-file.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import type { DeleteFileActionResult } from "../../ts-engine/types.js";
import { removeVueImportsOfDeletedFile } from "./scan.js";

export async function vueDeleteFile(
  tsEngine: TsMorphEngine,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<DeleteFileActionResult> {
  const { importRefsRemoved } = await tsDeleteFile(tsEngine, targetFile, scope);

  const workspaceRoot = path.resolve(scope.root);
  const { skipped: vueSkipped, refsRemoved: vueRefs } = removeVueImportsOfDeletedFile(
    targetFile,
    workspaceRoot,
    scope,
  );
  for (const f of vueSkipped) scope.recordSkipped(f);

  return { importRefsRemoved: importRefsRemoved + vueRefs };
}
