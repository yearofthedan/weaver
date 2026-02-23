import * as fs from "node:fs";
import * as path from "node:path";
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

function stripExt(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}
