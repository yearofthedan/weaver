import * as fs from "node:fs";
import * as path from "node:path";
import { ts } from "ts-morph";
import type { TsMorphCompiler } from "../compilers/ts.js";
import { isWithinWorkspace } from "../security.js";
import type { GetTypeErrorsResult, PostWriteDiagnostics, TypeDiagnostic } from "../types.js";
import { EngineError } from "../utils/errors.js";

const TS_FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

const MAX_DIAGNOSTICS = 100;

export async function getTypeErrors(
  compiler: TsMorphCompiler,
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
    return getForFile(compiler, absPath);
  }
  return getForProject(compiler, workspace);
}

/**
 * Check type errors only in the given files and return the three post-write
 * diagnostic fields. Non-TS files are silently skipped. Results are capped at
 * MAX_DIAGNOSTICS total across all files; typeErrorCount reflects the true total.
 */
export function getTypeErrorsForFiles(
  compiler: TsMorphCompiler,
  files: string[],
): PostWriteDiagnostics {
  const tsFiles = files.filter((f) => TS_FILE_EXTENSIONS.has(path.extname(f)));

  let totalCount = 0;
  const allDiagnostics: TypeDiagnostic[] = [];

  for (const file of tsFiles) {
    if (!fs.existsSync(file)) continue;

    const project = compiler.getProjectForFile(file);
    const existing = project.getSourceFile(file);
    if (!existing) {
      project.addSourceFileAtPath(file);
    } else {
      existing.refreshFromFileSystemSync();
    }

    const ls = project.getLanguageService().compilerObject;
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

function getForFile(compiler: TsMorphCompiler, absPath: string): GetTypeErrorsResult {
  const project = compiler.getProjectForFile(absPath);
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

function getForProject(compiler: TsMorphCompiler, workspace: string): GetTypeErrorsResult {
  const project = compiler.getProjectForDirectory(workspace);
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
