import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { applyTextEdits, lineColToOffset } from "../utils/text-utils.js";
import type { TsMorphEngine } from "./engine.js";
import { applyExtractSymbol } from "./extract-symbol.js";
import type { ExtractFunctionResult } from "./types.js";

/**
 * Full extractFunction workflow for TypeScript/JavaScript files.
 *
 * Delegates parameter inference, return-value detection, type annotation,
 * and async propagation to the TypeScript language service's built-in
 * "Extract Symbol" refactor. The caller provides the desired function name;
 * the auto-generated name is replaced in the edits before writing to disk.
 *
 * Precondition: `file` must exist (validated by the operation layer).
 * TS/TSX only — `.vue` paths are rejected by `VolarEngine` before reaching here.
 */
export async function tsExtractFunction(
  engine: TsMorphEngine,
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  functionName: string,
  scope: WorkspaceScope,
): Promise<ExtractFunctionResult> {
  const content = scope.fs.readFile(file);

  let startOffset: number;
  let endOffset: number;
  try {
    startOffset = lineColToOffset(content, startLine, startCol);
    endOffset = lineColToOffset(content, endLine, endCol);
  } catch (e) {
    throw new EngineError(
      e instanceof RangeError ? e.message : "Invalid selection range",
      "NOT_SUPPORTED",
    );
  }

  const ls = engine.getLanguageServiceForFile(file);
  // startOffset and endOffset are inclusive byte offsets. The TypeScript language service
  // uses exclusive TextRange.end, so we add 1 to convert.
  const range = { pos: startOffset, end: endOffset + 1 };
  const modifiedEdits = applyExtractSymbol(ls, file, range, content, functionName);

  for (const fileEdit of modifiedEdits) {
    if (!scope.contains(fileEdit.fileName)) {
      scope.recordSkipped(fileEdit.fileName);
      continue;
    }
    const original = scope.fs.readFile(fileEdit.fileName);
    const updated = applyTextEdits(original, fileEdit.textChanges);
    scope.writeFile(fileEdit.fileName, updated);
  }

  engine.invalidateProject(file);
  const extracted = engine.getFunction(file, functionName);
  if (!extracted) {
    throw new EngineError(
      `Extracted function '${functionName}' not found after writing — this is a bug`,
      "INTERNAL_ERROR",
    );
  }
  const parameterCount = extracted.parameters.length;

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    functionName,
    parameterCount,
  };
}
