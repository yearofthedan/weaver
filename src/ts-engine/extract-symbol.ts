import * as path from "node:path";
import type { ts } from "ts-morph";
import { EngineError } from "../domain/errors.js";
import { applyTextEdits } from "../utils/text-utils.js";

/**
 * Runs the TypeScript "Extract Symbol" refactor on an already-open language
 * service, substituting `functionName` for the compiler-generated identifier
 * throughout the returned edits.
 *
 * `fileName` identifies which edit in the returned set is the primary file;
 * matching uses `path.basename` so virtual in-memory paths ("/script.ts") and
 * real disk paths ("/tmp/foo/script.ts") resolve the same way.
 *
 * Throws `EngineError("NOT_SUPPORTED")` when no applicable extract action exists.
 */
export function applyExtractSymbol(
  ls: ts.LanguageService,
  fileName: string,
  range: ts.TextRange,
  content: string,
  functionName: string,
): ts.FileTextChanges[] {
  const refactors = ls.getApplicableRefactors(fileName, range, {});
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
    fileName,
    {},
    range,
    "Extract Symbol",
    targetAction.name,
    {},
  );

  if (!editInfo?.edits?.length) {
    throw new EngineError("Extract function refactor produced no edits", "NOT_SUPPORTED");
  }

  // renameLocation is the byte offset in the post-edit content where the generated
  // identifier starts. Walk forward to find its end, then slice out the name.
  let generatedName: string | undefined;
  const fileEdits = editInfo.edits.find(
    (e) => path.basename(e.fileName) === path.basename(fileName),
  );

  if (editInfo.renameLocation !== undefined && fileEdits) {
    const newContent = applyTextEdits(content, fileEdits.textChanges);
    let end = editInfo.renameLocation;
    while (end < newContent.length && /[\w$]/.test(newContent[end])) {
      end++;
    }
    generatedName = newContent.slice(editInfo.renameLocation, end) || undefined;
  }

  return editInfo.edits.map((edit) => ({
    ...edit,
    textChanges: edit.textChanges.map((change) => ({
      ...change,
      newText: generatedName
        ? change.newText.replaceAll(generatedName, functionName)
        : change.newText,
    })),
  }));
}
