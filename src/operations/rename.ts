import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { EngineError } from "../utils/errors.js";
import { applyTextEdits } from "../utils/text-utils.js";
import type { RenameResult } from "./types.js";

export async function rename(
  compiler: Engine,
  filePath: string,
  line: number,
  col: number,
  newName: string,
  scope: WorkspaceScope,
): Promise<RenameResult> {
  const absPath = assertFileExists(filePath);

  const offset = compiler.resolveOffset(absPath, line, col);
  // getRenameLocations throws RENAME_NOT_ALLOWED when appropriate.
  const locs = await compiler.getRenameLocations(absPath, offset);

  if (!locs) {
    throw new EngineError(
      `No renameable symbol at line ${line}, col ${col} in ${filePath}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  // Determine the original symbol name from the first translated location.
  const firstLoc = locs[0];
  const firstContent = compiler.readFile(firstLoc.fileName);
  const oldName = firstContent.slice(
    firstLoc.textSpan.start,
    firstLoc.textSpan.start + firstLoc.textSpan.length,
  );

  // Group edits by file.
  const editsByFile = new Map<
    string,
    { span: { start: number; length: number }; newText: string }[]
  >();
  for (const loc of locs) {
    let fileEdits = editsByFile.get(loc.fileName);
    if (!fileEdits) {
      fileEdits = [];
      editsByFile.set(loc.fileName, fileEdits);
    }
    fileEdits.push({ span: loc.textSpan, newText: newName });
  }

  for (const [fileName, edits] of editsByFile) {
    if (!scope.contains(fileName)) {
      scope.recordSkipped(fileName);
      continue;
    }
    const original = compiler.readFile(fileName);
    const updated = applyTextEdits(original, edits);
    scope.writeFile(fileName, updated);
    compiler.notifyFileWritten(fileName, updated);
  }

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    symbolName: oldName,
    newName,
    locationCount: locs.length,
  };
}
