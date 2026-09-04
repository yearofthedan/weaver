import ts from "typescript";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../operations/types.js";
import { MAX_DIAGNOSTICS } from "../operations/types.js";
import type { TsMorphEngine } from "./engine.js";
import { typeCheckedFiles } from "./type-check-scope.js";

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

/** Errors only, from one file's semantic diagnostics. */
export function semanticErrors(ls: ts.LanguageService, fileName: string): ts.Diagnostic[] {
  return ls
    .getSemanticDiagnostics(fileName)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
}

/**
 * Cap a collected error list at MAX_DIAGNOSTICS and map it into the response
 * shape. `errorCount` stays the true total, so a caller can tell that results
 * were trimmed rather than that fewer errors existed.
 */
export function capDiagnostics(errors: ts.Diagnostic[]): GetTypeErrorsResult {
  return {
    diagnostics: errors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic),
    errorCount: errors.length,
    truncated: errors.length > MAX_DIAGNOSTICS,
  };
}

function tsGetTypeErrorsForFile(compiler: TsMorphEngine, absPath: string): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForFile(absPath);
  return capDiagnostics(semanticErrors(ls, absPath));
}

function tsGetTypeErrorsForProject(
  compiler: TsMorphEngine,
  workspace: string,
): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForDirectory(workspace);
  // Only a syntax-only service returns undefined here, and ts-morph never builds one.
  const program = ls.getProgram() as ts.Program;
  const seed = compiler.getSeedFilePaths(workspace);
  // Only computed when there's no tsconfig to seed from — getProjectSourceFilePaths
  // is O(project files) and typeCheckedFiles ignores it on the seeded branch.
  const checked = typeCheckedFiles(
    seed,
    seed === null ? compiler.getProjectSourceFilePaths(workspace) : [],
    program,
  );
  const allErrors: ts.Diagnostic[] = [];
  for (const filePath of checked) {
    // getSemanticDiagnostics throws for a path outside the compiled program, and
    // addWorkspaceFiles deliberately adds files the program excludes (.js with allowJs unset)
    // so that a move can still repoint their imports.
    if (!program.getSourceFile(filePath)) continue;
    allErrors.push(...semanticErrors(ls, filePath));
  }
  return capDiagnostics(allErrors);
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
