import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Compiler, MoveDirectoryResult } from "../types.js";
import { EngineError } from "../utils/errors.js";
import { VUE_EXTENSIONS } from "../utils/extensions.js";
import { SKIP_DIRS } from "../utils/file-walk.js";
import { moveFile } from "./moveFile.js";

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
  compiler: Compiler,
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

  const files = enumerateAllFiles(absOld);
  const filesMoved: string[] = [];

  for (const oldFilePath of files) {
    const relPath = path.relative(absOld, oldFilePath);
    const newFilePath = path.join(absNew, relPath);
    const ext = path.extname(oldFilePath);

    if (VUE_EXTENSIONS.has(ext)) {
      await moveFile(compiler, oldFilePath, newFilePath, scope);
    } else {
      const destDir = path.dirname(newFilePath);
      if (!scope.fs.exists(destDir)) {
        scope.fs.mkdir(destDir, { recursive: true });
      }
      scope.fs.rename(oldFilePath, newFilePath);
      scope.recordModified(newFilePath);
    }

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
