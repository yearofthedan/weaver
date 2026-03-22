import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { ExtractFunctionResult } from "./types.js";

export async function extractFunction(
  engine: Engine,
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  functionName: string,
  scope: WorkspaceScope,
): Promise<ExtractFunctionResult> {
  assertFileExists(file);
  return engine.extractFunction(file, startLine, startCol, endLine, endCol, functionName, scope);
}
