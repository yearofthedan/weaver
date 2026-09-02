import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { FileSystem } from "../ports/filesystem.js";
import { TS_EXTENSIONS } from "../utils/extensions.js";
import { walkRecursive } from "../utils/file-walk.js";
import { tsAfterFileRename } from "./after-file-rename.js";
import { applyRenameEdits, mergeFileEdits } from "./apply-rename-edits.js";
import type { TsMorphEngine } from "./engine.js";
import type { FileTextEdit } from "./types.js";

/**
 * Full moveDirectory workflow for TypeScript/JavaScript projects.
 *
 * Computes import edits for all source files before any physical move,
 * applies external edits, atomically renames the directory on disk, updates
 * the project graph for each moved source file, and records all moved files
 * (source and non-source) in scope.
 *
 * Precondition: `oldPath` must exist and be a valid directory.
 */
export async function tsMoveDirectory(
  engine: TsMorphEngine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<{ filesMoved: string[] }> {
  const absOld = path.resolve(oldPath);
  const absNew = path.resolve(newPath);
  const project = engine.getProjectForDirectory(absOld);

  const sourceFiles = enumerateSourceFiles(absOld, scope.fs);
  for (const filePath of sourceFiles) {
    if (!project.getSourceFile(filePath)) {
      project.addSourceFileAtPath(filePath);
    }
  }

  const mappings = sourceFiles.map((oldFilePath) => ({
    oldFilePath,
    newFilePath: path.join(absNew, path.relative(absOld, oldFilePath)),
  }));

  const allEdits: FileTextEdit[][] = [];
  for (const { oldFilePath, newFilePath } of mappings) {
    allEdits.push(await engine.getEditsForFileRename(oldFilePath, newFilePath));
  }

  // Filter out edits targeting files inside the moved directory — the language
  // service doesn't know about the batch move and would corrupt intra-directory
  // specifiers that are still valid after the move.
  const externalEdits = mergeFileEdits(allEdits).filter(
    (e) => !e.fileName.startsWith(absOld + path.sep) && e.fileName !== absOld,
  );
  applyRenameEdits(engine, externalEdits, scope);

  scope.fs.mkdir(path.dirname(absNew), { recursive: true });
  scope.fs.rename(absOld, absNew);

  for (const { oldFilePath, newFilePath } of mappings) {
    await tsAfterFileRename(engine, oldFilePath, newFilePath, scope);
  }

  // Enumerate all files now at absNew (source + non-source, skipping SKIP_DIRS)
  const filesMoved: string[] = [];
  for (const newFilePath of walkRecursive(absNew, scope.fs)) {
    scope.recordModified(newFilePath);
    filesMoved.push(newFilePath);
  }

  return { filesMoved };
}

/**
 * Deliberately walks recursively rather than via `walkFiles`, which would drop
 * gitignored files: a generated-but-ignored source file inside the moved
 * directory still imports its neighbours, and those imports still need
 * rewriting. Untracked files are not the difference — `git ls-files --others`
 * reports those either way.
 */
function enumerateSourceFiles(dir: string, fs: FileSystem): string[] {
  return walkRecursive(dir, fs).filter((f) => TS_EXTENSIONS.has(path.extname(f)));
}
