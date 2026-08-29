import ts from "typescript";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../operations/types.js";
import { MAX_DIAGNOSTICS } from "../operations/types.js";
import type { TsMorphEngine } from "./engine.js";

export function extractDiagnosticMessage(messageText: string | ts.DiagnosticMessageChain): string {
  return typeof messageText === "string" ? messageText : messageText.messageText;
}

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
  return { file, line, col, code: d.code, message: extractDiagnosticMessage(d.messageText) };
}

function tsGetTypeErrorsForFile(compiler: TsMorphEngine, absPath: string): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForFile(absPath);
  const all = ls.getSemanticDiagnostics(absPath);
  const errors = all.filter((d) => d.category === ts.DiagnosticCategory.Error);
  const truncated = errors.length > MAX_DIAGNOSTICS;
  const diagnostics = errors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic);
  return { diagnostics, errorCount: errors.length, truncated };
}

function tsGetTypeErrorsForProject(
  compiler: TsMorphEngine,
  workspace: string,
): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForDirectory(workspace);
  // Only a syntax-only service returns undefined here, and ts-morph never builds one.
  const program = ls.getProgram() as ts.Program;
  const allErrors: ReturnType<typeof ls.getSemanticDiagnostics> = [];
  for (const filePath of compiler.getProjectSourceFilePaths(workspace)) {
    // getSemanticDiagnostics throws for a path outside the compiled program, and
    // addWorkspaceFiles deliberately adds files the program excludes (.js with allowJs unset)
    // so that a move can still repoint their imports.
    if (!program.getSourceFile(filePath)) continue;
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
