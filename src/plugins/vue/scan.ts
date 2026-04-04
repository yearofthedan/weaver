import * as path from "node:path";
import { parse } from "@vue/language-core";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import { ImportRewriter } from "../../ts-engine/import-rewriter.js";
import { stripExt } from "../../utils/extensions.js";
import { walkFiles } from "../../utils/file-walk.js";
import { computeRelativeImportPath } from "../../utils/relative-path.js";

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
  scope: WorkspaceScope,
): void {
  const oldWithoutExt = stripExt(oldPath);
  const vueFiles = walkFiles(searchRoot, [".vue"]);

  for (const vueFile of vueFiles) {
    if (!scope.contains(vueFile)) continue;

    let content: string;
    try {
      content = scope.fs.readFile(vueFile);
    } catch {
      scope.recordSkipped(vueFile);
      continue;
    }

    const updated = rewriteImports(content, vueFile, oldWithoutExt, newPath);
    if (updated !== content) {
      scope.writeFile(vueFile, updated);
    }
  }
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
 * named imports of symbolName that reference sourceFile so they point to
 * destFile instead. Files already listed in scope.modified are skipped.
 *
 * This is the "manual scan" approach: the TypeScript language service is blind
 * to imports inside <script> blocks in .vue SFCs, so we handle them ourselves.
 */
export function updateVueImportsAfterSymbolMove(
  symbolName: string,
  sourceFile: string,
  destFile: string,
  searchRoot: string,
  scope: WorkspaceScope,
): void {
  const rewriter = new ImportRewriter();
  const alreadyModified = new Set(scope.modified);

  for (const vueFile of walkFiles(searchRoot, [".vue"])) {
    if (alreadyModified.has(vueFile)) continue;

    const fileContent = scope.fs.readFile(vueFile);
    const { descriptor } = parse(fileContent);
    const block = descriptor.script ?? descriptor.scriptSetup;
    if (!block) continue;

    const { start, end } = block.loc;
    const scriptContent = fileContent.slice(start.offset, end.offset);
    const rewritten = rewriter.rewriteScript(
      vueFile,
      scriptContent,
      symbolName,
      sourceFile,
      destFile,
      scope,
    );
    if (rewritten !== null) {
      scope.writeFile(
        vueFile,
        fileContent.slice(0, start.offset) + rewritten + fileContent.slice(end.offset),
      );
    }
  }
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
  scope: WorkspaceScope,
): { modified: string[]; skipped: string[]; refsRemoved: number } {
  const deletedNoExt = stripExt(deletedFile);
  const vueFiles = walkFiles(searchRoot, [".vue"]);
  const modified: string[] = [];
  const skipped: string[] = [];
  let refsRemoved = 0;

  for (const vueFile of vueFiles) {
    if (!scope.contains(vueFile)) {
      skipped.push(vueFile);
      continue;
    }

    let content: string;
    try {
      content = scope.fs.readFile(vueFile);
    } catch {
      scope.recordSkipped(vueFile);
      continue;
    }

    const { content: updated, removed } = removeImportLines(content, vueFile, deletedNoExt);
    if (removed > 0) {
      scope.writeFile(vueFile, updated);
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
