import * as path from "node:path";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import type { GetTypeErrorsResult } from "./types.js";

export { MAX_DIAGNOSTICS, toDiagnostic } from "../ts-engine/get-type-errors.js";

export async function getTypeErrors(
  engine: Engine,
  file: string | undefined,
  scope: WorkspaceScope,
): Promise<GetTypeErrorsResult> {
  if (file !== undefined) {
    const absPath = path.resolve(file);
    if (!scope.fs.exists(absPath)) {
      throw new EngineError(`File not found: ${file}`, "FILE_NOT_FOUND");
    }
    if (!scope.contains(absPath)) {
      throw new EngineError(`file is outside the workspace: ${file}`, "WORKSPACE_VIOLATION");
    }
    return engine.getTypeErrors(absPath, scope);
  }
  return engine.getTypeErrors(undefined, scope);
}
