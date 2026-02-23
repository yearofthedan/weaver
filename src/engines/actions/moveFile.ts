import * as fs from "node:fs";
import * as path from "node:path";
import { isWithinWorkspace } from "../../workspace.js";
import { EngineError } from "../errors.js";
import { applyTextEdits } from "../text-utils.js";
import type { LanguageProvider, MoveResult } from "../types.js";

export async function moveFile(
  provider: LanguageProvider,
  oldPath: string,
  newPath: string,
  workspace: string,
): Promise<MoveResult> {
  const absOld = path.resolve(oldPath);
  const absNew = path.resolve(newPath);

  if (!fs.existsSync(absOld)) {
    throw new EngineError(`File not found: ${oldPath}`, "FILE_NOT_FOUND");
  }

  const edits = await provider.getEditsForFileRename(absOld, absNew);

  const filesModified = new Set<string>();
  const filesSkipped = new Set<string>();

  for (const edit of edits) {
    if (!isWithinWorkspace(edit.fileName, workspace)) {
      filesSkipped.add(edit.fileName);
      continue;
    }
    const original = provider.readFile(edit.fileName);
    const updated = applyTextEdits(original, edit.textChanges);
    fs.writeFileSync(edit.fileName, updated, "utf8");
    provider.notifyFileWritten(edit.fileName, updated);
    filesModified.add(edit.fileName);
  }

  // Physical move.
  const destDir = path.dirname(absNew);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.renameSync(absOld, absNew);

  // Provider cleanup (cache invalidation, post-move scans, etc.).
  const { modified: extraModified, skipped: extraSkipped } = await provider.afterFileRename(
    absOld,
    absNew,
    workspace,
  );

  for (const f of extraModified) {
    filesModified.add(f);
  }
  for (const f of extraSkipped) {
    filesSkipped.add(f);
  }

  filesModified.add(absNew);

  return {
    filesModified: Array.from(filesModified),
    filesSkipped: Array.from(filesSkipped),
    oldPath: absOld,
    newPath: absNew,
  };
}
