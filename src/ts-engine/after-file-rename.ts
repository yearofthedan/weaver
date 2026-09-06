import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { TS_EXTENSIONS } from "../utils/extensions.js";
import { walkFiles } from "../utils/file-walk.js";
import type { TsMorphEngine } from "./engine.js";
import { rewriteImportersOfMovedFile } from "./rewrite-importers-of-moved-file.js";
import { rewriteMovedFileOwnImports } from "./rewrite-own-imports.js";

/**
 * Fallback scan run after the physical rename of a single source file.
 *
 * Incrementally updates the project graph so subsequent operations see the
 * file at its new location, rewrites the moved file's own relative imports,
 * and walks all workspace files to rewrite any import/export specifier still
 * pointing at the old path.
 */
export async function tsAfterFileRename(
  engine: TsMorphEngine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<void> {
  const project = engine.getCachedProjectForFile(newPath);
  if (project) {
    const oldSf = project.getSourceFile(oldPath);
    if (oldSf) {
      project.removeSourceFile(oldSf);
    }
    try {
      project.addSourceFileAtPath(newPath);
    } catch {
      // newPath may be outside tsconfig's include — that's fine; the fallback scan covers it.
    }
  }

  rewriteMovedFileOwnImports(oldPath, newPath, scope);

  rewriteImportersOfMovedFile(oldPath, newPath, scope, walkFiles(scope.root, [...TS_EXTENSIONS]));
}
