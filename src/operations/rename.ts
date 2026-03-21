import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { RenameResult } from "./types.js";

export async function rename(
  compiler: Engine,
  filePath: string,
  line: number,
  col: number,
  newName: string,
  scope: WorkspaceScope,
): Promise<RenameResult> {
  const absPath = assertFileExists(filePath);
  return compiler.rename(absPath, line, col, newName, scope);
}
