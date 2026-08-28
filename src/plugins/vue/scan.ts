import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "@vue/language-core";
import type { WorkspaceScope } from "../../domain/workspace-scope.js";
import type { FileSystem } from "../../ports/filesystem.js";
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

    const updated = rewriteImports(content, vueFile, oldPath, newPath, scope.fs);
    if (updated !== content) {
      scope.writeFile(vueFile, updated);
    }
  }
}

/**
 * Keep the specifier's own extension style. `computeRelativeImportPath` always emits one,
 * which is right for the TypeScript fallback scan that generates specifiers from scratch,
 * but here the original is in hand and an extensionless import must stay extensionless —
 * otherwise a move gives the file an extension the project never used, and moving it back
 * does not restore it.
 */
function specifierLike(original: string, fromFile: string, newPath: string): string {
  const rewritten = computeRelativeImportPath(fromFile, newPath);
  const hadExtension = /\.[^./]+$/.test(path.basename(original));
  return hadExtension ? rewritten : rewritten.replace(/\.[^./]+$/, "");
}

/**
 * Rewrite all `from '...'` / `from "..."` strings in `source` that name the file moved from
 * `oldPath`, pointing them at `newPath` instead.
 *
 * A specifier naming a file that is present on disk means *that* file, so it is repointed
 * only when it is the one that moved. Without the check, `./useCounter.js` and
 * `useCounter.ts` compare equal once their extensions are stripped, and an import of a
 * hand-written sibling `.js` is silently repointed at the TypeScript file — a different
 * module. Falling back to the extensionless comparison when nothing is there is what lets a
 * `.js` specifier resolve to the `.ts` that really backs it.
 */
function rewriteImports(
  source: string,
  fromFile: string,
  oldPath: string,
  newPath: string,
  files: FileSystem,
): string {
  const oldPathNoExt = stripExt(oldPath);
  // Matches: from './foo'  from "../bar/baz"  (relative paths only)
  return source.replace(/\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g, (match, quote, importPath) => {
    const absImport = path.resolve(path.dirname(fromFile), importPath);
    const namesTheMovedFile = files.exists(absImport)
      ? absImport === oldPath
      : stripExt(absImport) === oldPathNoExt;

    if (!namesTheMovedFile) return match;
    return `from ${quote}${specifierLike(importPath, fromFile, newPath)}${quote}`;
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

/**
 * After a .vue file is physically moved, rewrite any relative import specifiers
 * inside it that no longer resolve from the new location.
 *
 * Applies only to specifiers that:
 * 1. Start with `.` (relative imports only — bare specifiers are unchanged)
 * 2. Do NOT already resolve from the new directory (intra-directory imports that
 *    moved together are left unchanged)
 * 3. DO resolve from the old directory (i.e. they point outside the moved dir)
 *
 * This mirrors `rewriteMovedFileOwnImports` for TS files, but uses regex-based
 * rewriting to handle the Vue SFC format instead of ts-morph AST parsing.
 */
export function rewriteVueOwnImportsAfterMove(
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): void {
  if (!scope.fs.exists(newPath)) return;

  const content = scope.fs.readFile(newPath);
  const oldDir = path.dirname(oldPath);
  const newDir = path.dirname(newPath);

  const updated = content.replace(
    /\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (match, quote, importPath) => {
      // If the import already resolves from the new location, leave it (intra-dir).
      const resolvedFromNew = path.resolve(newDir, importPath);
      if (
        fs.existsSync(resolvedFromNew) ||
        fs.existsSync(`${resolvedFromNew}.ts`) ||
        fs.existsSync(`${resolvedFromNew}.vue`) ||
        fs.existsSync(`${resolvedFromNew}.js`)
      ) {
        return match;
      }

      // Compute the absolute target from the old location.
      const resolvedFromOld = path.resolve(oldDir, importPath);
      if (
        !fs.existsSync(resolvedFromOld) &&
        !fs.existsSync(`${resolvedFromOld}.ts`) &&
        !fs.existsSync(`${resolvedFromOld}.vue`) &&
        !fs.existsSync(`${resolvedFromOld}.js`)
      ) {
        return match;
      }

      // Rewrite to new relative path from new location, preserving any extension.
      let newRel = path.relative(newDir, resolvedFromOld).replace(/\\/g, "/");
      if (!newRel.startsWith(".")) newRel = `./${newRel}`;
      return `from ${quote}${newRel}${quote}`;
    },
  );

  if (updated !== content) {
    scope.writeFile(newPath, updated);
  }
}
