import ts from "typescript";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../operations/types.js";
import type { TsMorphEngine } from "./engine.js";

export const MAX_DIAGNOSTICS = 100;

export function toDiagnostic(
  d: ReturnType<ts.LanguageService["getSemanticDiagnostics"]>[number],
): TypeDiagnostic {
  const sourceFile = d.file;
  const file = sourceFile?.fileName ?? "";
  let line = 1;
  let col = 1;
  if (sourceFile !== undefined && d.start !== undefined) {
    const lc = ts.getLineAndCharacterOfPosition(sourceFile, d.start);
    line = lc.line + 1;
    col = lc.character + 1;
  }
  const message = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
  return { file, line, col, code: d.code, message };
}

export function tsGetTypeErrorsForFile(
  compiler: TsMorphEngine,
  absPath: string,
): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForFile(absPath);
  const all = ls.getSemanticDiagnostics(absPath);
  const errors = all.filter((d) => d.category === ts.DiagnosticCategory.Error);
  const truncated = errors.length > MAX_DIAGNOSTICS;
  const diagnostics = errors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic);
  return { diagnostics, errorCount: errors.length, truncated };
}

export function tsGetTypeErrorsForProject(
  compiler: TsMorphEngine,
  workspace: string,
): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForDirectory(workspace);
  const allErrors: ReturnType<typeof ls.getSemanticDiagnostics> = [];
  for (const filePath of compiler.getProjectSourceFilePaths(workspace)) {
    const diags = ls.getSemanticDiagnostics(filePath);
    for (const d of diags) {
      if (d.category === ts.DiagnosticCategory.Error) {
        allErrors.push(d);
      }
    }
  }
  const truncated = allErrors.length > MAX_DIAGNOSTICS;
  const diagnostics = allErrors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic);
  return { diagnostics, errorCount: allErrors.length, truncated };
}

export function tsGetTypeErrors(
  compiler: TsMorphEngine,
  file: string | undefined,
  scope: WorkspaceScope,
): GetTypeErrorsResult {
  if (file !== undefined) {
    return tsGetTypeErrorsForFile(compiler, file);
  }
  return tsGetTypeErrorsForProject(compiler, scope.root);
}
