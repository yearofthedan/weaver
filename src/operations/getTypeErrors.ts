import * as path from "node:path";
import ts from "typescript";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { TsMorphEngine } from "../ts-engine/engine.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "./types.js";

export const MAX_DIAGNOSTICS = 100;

export async function getTypeErrors(
  compiler: TsMorphEngine,
  file: string | undefined,
  scope: WorkspaceScope,
): Promise<GetTypeErrorsResult> {
  if (file !== undefined) {
    const absPath = path.resolve(file);
    if (!scope.fs.exists(absPath)) {
      throw new EngineError(`File not found: ${file}`, "FILE_NOT_FOUND");
    }
    if (!scope.contains(absPath)) {
      throw new EngineError(`file is outside the workspace: ${file}`, "WORKSPACE_VIOLATION");
    }
    return getForFile(compiler, absPath);
  }
  return getForProject(compiler, scope.root);
}

function getForFile(compiler: TsMorphEngine, absPath: string): GetTypeErrorsResult {
  const ls = compiler.getLanguageServiceForFile(absPath);
  const all = ls.getSemanticDiagnostics(absPath);
  const errors = all.filter((d) => d.category === ts.DiagnosticCategory.Error);
  const truncated = errors.length > MAX_DIAGNOSTICS;
  const diagnostics = errors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic);
  return { diagnostics, errorCount: errors.length, truncated };
}

function getForProject(compiler: TsMorphEngine, workspace: string): GetTypeErrorsResult {
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
