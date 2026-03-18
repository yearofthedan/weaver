import * as path from "node:path";
import { createThrowawaySourceFile } from "../compilers/throwaway-project.js";
import { JS_EXTENSIONS, JS_TS_PAIRS } from "../utils/extensions.js";
import { toRelBase } from "../utils/relative-path.js";
import type { WorkspaceScope } from "./workspace-scope.js";

/**
 * Returns true if `specifier` has a JS-family extension and resolves to a real
 * file on disk at `fromDir`. Used to suppress rewrites of imports that genuinely
 * target a `.js` file rather than aliasing a `.ts` source.
 */
export function isCoexistingJsFile(
  specifier: string,
  fromDir: string,
  scope: WorkspaceScope,
): boolean {
  if (!JS_EXTENSIONS.has(path.extname(specifier))) return false;
  return scope.fs.exists(path.resolve(fromDir, specifier));
}

/**
 * Given a parsed import specifier, return the rewritten specifier if it matches
 * the old path base, or `null` if no rewrite is needed.
 *
 * JS-family extensions (`.js`, `.jsx`, `.mjs`, `.cjs`) are only rewritten when
 * no real file with that extension exists at `fromDir`.
 */
export function rewriteSpecifier(
  specifier: string,
  relOldBase: string,
  relNewBase: string,
  fromDir: string,
  scope: WorkspaceScope,
): string | null {
  if (specifier === relOldBase) return relNewBase;

  for (const [jsExt, tsExt] of JS_TS_PAIRS) {
    if (specifier === relOldBase + jsExt) {
      if (isCoexistingJsFile(specifier, fromDir, scope)) return null;
      return relNewBase + jsExt;
    }
    if (specifier === relOldBase + tsExt) return relNewBase + tsExt;
  }

  return null;
}

/**
 * Walks `candidateFiles` and rewrites any import or re-export specifier that
 * points at `oldPath` to point at `newPath` instead.
 *
 * Files already in `alreadyModified` are skipped to prevent double-rewrites.
 * Files outside the workspace boundary are recorded as skipped via `scope.recordSkipped`.
 *
 * Pass the result of `walkFiles(scope.root, [...TS_EXTENSIONS])` as `candidateFiles`
 * when calling from a compiler. Unit tests may pass an explicit list.
 */
export function rewriteImportersOfMovedFile(
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
  candidateFiles: string[],
): void {
  const alreadyModified = new Set(scope.modified);

  for (const filePath of candidateFiles) {
    if (alreadyModified.has(filePath)) continue;
    if (!scope.contains(filePath)) {
      scope.recordSkipped(filePath);
      continue;
    }

    const fromDir = path.dirname(filePath);
    const relOldBase = toRelBase(fromDir, oldPath);
    const relNewBase = toRelBase(fromDir, newPath);

    const raw = scope.fs.readFile(filePath);
    const sf = createThrowawaySourceFile(filePath, raw);
    let hasChanges = false;

    for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      const specifier = decl.getModuleSpecifierValue();
      if (specifier === undefined) continue;
      const replacement = rewriteSpecifier(specifier, relOldBase, relNewBase, fromDir, scope);
      if (replacement !== null) {
        decl.setModuleSpecifier(replacement);
        hasChanges = true;
      }
    }

    if (!hasChanges) continue;

    scope.writeFile(filePath, sf.getFullText());
  }
}
