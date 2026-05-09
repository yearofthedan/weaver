import * as path from "node:path";
import { Project } from "ts-morph";
import { EngineError } from "../../domain/errors.js";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { applyExtractSymbol } from "../../ts-engine/extract-symbol.js";
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

  const tempFileName = "script.ts";
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(tempFileName, scriptContent);
  const ls = project.getLanguageService().compilerObject;
  // startOffset/endOffset are inclusive; TS TextRange.end is exclusive.
  const range = { pos: startOffset, end: endOffset + 1 };

  const modifiedEdits = applyExtractSymbol(ls, tempFileName, range, scriptContent, functionName);

  let modifiedScriptContent = scriptContent;
  for (const edit of modifiedEdits) {
    if (path.basename(edit.fileName) === tempFileName) {
      modifiedScriptContent = applyTextEdits(modifiedScriptContent, edit.textChanges);
    }
  }

  const newVueContent =
    vueContent.slice(0, contentOffset) +
    modifiedScriptContent +
    vueContent.slice(contentOffset + scriptContent.length);

  scope.writeFile(file, newVueContent);

  const sf = createThrowawaySourceFile("check.ts", modifiedScriptContent);
  const parameterCount = sf.getFunction(functionName)?.getParameters().length ?? 0;

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    functionName,
    parameterCount,
  };
}
