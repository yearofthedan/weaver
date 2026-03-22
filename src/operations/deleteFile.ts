import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { isSensitiveFile } from "../utils/sensitive-files.js";
import type { DeleteFileResult } from "./types.js";

export async function deleteFile(
  engine: Engine,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<DeleteFileResult> {
  const absTarget = assertFileExists(targetFile);

  if (isSensitiveFile(absTarget)) {
    throw Object.assign(new Error(`Refusing to delete sensitive file: ${absTarget}`), {
      code: "SENSITIVE_FILE",
    });
  }

  const { importRefsRemoved } = await engine.deleteFile(absTarget, scope);

  return {
    deletedFile: absTarget,
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    importRefsRemoved,
  };
}
