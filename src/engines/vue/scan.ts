import * as fs from "node:fs";
import * as path from "node:path";
import { isWithinWorkspace } from "../../workspace.js";
import { walkFiles } from "../file-walk.js";

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
): string[] {
  const oldWithoutExt = stripExt(oldPath);
  const vueFiles = walkFiles(searchRoot, [".vue"]);
  const modified: string[] = [];

  for (const vueFile of vueFiles) {
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

    let rel = path.relative(path.dirname(fromFile), stripExt(newPath));
    rel = rel.replace(/\\/g, "/"); // normalise Windows separators
    if (!rel.startsWith(".")) rel = `./${rel}`;

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

      let relNew = path.relative(path.dirname(fromFile), stripExt(destFile));
      relNew = relNew.replace(/\\/g, "/");
      if (!relNew.startsWith(".")) relNew = `./${relNew}`;

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

function stripExt(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}
