import * as path from "node:path";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { applyRenameEdits } from "../../ts-engine/apply-rename-edits.js";
import type { TsMorphEngine } from "../../ts-engine/engine.js";
import { tsMoveFile } from "../../ts-engine/move-file.js";
import type { FileTextEdit, MoveFileActionResult } from "../../ts-engine/types.js";
import { findTsConfigForFile } from "../../utils/ts-project.js";
import type { VolarEngine } from "./engine.js";
import { updateVueImportsAfterMove } from "./scan.js";

/**
 * The import edits only the Vue language service can produce, for one file about to move.
 *
 * Volar registers each SFC under a virtual `<name>.vue.ts`, so a moved SFC has to be named
 * that way for its importers to be found at all — a query against the real path returns
 * nothing. Everything importing a moved SFC is taken, because no other engine can see it.
 *
 * A moved `.ts` file yields only its SFC importers here; its `.ts` importers belong to the
 * TypeScript engine, which runs afterwards and would otherwise rewrite them a second time.
 */
export async function vueRenameEdits(
  engine: VolarEngine,
  oldPath: string,
  newPath: string,
): Promise<FileTextEdit[]> {
  if (oldPath.endsWith(".vue")) {
    return engine.getEditsForFileRename(`${oldPath}.ts`, `${newPath}.ts`);
  }
  return engine.getEditsForFileRename(oldPath, newPath, (f) => f.endsWith(".vue"));
}

/**
 * Full moveFile workflow for a Vue project: take the SFC half of the rename from the Vue
 * language service, then hand the TypeScript half to the engine that owns it.
 *
 * The two halves are disjoint by file extension, so nothing is rewritten twice.
 */
export async function vueMoveFile(
  engine: VolarEngine,
  tsEngine: TsMorphEngine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<MoveFileActionResult> {
  const tsConfig = findTsConfigForFile(oldPath);
  const searchRoot = tsConfig ? path.dirname(tsConfig) : scope.root;

  // The service has to see oldPath on disk, so this query cannot wait until after the move.
  applyRenameEdits(engine, await vueRenameEdits(engine, oldPath, newPath), scope);

  const result = await tsMoveFile(tsEngine, oldPath, newPath, scope);
  engine.invalidateService(oldPath);
  updateVueImportsAfterMove(oldPath, newPath, searchRoot, scope);
  return result;
}
