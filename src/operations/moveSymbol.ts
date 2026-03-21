import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { MoveSymbolResult } from "./types.js";

/**
 * Move a named export from `sourceFile` to `destFile`, updating all importers
 * within the workspace.
 *
 * Delegates the full workflow — AST surgery, import rewriting, and any
 * project-specific scanning (e.g. Vue SFC script blocks) — to `engine.moveSymbol`.
 */
export async function moveSymbol(
  engine: Engine,
  sourceFile: string,
  symbolName: string,
  destFile: string,
  scope: WorkspaceScope,
  options?: { force?: boolean },
): Promise<MoveSymbolResult> {
  const absSource = assertFileExists(sourceFile);
  const absDest = path.resolve(destFile);

  await engine.moveSymbol(absSource, symbolName, absDest, scope, options);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    symbolName,
    sourceFile: absSource,
    destFile: absDest,
  };
}
