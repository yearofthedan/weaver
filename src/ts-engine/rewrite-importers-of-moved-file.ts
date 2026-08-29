import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { FileSystem } from "../ports/filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { JS_EXTENSIONS, JS_TS_PAIRS } from "../utils/extensions.js";
import { toRelBase } from "../utils/relative-path.js";
import { createThrowawaySourceFile } from "./throwaway-project.js";

const nodeFs = new NodeFileSystem();

/**
 * Returns true if `specifier` has a JS-family extension and resolves to a real
 * file on disk at `fromDir`. Used to suppress rewrites of imports that genuinely
 * target a `.js` file rather than aliasing a `.ts` source.
 */
export function isCoexistingJsFile(specifier: string, fromDir: string, fs: FileSystem): boolean {
  if (!JS_EXTENSIONS.has(path.extname(specifier))) return false;
  return fs.exists(path.resolve(fromDir, specifier));
}

/**
 * Returns true if the text span at `start`/`length` in `fileName` is a JS-family import
 * specifier that resolves to a real file on disk — the edit must be suppressed.
 *
 * TypeScript resolves `./x.js` to `x.ts` whenever the `.js` is not itself in the program,
 * under every `moduleResolution` mode, and so offers to repoint it when `x.ts` moves. That
 * is wrong whenever the `.js` beside it is a real hand-written file staying put, which is
 * what this check restores.
 */
export function isCoexistingJsFileEdit(fileName: string, start: number, length: number): boolean {
  // Reads disk directly rather than through a scope: both call sites are inside
  // `Engine.getEditsForFileRename`, which carries no WorkspaceScope to thread one from.
  let content: string;
  try {
    content = nodeFs.readFile(fileName);
  } catch {
    return false;
  }
  return isCoexistingJsFile(content.slice(start, start + length), path.dirname(fileName), nodeFs);
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
      if (isCoexistingJsFile(specifier, fromDir, scope.fs)) return null;
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
