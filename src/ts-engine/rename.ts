import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { RenameResult } from "../operations/types.js";
import { applyTextEdits } from "../utils/text-utils.js";
import type { TsMorphEngine } from "./engine.js";

/**
 * Full rename workflow for TypeScript/JavaScript symbols.
 *
 * Resolves the offset, retrieves rename locations from the TS language service,
 * groups edits by file, applies boundary filtering, and writes updated files
 * through `scope`.
 *
 * Precondition: `file` must exist (validated by the operation layer).
 */
export async function tsRename(
  engine: TsMorphEngine,
  file: string,
  line: number,
  col: number,
  newName: string,
  scope: WorkspaceScope,
): Promise<RenameResult> {
  const offset = engine.resolveOffset(file, line, col);
  const locs = await engine.getRenameLocations(file, offset);

  if (!locs) {
    throw new EngineError(
      `No renameable symbol at line ${line}, col ${col} in ${file}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  const firstLoc = locs[0];
  const firstContent = engine.readFile(firstLoc.fileName);
  const oldName = firstContent.slice(
    firstLoc.textSpan.start,
    firstLoc.textSpan.start + firstLoc.textSpan.length,
  );

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
    const original = engine.readFile(fileName);
    const updated = applyTextEdits(original, edits);
    scope.writeFile(fileName, updated);
  }

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    symbolName: oldName,
    newName,
    locationCount: locs.length,
  };
}
