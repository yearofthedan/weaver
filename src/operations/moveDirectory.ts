import * as path from "node:path";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { FileSystem } from "../ports/filesystem.js";
import type { Engine } from "../ts-engine/types.js";
import type { MoveDirectoryResult } from "./types.js";

function isNonEmptyDir(absPath: string, fs: FileSystem): boolean {
  // readdir throws for a missing path or a file — both mean "not a non-empty dir".
  try {
    return fs.readdir(absPath).length > 0;
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
  const absOld = path.resolve(oldPath);
  const absNew = path.resolve(newPath);

  if (!scope.fs.exists(absOld)) {
    throw new EngineError(`Directory not found: ${absOld}`, "FILE_NOT_FOUND");
  }
  if (!scope.fs.stat(absOld).isDirectory()) {
    throw new EngineError(`Path is not a directory: ${absOld}`, "NOT_A_DIRECTORY");
  }

  const rel = path.relative(absOld, absNew);
  if (!rel.startsWith("..")) {
    throw new EngineError(`Cannot move a directory into itself: ${absNew}`, "MOVE_INTO_SELF");
  }

  if (isNonEmptyDir(absNew, scope.fs)) {
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
