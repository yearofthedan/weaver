import type { Engine, FileTextEdit } from "../ts-engine/types.js";
import { applyTextEdits } from "../utils/text-utils.js";
import type { WorkspaceScope } from "./workspace-scope.js";

/**
 * Apply an array of file text edits produced by `getEditsForFileRename`.
 * Files outside the workspace boundary are recorded as skipped.
 * Files inside the boundary are written and the compiler is notified.
 */
export function applyRenameEdits(
  compiler: Engine,
  edits: FileTextEdit[],
  scope: WorkspaceScope,
): void {
  for (const edit of edits) {
    if (!scope.contains(edit.fileName)) {
      scope.recordSkipped(edit.fileName);
      continue;
    }
    const original = compiler.readFile(edit.fileName);
    const updated = applyTextEdits(original, edit.textChanges);
    scope.writeFile(edit.fileName, updated);
    compiler.notifyFileWritten(edit.fileName, updated);
  }
}

/**
 * Merge multiple `getEditsForFileRename` result sets into a single array keyed
 * by target file. When multiple edit sets target the same file, their
 * `textChanges` are concatenated and duplicate spans (same start + length +
 * newText) are removed — the TS language service may produce identical edits
 * when two files in the same directory are both renamed.
 */
export function mergeFileEdits(editSets: FileTextEdit[][]): FileTextEdit[] {
  const byFile = new Map<
    string,
    Map<string, { span: { start: number; length: number }; newText: string }>
  >();

  for (const { fileName, textChanges } of editSets.flat()) {
    let seen = byFile.get(fileName);
    if (!seen) {
      seen = new Map();
      byFile.set(fileName, seen);
    }
    for (const change of textChanges) {
      const key = `${change.span.start}:${change.span.length}:${change.newText}`;
      seen.set(key, change);
    }
  }

  return Array.from(byFile.entries()).map(([fileName, seen]) => ({
    fileName,
    textChanges: Array.from(seen.values()),
  }));
}
