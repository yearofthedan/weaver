import * as path from "node:path";
import type { TsMorphCompiler } from "../compilers/ts.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { removeVueImportsOfDeletedFile } from "../plugins/vue/scan.js";
import { isSensitiveFile } from "../security.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { DeleteFileResult } from "./types.js";

export async function deleteFile(
  tsCompiler: TsMorphCompiler,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<DeleteFileResult> {
  const absTarget = assertFileExists(targetFile);

  if (isSensitiveFile(absTarget)) {
    throw Object.assign(new Error(`Refusing to delete sensitive file: ${absTarget}`), {
      code: "SENSITIVE_FILE",
    });
  }

  const importRefsRemoved = await tsCompiler.removeImportersOf(absTarget, scope);

  const workspaceRoot = path.resolve(scope.root);
  const { skipped: vueSkipped, refsRemoved: vueRefs } = removeVueImportsOfDeletedFile(
    absTarget,
    workspaceRoot,
    scope,
  );
  for (const f of vueSkipped) scope.recordSkipped(f);

  scope.fs.unlink(absTarget);
  tsCompiler.invalidateProject(absTarget);

  return {
    deletedFile: absTarget,
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    importRefsRemoved: importRefsRemoved + vueRefs,
  };
}
