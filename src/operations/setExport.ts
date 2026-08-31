import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { SetExportResult } from "./types.js";

export async function setExport(
  engine: Engine,
  file: string,
  symbolName: string,
  exported: boolean,
  scope: WorkspaceScope,
): Promise<SetExportResult> {
  assertFileExists(file, scope.fs);
  return engine.setExport(file, symbolName, exported, scope);
}
