import type { TsMorphCompiler } from "../compilers/ts.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
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
  tsCompiler: TsMorphCompiler,
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  functionName: string,
  scope: WorkspaceScope,
): Promise<ExtractFunctionResult> {
  const absFile = assertFileExists(file);

  if (absFile.endsWith(".vue")) {
    throw new EngineError(
      "extractFunction is not supported for .vue files; use a .ts or .tsx file",
      "NOT_SUPPORTED",
    );
  }

  const content = scope.fs.readFile(absFile);

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

  const project = tsCompiler.getProjectForFile(absFile);
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
  for (const fileEdit of modifiedEdits) {
    if (!scope.contains(fileEdit.fileName)) {
      scope.recordSkipped(fileEdit.fileName);
      continue;
    }
    const original = scope.fs.readFile(fileEdit.fileName);
    const updated = applyTextEdits(original, fileEdit.textChanges);
    scope.writeFile(fileEdit.fileName, updated);
  }

  // Count parameters by reloading the file via a fresh project.
  tsCompiler.invalidateProject(absFile);
  const parameterCount = countParameters(tsCompiler, absFile, functionName);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    functionName,
    parameterCount,
  };
}

function countParameters(
  tsCompiler: TsMorphCompiler,
  absFile: string,
  functionName: string,
): number {
  const project = tsCompiler.getProjectForFile(absFile);
  let sf = project.getSourceFile(absFile);
  if (!sf) {
    sf = project.addSourceFileAtPath(absFile);
  }
  return sf.getFunction(functionName)?.getParameters().length ?? 0;
}
