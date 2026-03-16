import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { applyRenameEdits, mergeFileEdits } from "../domain/apply-rename-edits.js";
import { ImportRewriter } from "../domain/import-rewriter.js";
import { rewriteImportersOfMovedFile } from "../domain/rewrite-importers-of-moved-file.js";
import { rewriteMovedFileOwnImports } from "../domain/rewrite-own-imports.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { Compiler, DefinitionLocation, FileTextEdit, SpanLocation } from "../types.js";
import { EngineError } from "../utils/errors.js";
import { JS_EXTENSIONS, TS_EXTENSIONS } from "../utils/extensions.js";
import { SKIP_DIRS, walkFiles } from "../utils/file-walk.js";
import { findTsConfig, findTsConfigForFile } from "../utils/ts-project.js";
import { tsMoveSymbol } from "./ts-move-symbol.js";

export class TsMorphCompiler implements Compiler {
  private projects = new Map<string, Project>();

  private getProject(filePath: string): Project {
    const tsConfigPath = findTsConfigForFile(filePath);
    const cacheKey = tsConfigPath ?? "__no_tsconfig__";
    let project = this.projects.get(cacheKey);
    if (!project) {
      if (tsConfigPath) {
        project = new Project({
          tsConfigFilePath: tsConfigPath,
          skipAddingFilesFromTsConfig: false,
        });
      } else {
        project = new Project({ useInMemoryFileSystem: false });
      }
      this.projects.set(cacheKey, project);
    }
    return project;
  }

  /** For operations that need direct AST access (e.g. moveSymbol). */
  getProjectForFile(filePath: string): Project {
    return this.getProject(filePath);
  }

  /**
   * Get the project covering the given workspace directory.
   * Unlike `getProjectForFile`, starts the tsconfig search from `dirPath` itself
   * rather than from its parent — correct when the caller has a directory, not a file.
   */
  getProjectForDirectory(dirPath: string): Project {
    const tsConfigPath = findTsConfig(dirPath);
    const cacheKey = tsConfigPath ?? "__no_tsconfig__";
    let project = this.projects.get(cacheKey);
    if (!project) {
      if (tsConfigPath) {
        project = new Project({
          tsConfigFilePath: tsConfigPath,
          skipAddingFilesFromTsConfig: false,
        });
      } else {
        project = new Project({ useInMemoryFileSystem: false });
      }
      this.projects.set(cacheKey, project);
    }
    return project;
  }

  invalidateProject(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.projects.delete(tsConfigPath ?? "__no_tsconfig__");
  }

  /**
   * Move a named export from `sourceFile` to `destFile`, updating all importers
   * within the workspace boundary defined by `scope`.
   *
   * Performs: symbol lookup, destination prep, importer snapshot, AST surgery,
   * import rewriting, dirty-file tracking, and file saving. Calls
   * `invalidateProject` internally after saving.
   */
  async moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
    options?: { force?: boolean },
  ): Promise<void> {
    return tsMoveSymbol(this, sourceFile, symbolName, destFile, scope, options);
  }

  /**
   * Refresh a single source file from disk without rebuilding the whole project.
   * Called by the watcher on `change` events; cheaper than full invalidation.
   */
  refreshFile(filePath: string): void {
    const key = findTsConfigForFile(filePath) ?? "__no_tsconfig__";
    const project = this.projects.get(key);
    if (!project) return; // project not loaded yet — nothing to refresh
    project.getSourceFile(filePath)?.refreshFromFileSystemSync();
  }

  resolveOffset(file: string, line: number, col: number): number {
    const project = this.getProject(file);
    let sourceFile = project.getSourceFile(file);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(file);
    }
    try {
      return sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${file}`, "SYMBOL_NOT_FOUND");
    }
  }

  async getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null> {
    const project = this.getProject(file);
    let sourceFile = project.getSourceFile(file);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(file);
    }

    const ls = project.getLanguageService().compilerObject;
    const resolvedPath = sourceFile.getFilePath();
    const renameInfo = ls.getRenameInfo(resolvedPath, offset, { allowRenameOfImportPath: false });
    if (!renameInfo.canRename) {
      throw new EngineError(
        renameInfo.localizedErrorMessage ?? "Symbol cannot be renamed",
        "RENAME_NOT_ALLOWED",
      );
    }

    const locs = ls.findRenameLocations(resolvedPath, offset, false, false, {
      allowRenameOfImportPath: false,
    });
    if (!locs || locs.length === 0) return null;

    return locs.map((loc) => ({
      fileName: loc.fileName,
      textSpan: { start: loc.textSpan.start, length: loc.textSpan.length },
    }));
  }

  async getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null> {
    const project = this.getProject(file);
    let sourceFile = project.getSourceFile(file);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(file);
    }

    const ls = project.getLanguageService().compilerObject;
    const resolvedPath = sourceFile.getFilePath();
    const refs = ls.getReferencesAtPosition(resolvedPath, offset);
    if (!refs || refs.length === 0) return null;

    return refs.map((ref) => ({
      fileName: ref.fileName,
      textSpan: { start: ref.textSpan.start, length: ref.textSpan.length },
    }));
  }

  async getDefinitionAtPosition(
    file: string,
    offset: number,
  ): Promise<DefinitionLocation[] | null> {
    const project = this.getProject(file);
    let sourceFile = project.getSourceFile(file);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(file);
    }

    const ls = project.getLanguageService().compilerObject;
    const resolvedPath = sourceFile.getFilePath();
    const defs = ls.getDefinitionAtPosition(resolvedPath, offset);
    if (!defs || defs.length === 0) return null;

    return defs.map((def) => ({
      fileName: def.fileName,
      textSpan: { start: def.textSpan.start, length: def.textSpan.length },
      name: def.name,
    }));
  }

  async getEditsForFileRename(oldPath: string, newPath: string): Promise<FileTextEdit[]> {
    // Use the cached project so the in-memory graph reflects previous moves within the same
    // session. Rebuilding from scratch (via invalidateProject) would lose knowledge of files
    // moved in earlier calls and cause ENOENT when the language service tries to open them.
    const project = this.getProject(oldPath);
    if (!project.getSourceFile(oldPath)) {
      project.addSourceFileAtPath(oldPath);
    }

    // Resolve symlinks so paths match ts-morph's internal canonical paths.
    // Use real paths only for the TS language service call; preserve originals for
    // the physical rename and response paths.
    let realOldPath = oldPath;
    let realNewPath = newPath;
    try {
      realOldPath = fs.realpathSync(oldPath);
      // newPath does not exist yet; resolve its directory and reconstruct.
      const newDir = fs.realpathSync(path.dirname(newPath));
      realNewPath = path.join(newDir, path.basename(newPath));
    } catch {
      // If realpathSync fails (e.g. directory doesn't exist), fall back to originals.
      realOldPath = oldPath;
      realNewPath = newPath;
    }

    // Ensure the source file under the real path is in the project.
    if (realOldPath !== oldPath && !project.getSourceFile(realOldPath)) {
      project.addSourceFileAtPath(realOldPath);
    }

    const ls = project.getLanguageService().compilerObject;
    const edits = ls.getEditsForFileRename(realOldPath, realNewPath, {}, {});

    return edits
      .filter((e) => e.textChanges.length > 0)
      .map((e) => ({
        fileName: e.fileName,
        textChanges: e.textChanges
          .filter((c) => !isCoexistingJsFileEdit(e.fileName, c.span.start, c.span.length))
          .map((c) => ({
            span: { start: c.span.start, length: c.span.length },
            newText: c.newText,
          })),
      }))
      .filter((e) => e.textChanges.length > 0);
  }

  readFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
  }

  notifyFileWritten(_path: string, _content: string): void {
    // ts-morph reads from disk; no in-memory cache to update.
  }

  /**
   * Fallback scan run after a named symbol has been moved from `sourceFile` to `destFile`.
   *
   * The ts-morph project only covers files in `tsconfig.include`. This scan walks
   * all workspace TS/JS files and rewrites any named import or re-export of
   * `symbolName` from `sourceFile` that ts-morph missed — most commonly test
   * files and scripts excluded from the project by tsconfig.
   *
   * Files already in `scope.modified` are skipped to avoid double-rewriting.
   * Modified and skipped files are recorded directly into `scope`.
   */
  async afterSymbolMove(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
  ): Promise<void> {
    const alreadyModified = new Set(scope.modified);
    const files = walkFiles(scope.root, [...TS_EXTENSIONS]).filter((f) => !alreadyModified.has(f));
    new ImportRewriter().rewrite(files, symbolName, sourceFile, destFile, scope);
  }

  /**
   * Fallback scan run after the physical rename.
   *
   * Invalidates the project so subsequent operations see the file at its new
   * location, then walks all workspace files to rewrite any import/export
   * specifier still pointing at the old path. This catches cases the TS language
   * service misses — e.g. `.js` extension imports under `moduleResolution: "node"`,
   * or files added to disk after the project was loaded.
   *
   * `alreadyModified` skips files already rewritten by `getEditsForFileRename`
   * to prevent double-rewrites. Matching is exact (full specifier), not substring,
   * so `./utils` never matches `./my-utils`. For specifiers with a JS-family
   * extension (`.js`, `.jsx`, `.mjs`, `.cjs`), the rewrite is skipped if a real
   * file with that extension exists on disk alongside the moved `.ts` file —
   * that import refers to the JS file, not the TypeScript source.
   */
  async afterFileRename(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<void> {
    // Incrementally update the project graph so subsequent operations see the file at its new
    // location. Invalidating and rebuilding would lose knowledge of previous moves within the
    // same session and cause ENOENT on the next call.
    const tsConfigPath = findTsConfigForFile(newPath);
    const cacheKey = tsConfigPath ?? "__no_tsconfig__";
    const project = this.projects.get(cacheKey);
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

  /**
   * Move all source files from `oldPath` to `newPath` using the TS language
   * service for import rewriting. Computes all edits before any physical move
   * so the language service sees a consistent project state. Intra-directory
   * edits are filtered out — files that move together keep their relative imports.
   */
  async moveDirectory(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<{ filesMoved: string[] }> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);
    const project = this.getProjectForDirectory(absOld);

    const sourceFiles = enumerateSourceFiles(absOld);
    for (const filePath of sourceFiles) {
      if (!project.getSourceFile(filePath)) {
        project.addSourceFileAtPath(filePath);
      }
    }

    if (sourceFiles.length === 0) {
      return { filesMoved: [] };
    }

    const mappings = sourceFiles.map((oldFilePath) => ({
      oldFilePath,
      newFilePath: path.join(absNew, path.relative(absOld, oldFilePath)),
    }));

    const allEdits: FileTextEdit[][] = [];
    for (const { oldFilePath, newFilePath } of mappings) {
      allEdits.push(await this.getEditsForFileRename(oldFilePath, newFilePath));
    }

    // Filter out edits targeting files inside the moved directory — the language
    // service doesn't know about the batch move and would corrupt intra-directory
    // specifiers that are still valid after the move.
    const externalEdits = mergeFileEdits(allEdits).filter(
      (e) => !e.fileName.startsWith(absOld + path.sep) && e.fileName !== absOld,
    );
    applyRenameEdits(this, externalEdits, scope);

    fs.mkdirSync(path.dirname(absNew), { recursive: true });
    fs.renameSync(absOld, absNew);

    for (const { oldFilePath, newFilePath } of mappings) {
      await this.afterFileRename(oldFilePath, newFilePath, scope);
    }

    const filesMoved = mappings.map(({ newFilePath }) => newFilePath);
    for (const newFilePath of filesMoved) {
      scope.recordModified(newFilePath);
    }

    return { filesMoved };
  }
}

function enumerateSourceFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...enumerateSourceFiles(full));
    } else if (entry.isFile() && TS_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Returns true if the text span at `start`/`length` in `fileName` is a JS-family
 * import specifier that resolves to a real file on disk — the edit must be suppressed.
 */
function isCoexistingJsFileEdit(fileName: string, start: number, length: number): boolean {
  let content: string;
  try {
    content = fs.readFileSync(fileName, "utf8");
  } catch {
    return false;
  }
  const specifier = content.slice(start, start + length);
  if (!JS_EXTENSIONS.has(path.extname(specifier))) return false;
  return fs.existsSync(path.resolve(path.dirname(fileName), specifier));
}
