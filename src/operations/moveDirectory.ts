import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
import { EngineError } from "../utils/errors.js";
import { SKIP_DIRS } from "../utils/file-walk.js";
import type { MoveDirectoryResult } from "./types.js";

function resolveAbs(p: string): string {
  return path.resolve(p);
}

function statDir(absPath: string): fs.Stats | null {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

function isNonEmptyDir(absPath: string): boolean {
  try {
    const entries = fs.readdirSync(absPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function enumerateAllFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...enumerateAllFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export async function moveDirectory(
  compiler: Engine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<MoveDirectoryResult> {
  const absOld = resolveAbs(oldPath);
  const absNew = resolveAbs(newPath);

  const oldStat = statDir(absOld);
  if (!oldStat) {
    throw new EngineError(`Directory not found: ${absOld}`, "FILE_NOT_FOUND");
  }
  if (!oldStat.isDirectory()) {
    throw new EngineError(`Path is not a directory: ${absOld}`, "NOT_A_DIRECTORY");
  }

  const rel = path.relative(absOld, absNew);
  if (!rel.startsWith("..")) {
    throw new EngineError(`Cannot move a directory into itself: ${absNew}`, "MOVE_INTO_SELF");
  }

  if (isNonEmptyDir(absNew)) {
    throw new EngineError(
      `Destination already exists and is non-empty: ${absNew}`,
      "DESTINATION_EXISTS",
    );
  }

  // ── Enumerate all files before the compiler move ─────────────────────────
  // The compiler may do an OS-level directory rename, moving everything including
  // non-source files. We capture the non-source file list upfront so we can
  // track them in the result.
  const allFilesBefore = enumerateAllFiles(absOld);

  // ── Source files: atomic batch move via compiler ─────────────────────────
  const { filesMoved } = await compiler.moveDirectory(absOld, absNew, scope);

  // ── Non-source files: account for files not tracked by the compiler ───────
  // Files still at the old path need a physical move; files already at the new
  // path (moved atomically by the compiler's OS rename) just need recording.
  for (const oldFilePath of allFilesBefore) {
    const relPath = path.relative(absOld, oldFilePath);
    const newFilePath = path.join(absNew, relPath);
    if (filesMoved.includes(newFilePath)) continue; // already tracked as source file
    if (fs.existsSync(oldFilePath)) {
      // Still at old path — physically move it
      const destDir = path.dirname(newFilePath);
      if (!scope.fs.exists(destDir)) {
        scope.fs.mkdir(destDir, { recursive: true });
      }
      scope.fs.rename(oldFilePath, newFilePath);
    }
    // Record the destination regardless (moved by compiler or by us above)
    scope.recordModified(newFilePath);
    filesMoved.push(newFilePath);
  }

  return {
    filesMoved,
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    oldPath: absOld,
    newPath: absNew,
  };
}
