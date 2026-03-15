import * as path from "node:path";
import { Project } from "ts-morph";
import type { WorkspaceScope } from "./workspace-scope.js";

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

/**
 * Returns true if `specifier` resolves to an existing file when treated as
 * relative to `fromDir`. Checks the bare path and common source extensions.
 */
function resolvedFromDirExists(fromDir: string, specifier: string, scope: WorkspaceScope): boolean {
  const base = path.resolve(fromDir, specifier);
  if (scope.fs.exists(base)) return true;
  for (const ext of RESOLVABLE_EXTENSIONS) {
    if (scope.fs.exists(base + ext)) return true;
  }
  return false;
}

/**
 * Rewrites all relative import and re-export specifiers inside a moved file
 * so they resolve correctly from the new directory.
 *
 * Call this after the physical file move. Returns early if either `newPath`
 * or `oldPath` is already in `scope.modified` — `oldPath` being modified
 * means `getEditsForFileRename` rewrote the file's own imports before the
 * physical move (the rewritten content travels with the rename), so no
 * further rewrite is needed.
 *
 * Only specifiers starting with `.` are touched — bare module specifiers
 * (`"vitest"`, `"node:path"`) are left unchanged. The original extension on
 * each specifier is preserved as-is.
 */
export function rewriteMovedFileOwnImports(
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): void {
  if (scope.modified.includes(newPath)) return;
  if (scope.modified.includes(oldPath)) return;
  if (!scope.fs.exists(newPath)) return;

  const content = scope.fs.readFile(newPath);
  const oldDir = path.dirname(oldPath);
  const newDir = path.dirname(newPath);

  const tmpProject = new Project({ useInMemoryFileSystem: true });
  const sf = tmpProject.createSourceFile(newPath, content);
  let hasChanges = false;

  for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier || !specifier.startsWith(".")) continue;

    // If the specifier already resolves correctly from the new location
    // (e.g. a companion file moved alongside this one), no rewrite needed.
    if (resolvedFromDirExists(newDir, specifier, scope)) continue;

    const resolvedAbsolute = path.resolve(oldDir, specifier);
    let newSpecifier = path.relative(newDir, resolvedAbsolute);
    newSpecifier = newSpecifier.replace(/\\/g, "/");
    if (!newSpecifier.startsWith(".")) newSpecifier = `./${newSpecifier}`;

    if (newSpecifier !== specifier) {
      decl.setModuleSpecifier(newSpecifier);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    scope.writeFile(newPath, sf.getFullText());
  }
}
