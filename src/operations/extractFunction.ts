import * as fs from "node:fs";
import type { TsProvider } from "../providers/ts.js";
import { isWithinWorkspace } from "../security.js";
import type { ExtractFunctionResult } from "../types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { EngineError } from "../utils/errors.js";
import { applyTextEdits, lineColToOffset } from "../utils/text-utils.js";

/**
 * Extract a selection of statements from a TypeScript function into a new
 * named function at module scope.
 *
 * Delegates parameter inference, return-value detection, type annotation,
 * and async propagation to the TypeScript language service's built-in
 * "Extract Symbol" refactor. The caller provides the desired function name;
 * the auto-generated name is replaced in the edits before writing to disk.
 *
 * TS/TSX only. Returns `NOT_SUPPORTED` for `.vue` files.
 */
export async function extractFunction(
  tsProvider: TsProvider,
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  functionName: string,
  workspace: string,
): Promise<ExtractFunctionResult> {
  const absFile = assertFileExists(file);

  if (absFile.endsWith(".vue")) {
    throw new EngineError(
      "extractFunction is not supported for .vue files; use a .ts or .tsx file",
      "NOT_SUPPORTED",
    );
  }

  const content = fs.readFileSync(absFile, "utf8");

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

  const project = tsProvider.getProjectForFile(absFile);
  if (!project.getSourceFile(absFile)) {
    project.addSourceFileAtPath(absFile);
  }

  const ls = project.getLanguageService().compilerObject;

  // startOffset and endOffset are inclusive byte offsets (pointing at the first and
  // last characters of the selection). The TypeScript language service uses exclusive
  // TextRange.end, so we add 1 to convert the inclusive end to exclusive.
  const range = { pos: startOffset, end: endOffset + 1 };

  const refactors = ls.getApplicableRefactors(absFile, range, {});
  const extractRefactor = refactors.find((r) => r.name === "Extract Symbol");

  if (!extractRefactor) {
    throw new EngineError("No extractable code at the given selection", "NOT_SUPPORTED");
  }

  // function_scope_0 = innermost scope, function_scope_N = outermost (module) scope.
  // Pick the outermost applicable action.
  const applicable = extractRefactor.actions.filter(
    (a) => !a.notApplicableReason && /^function_scope_\d+$/.test(a.name),
  );

  if (applicable.length === 0) {
    const first = extractRefactor.actions.find((a) => /^function_scope_\d+$/.test(a.name));
    throw new EngineError(
      first?.notApplicableReason ?? "Cannot extract to a function at this location",
      "NOT_SUPPORTED",
    );
  }

  applicable.sort((a, b) => {
    const n = (name: string) => Number(name.replace("function_scope_", ""));
    return n(b.name) - n(a.name);
  });

  const targetAction = applicable[0];
  const editInfo = ls.getEditsForRefactor(
    absFile,
    {},
    range,
    "Extract Symbol",
    targetAction.name,
    {},
  );

  if (!editInfo?.edits?.length) {
    throw new EngineError("Extract function refactor produced no edits", "NOT_SUPPORTED");
  }

  // Determine the auto-generated function name from renameLocation.
  // renameLocation is the byte offset in the new file content (after applying edits)
  // where the generated identifier starts.
  let generatedName: string | undefined;
  const fileEdits = editInfo.edits.find((e) => e.fileName === absFile);

  if (editInfo.renameLocation !== undefined && fileEdits) {
    const newContent = applyTextEdits(content, fileEdits.textChanges);
    let end = editInfo.renameLocation;
    while (end < newContent.length && /[\w$]/.test(newContent[end])) {
      end++;
    }
    generatedName = newContent.slice(editInfo.renameLocation, end) || undefined;
  }

  // Replace the auto-generated name with the caller-provided name throughout all edits.
  const modifiedEdits = editInfo.edits.map((fileEdit) => ({
    ...fileEdit,
    textChanges: fileEdit.textChanges.map((change) => ({
      ...change,
      newText: generatedName
        ? change.newText.replaceAll(generatedName, functionName)
        : change.newText,
    })),
  }));

  // Apply edits to disk.
  const filesModified: string[] = [];
  for (const fileEdit of modifiedEdits) {
    if (!isWithinWorkspace(fileEdit.fileName, workspace)) continue;
    const original = fs.readFileSync(fileEdit.fileName, "utf8");
    const updated = applyTextEdits(original, fileEdit.textChanges);
    fs.writeFileSync(fileEdit.fileName, updated, "utf8");
    filesModified.push(fileEdit.fileName);
  }

  // Count parameters by reloading the file via a fresh project.
  tsProvider.invalidateProject(absFile);
  const parameterCount = countParameters(tsProvider, absFile, functionName);

  return {
    filesModified,
    filesSkipped: [],
    functionName,
    parameterCount,
  };
}

function countParameters(tsProvider: TsProvider, absFile: string, functionName: string): number {
  const project = tsProvider.getProjectForFile(absFile);
  let sf = project.getSourceFile(absFile);
  if (!sf) {
    sf = project.addSourceFileAtPath(absFile);
  }
  return sf.getFunction(functionName)?.getParameters().length ?? 0;
}
