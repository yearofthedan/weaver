import * as fs from "node:fs";
import * as path from "node:path";
import { isWithinWorkspace } from "../security.js";
import { walkFiles } from "../utils/file-walk.js";
import { computeRelativeImportPath } from "../utils/relative-path.js";

/**
 * After a file move, scan all .vue files under searchRoot and rewrite any
 * relative imports that pointed to oldPath so they point to newPath instead.
 *
 * This is the "manual scan" approach: the TypeScript language service is blind
 * to imports inside <script> blocks in .vue SFCs, so we handle them ourselves.
 *
 * Returns the list of .vue files that were modified.
 */
export function updateVueImportsAfterMove(
  oldPath: string,
  newPath: string,
  searchRoot: string,
  workspace: string,
): string[] {
  const oldWithoutExt = stripExt(oldPath);
  const vueFiles = walkFiles(searchRoot, [".vue"]);
  const modified: string[] = [];

  for (const vueFile of vueFiles) {
    if (!isWithinWorkspace(vueFile, workspace)) continue;

    let content: string;
    try {
      content = fs.readFileSync(vueFile, "utf8");
    } catch {
      continue;
    }

    const updated = rewriteImports(content, vueFile, oldWithoutExt, newPath);
    if (updated !== content) {
      fs.writeFileSync(vueFile, updated, "utf8");
      modified.push(vueFile);
    }
  }

  return modified;
}

/**
 * Rewrite all `from '...'` / `from "..."` strings in `source` that resolve
 * to `oldPathNoExt`, replacing them with a new relative path to `newPath`.
 */
function rewriteImports(
  source: string,
  fromFile: string,
  oldPathNoExt: string,
  newPath: string,
): string {
  // Matches: from './foo'  from "../bar/baz"  (relative paths only)
  return source.replace(/\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g, (match, quote, importPath) => {
    const absImport = stripExt(path.resolve(path.dirname(fromFile), importPath));
    if (absImport !== oldPathNoExt) return match;

    const rel = computeRelativeImportPath(fromFile, newPath);
    return `from ${quote}${rel}${quote}`;
  });
}

/**
 * After a symbol move, scan all .vue files under searchRoot and rewrite any
 * named imports of `symbolName` from `sourceFile` so they point to `destFile`.
 *
 * Surgical: only the specific symbol's import is changed. If a .vue file imports
 * `symbolName` alongside other symbols from `sourceFile`, the import is split —
 * the other symbols stay on the original path, and `symbolName` gets a new import
 * from `destFile`.
 *
 * Returns the list of .vue files that were modified.
 */
export function updateVueNamedImportAfterSymbolMove(
  sourceFile: string,
  symbolName: string,
  destFile: string,
  searchRoot: string,
  workspace: string,
): string[] {
  const sourceNoExt = stripExt(sourceFile);
  const vueFiles = walkFiles(searchRoot, [".vue"]);
  const modified: string[] = [];

  for (const vueFile of vueFiles) {
    if (!isWithinWorkspace(vueFile, workspace)) continue;

    let content: string;
    try {
      content = fs.readFileSync(vueFile, "utf8");
    } catch {
      continue;
    }

    const updated = rewriteNamedSymbolImport(content, vueFile, symbolName, sourceNoExt, destFile);
    if (updated !== content) {
      fs.writeFileSync(vueFile, updated, "utf8");
      modified.push(vueFile);
    }
  }

  return modified;
}

/**
 * Rewrite `import { symbolName[, ...rest] } from '...'` entries in `source`
 * where the import path resolves to `sourceNoExt`.
 *
 * - Single symbol: replace the import path with the new relative path to destFile.
 * - Multiple symbols: remove symbolName from the original import, add a new
 *   import for symbolName from destFile.
 */
function rewriteNamedSymbolImport(
  source: string,
  fromFile: string,
  symbolName: string,
  sourceNoExt: string,
  destFile: string,
): string {
  return source.replace(
    /\bimport\s*\{([^}]*)\}\s*from\s*(['"])(\.\.?\/[^'"]+)\2/g,
    (match, specifiers, quote, importPath) => {
      const absImport = stripExt(path.resolve(path.dirname(fromFile), importPath));
      if (absImport !== sourceNoExt) return match;

      const specList = (specifiers as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Find the specifier that matches symbolName (handles "name" and "name as alias")
      const symbolIdx = specList.findIndex((s) => s.split(/\s+as\s+/)[0].trim() === symbolName);
      if (symbolIdx === -1) return match;

      const symbolSpec = specList[symbolIdx];
      const remaining = [...specList.slice(0, symbolIdx), ...specList.slice(symbolIdx + 1)];

      const relNew = computeRelativeImportPath(fromFile, destFile);

      if (remaining.length === 0) {
        return `import { ${symbolSpec} } from ${quote}${relNew}${quote}`;
      }
      // Split: keep remaining symbols on old path, add new import for moved symbol
      const oldImport = `import { ${remaining.join(", ")} } from ${quote}${importPath}${quote}`;
      const newImport = `import { ${symbolSpec} } from ${quote}${relNew}${quote}`;
      return `${oldImport}\n${newImport}`;
    },
  );
}

/**
 * After a file deletion, scan all .vue files under searchRoot and remove any
 * import or re-export lines whose module specifier resolves to deletedFile.
 *
 * Covers: named imports, type-only imports, namespace imports, default imports,
 * bare side-effect imports (`import './foo'`), and re-exports (`export * from`,
 * `export { } from`).
 *
 * Returns modified file paths, paths skipped due to workspace boundary, and
 * the total count of import/export declarations removed.
 */
export function removeVueImportsOfDeletedFile(
  deletedFile: string,
  searchRoot: string,
  workspace: string,
): { modified: string[]; skipped: string[]; refsRemoved: number } {
  const deletedNoExt = stripExt(deletedFile);
  const vueFiles = walkFiles(searchRoot, [".vue"]);
  const modified: string[] = [];
  const skipped: string[] = [];
  let refsRemoved = 0;

  for (const vueFile of vueFiles) {
    if (!isWithinWorkspace(vueFile, workspace)) {
      skipped.push(vueFile);
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(vueFile, "utf8");
    } catch {
      continue;
    }

    const { content: updated, removed } = removeImportLines(content, vueFile, deletedNoExt);
    if (removed > 0) {
      fs.writeFileSync(vueFile, updated, "utf8");
      modified.push(vueFile);
      refsRemoved += removed;
    }
  }

  return { modified, skipped, refsRemoved };
}

/**
 * Remove lines containing `import … from 'rel'`, `export … from 'rel'`, or
 * bare `import 'rel'` where `rel` resolves to `targetNoExt`.
 *
 * Line-based regex — does not parse template-level import() expressions.
 * Consistent with how updateVueImportsAfterMove works.
 */
function removeImportLines(
  source: string,
  fromFile: string,
  targetNoExt: string,
): { content: string; removed: number } {
  let removed = 0;
  const fromDir = path.dirname(fromFile);

  // Match import/export lines that contain `from 'relative-path'`
  let result = source.replace(
    /^[^\S\r\n]*(?:import|export)\b[^\r\n]*?\bfrom\s+(['"])(\.\.?\/[^'"]+)\1[^\r\n]*[\r\n]*/gm,
    (match, _q, specifier) => {
      const absImport = stripExt(path.resolve(fromDir, specifier as string));
      if (absImport !== targetNoExt) return match;
      removed++;
      return "";
    },
  );

  // Match bare side-effect imports: `import './foo'` (no `from` keyword)
  result = result.replace(
    /^[^\S\r\n]*import\s+(['"])(\.\.?\/[^'"]+)\1[^\r\n]*[\r\n]*/gm,
    (match, _q, specifier) => {
      const absImport = stripExt(path.resolve(fromDir, specifier as string));
      if (absImport !== targetNoExt) return match;
      removed++;
      return "";
    },
  );

  return { content: result, removed };
}

function stripExt(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}
