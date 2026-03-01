import * as fs from "node:fs";
import * as path from "node:path";
import { ts } from "ts-morph";
import type { TsProvider } from "../providers/ts.js";
import { isWithinWorkspace } from "../security.js";
import type { GetTypeErrorsResult, TypeDiagnostic } from "../types.js";
import { EngineError } from "../utils/errors.js";

const MAX_DIAGNOSTICS = 100;

export async function getTypeErrors(
  provider: TsProvider,
  file: string | undefined,
  workspace: string,
): Promise<GetTypeErrorsResult> {
  if (file !== undefined) {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${file}`, "FILE_NOT_FOUND");
    }
    if (!isWithinWorkspace(absPath, workspace)) {
      throw new EngineError(`file is outside the workspace: ${file}`, "WORKSPACE_VIOLATION");
    }
    return getForFile(provider, absPath);
  }
  return getForProject(provider, workspace);
}

function getForFile(provider: TsProvider, absPath: string): GetTypeErrorsResult {
  const project = provider.getProjectForFile(absPath);
  if (!project.getSourceFile(absPath)) {
    project.addSourceFileAtPath(absPath);
  }
  const ls = project.getLanguageService().compilerObject;
  const all = ls.getSemanticDiagnostics(absPath);
  const errors = all.filter((d) => d.category === ts.DiagnosticCategory.Error);
  const truncated = errors.length > MAX_DIAGNOSTICS;
  const diagnostics = errors.slice(0, MAX_DIAGNOSTICS).map(toDiagnostic);
  return { diagnostics, errorCount: errors.length, truncated };
}

function getForProject(provider: TsProvider, workspace: string): GetTypeErrorsResult {
  const project = provider.getProjectForDirectory(workspace);
  const ls = project.getLanguageService().compilerObject;
  const allErrors: ReturnType<typeof ls.getSemanticDiagnostics> = [];
  for (const sf of project.getSourceFiles()) {
    const diags = ls.getSemanticDiagnostics(sf.getFilePath() as string);
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

function toDiagnostic(
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
