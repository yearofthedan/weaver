import * as fs from "node:fs";
import * as path from "node:path";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Engine } from "../ts-engine/types.js";
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

  const { filesMoved } = await compiler.moveDirectory(absOld, absNew, scope);

  return {
    filesMoved,
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    oldPath: absOld,
    newPath: absNew,
  };
}
