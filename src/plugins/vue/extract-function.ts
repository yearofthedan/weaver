import * as path from "node:path";
import { Project } from "ts-morph";
import { EngineError } from "../../domain/errors.js";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { createThrowawaySourceFile } from "../../ts-engine/throwaway-project.js";
import type { ExtractFunctionResult } from "../../ts-engine/types.js";
import { applyTextEdits, lineColToOffset } from "../../utils/text-utils.js";

/**
 * Full extractFunction workflow for Vue SFC <script setup> blocks.
 *
 * Extracts the selected statements into a named function using the TypeScript
 * language service's "Extract Symbol" refactor, applied to an in-memory copy
 * of the <script setup> content. The result is spliced back into the .vue file
 * so that <template> and <style> blocks are byte-for-byte unchanged.
 *
 * Precondition: `file` must exist (validated by the operation layer).
 */
export async function vueExtractFunction(
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  functionName: string,
  scope: WorkspaceScope,
): Promise<ExtractFunctionResult> {
  const vueContent = scope.fs.readFile(file);

  const { parse } = await import("@vue/language-core");
  const { descriptor } = parse(vueContent);

  if (!descriptor.scriptSetup) {
    throw new EngineError(
      "extractFunction requires a <script setup> block in the .vue file",
      "NOT_SUPPORTED",
    );
  }

  const scriptContent = descriptor.scriptSetup.content;
  // loc.start.offset is the byte position right after the closing `>` of the opening tag.
  const contentOffset = descriptor.scriptSetup.loc.start.offset;

  let startOffset: number;
  let endOffset: number;
  try {
    startOffset = lineColToOffset(vueContent, startLine, startCol) - contentOffset;
    endOffset = lineColToOffset(vueContent, endLine, endCol) - contentOffset;
  } catch (e) {
    throw new EngineError(
      e instanceof RangeError ? e.message : "Invalid selection range",
      "NOT_SUPPORTED",
    );
  }

  if (startOffset < 0 || endOffset < 0) {
    throw new EngineError("Selection is outside the <script setup> block", "NOT_SUPPORTED");
  }

  // Run the TS extract refactor on an in-memory project containing only the script content.
  const tempFileName = "script.ts";
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(tempFileName, scriptContent);
  const ls = project.getLanguageService().compilerObject;

  // TS uses exclusive end; startOffset/endOffset are inclusive.
  const range = { pos: startOffset, end: endOffset + 1 };

  const refactors = ls.getApplicableRefactors(tempFileName, range, {});
  const extractRefactor = refactors.find((r) => r.name === "Extract Symbol");

  if (!extractRefactor) {
    throw new EngineError("No extractable code at the given selection", "NOT_SUPPORTED");
  }

  // function_scope_0 = innermost scope, function_scope_N = outermost (module) scope.
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
    tempFileName,
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
  let generatedName: string | undefined;
  const fileEdits = editInfo.edits.find((e) => path.basename(e.fileName) === tempFileName);

  if (editInfo.renameLocation !== undefined && fileEdits) {
    const newContent = applyTextEdits(scriptContent, fileEdits.textChanges);
    let end = editInfo.renameLocation;
    while (end < newContent.length && /[\w$]/.test(newContent[end])) {
      end++;
    }
    generatedName = newContent.slice(editInfo.renameLocation, end) || undefined;
  }

  // Replace the auto-generated name with the caller-provided name throughout all edits.
  const modifiedEdits = editInfo.edits.map((edit) => ({
    ...edit,
    textChanges: edit.textChanges.map((change) => ({
      ...change,
      newText: generatedName
        ? change.newText.replaceAll(generatedName, functionName)
        : change.newText,
    })),
  }));

  // Apply edits to the script content.
  let modifiedScriptContent = scriptContent;
  for (const edit of modifiedEdits) {
    if (path.basename(edit.fileName) === tempFileName) {
      modifiedScriptContent = applyTextEdits(modifiedScriptContent, edit.textChanges);
    }
  }

  // Reconstruct the .vue file: replace only the script block content.
  const newVueContent =
    vueContent.slice(0, contentOffset) +
    modifiedScriptContent +
    vueContent.slice(contentOffset + scriptContent.length);

  scope.writeFile(file, newVueContent);

  // Count parameters by parsing the updated script content.
  const sf = createThrowawaySourceFile("check.ts", modifiedScriptContent);
  const parameterCount = sf.getFunction(functionName)?.getParameters().length ?? 0;

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    functionName,
    parameterCount,
  };
}
