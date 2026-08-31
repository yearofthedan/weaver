import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { PostWriteDiagnostics, TypeDiagnostic } from "../operations/types.js";
import { MAX_DIAGNOSTICS } from "../operations/types.js";
import type { Engine } from "../ts-engine/types.js";

const TS_FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * Check type errors only in the given files and return the three post-write
 * diagnostic fields. Non-TS files are silently skipped. Results are capped at
 * MAX_DIAGNOSTICS total across all files; typeErrorCount reflects the true total.
 *
 * Takes the project's own `Engine` (ts-morph or, in a Vue project, Volar) so a
 * write that touches a `.ts` file importing an SFC is answered by whichever
 * engine actually resolves `.vue` specifiers.
 */
export async function getTypeErrorsForFiles(
  engine: Engine,
  files: string[],
  scope: WorkspaceScope,
): Promise<PostWriteDiagnostics> {
  const tsFiles = files
    .filter((f) => TS_FILE_EXTENSIONS.has(path.extname(f)))
    .filter((f) => scope.fs.exists(f));

  // Refresh every file before asking about any of them. An engine is free to
  // implement refreshFile by dropping a whole cached project, so interleaving
  // refresh and query rebuilds that project once per file.
  for (const file of tsFiles) {
    engine.refreshFile(file);
  }

  let totalCount = 0;
  const allDiagnostics: TypeDiagnostic[] = [];

  for (const file of tsFiles) {
    const result = await engine.getTypeErrors(file, scope);
    totalCount += result.errorCount;
    for (const d of result.diagnostics) {
      if (allDiagnostics.length < MAX_DIAGNOSTICS) {
        allDiagnostics.push(d);
      }
    }
  }

  return {
    typeErrors: allDiagnostics,
    typeErrorCount: totalCount,
    typeErrorsTruncated: totalCount > MAX_DIAGNOSTICS,
  };
}
