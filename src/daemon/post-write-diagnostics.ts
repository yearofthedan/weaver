import * as path from "node:path";
import ts from "typescript";
import type { PostWriteDiagnostics } from "../operations/types.js";
import { MAX_DIAGNOSTICS } from "../operations/types.js";
import type { FileSystem } from "../ports/filesystem.js";
import type { TsMorphEngine } from "../ts-engine/engine.js";
import { toDiagnostic } from "../ts-engine/get-type-errors.js";

const TS_FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * Check type errors only in the given files and return the three post-write
 * diagnostic fields. Non-TS files are silently skipped. Results are capped at
 * MAX_DIAGNOSTICS total across all files; typeErrorCount reflects the true total.
 */
export function getTypeErrorsForFiles(
  compiler: TsMorphEngine,
  files: string[],
  fs: FileSystem,
): PostWriteDiagnostics {
  const tsFiles = files.filter((f) => TS_FILE_EXTENSIONS.has(path.extname(f)));

  let totalCount = 0;
  const allDiagnostics: ReturnType<typeof toDiagnostic>[] = [];

  for (const file of tsFiles) {
    if (!fs.exists(file)) continue;

    compiler.refreshSourceFile(file);
    const ls = compiler.getLanguageServiceForFile(file);
    const raw = ls.getSemanticDiagnostics(file);
    const errors = raw.filter((d) => d.category === ts.DiagnosticCategory.Error);
    totalCount += errors.length;
    for (const d of errors) {
      if (allDiagnostics.length < MAX_DIAGNOSTICS) {
        allDiagnostics.push(toDiagnostic(d));
      }
    }
  }

  return {
    typeErrors: allDiagnostics,
    typeErrorCount: totalCount,
    typeErrorsTruncated: totalCount > MAX_DIAGNOSTICS,
  };
}
