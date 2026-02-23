import * as fs from "node:fs";
import * as path from "node:path";
import { isWithinWorkspace } from "../security.js";
import type { LanguageProvider, RenameResult } from "../types.js";
import { EngineError } from "../utils/errors.js";
import { applyTextEdits } from "../utils/text-utils.js";

export async function rename(
  provider: LanguageProvider,
  filePath: string,
  line: number,
  col: number,
  newName: string,
  workspace: string,
): Promise<RenameResult> {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
  }

  const offset = provider.resolveOffset(absPath, line, col);
  // getRenameLocations throws RENAME_NOT_ALLOWED when appropriate.
  const locs = await provider.getRenameLocations(absPath, offset);

  if (!locs || locs.length === 0) {
    throw new EngineError(
      `No renameable symbol at line ${line}, col ${col} in ${filePath}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  // Determine the original symbol name from the first translated location.
  const firstLoc = locs[0];
  const firstContent = provider.readFile(firstLoc.fileName);
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
    if (!editsByFile.has(loc.fileName)) editsByFile.set(loc.fileName, []);
    editsByFile.get(loc.fileName)?.push({ span: loc.textSpan, newText: newName });
  }

  const filesModified = new Set<string>();
  const filesSkipped = new Set<string>();

  for (const [fileName, edits] of editsByFile) {
    if (!isWithinWorkspace(fileName, workspace)) {
      filesSkipped.add(fileName);
      continue;
    }
    const original = provider.readFile(fileName);
    const updated = applyTextEdits(original, edits);
    fs.writeFileSync(fileName, updated, "utf8");
    provider.notifyFileWritten(fileName, updated);
    filesModified.add(fileName);
  }

  return {
    filesModified: Array.from(filesModified),
    filesSkipped: Array.from(filesSkipped),
    symbolName: oldName,
    newName,
    locationCount: locs.length,
  };
}
