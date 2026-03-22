import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import type ts from "typescript";
import { ImportRewriter } from "../domain/import-rewriter.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { RenameResult } from "../operations/types.js";
import { EngineError } from "../utils/errors.js";
import { JS_EXTENSIONS, TS_EXTENSIONS } from "../utils/extensions.js";
import { walkFiles } from "../utils/file-walk.js";
import { findTsConfig, findTsConfigForFile } from "../utils/ts-project.js";
import { tsDeleteFile } from "./delete-file.js";
import { tsExtractFunction } from "./extract-function.js";
import { tsMoveDirectory } from "./move-directory.js";
import { tsMoveFile } from "./move-file.js";
import { tsMoveSymbol } from "./move-symbol.js";
import { tsRemoveImportersOf } from "./remove-importers.js";
import { tsRename } from "./rename.js";
import type {
  DefinitionLocation,
  DeleteFileActionResult,
  Engine,
  ExtractFunctionResult,
  FileTextEdit,
  MoveFileActionResult,
  SpanLocation,
} from "./types.js";

export class TsMorphEngine implements Engine {
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
   * Returns the cached project for the tsconfig that covers `filePath`, or
   * `undefined` if the project has not been loaded yet. Does not create a
   * new project — use `getProject` for that.
   */
  getCachedProjectForFile(filePath: string): import("ts-morph").Project | undefined {
    const tsConfigPath = findTsConfigForFile(filePath);
    return this.projects.get(tsConfigPath ?? "__no_tsconfig__");
  }

  /**
   * Removes all import and export declarations that reference `targetFile` from
   * every in-scope TS/JS file. Delegates to `tsRemoveImportersOf`.
   */
  async removeImportersOf(targetFile: string, scope: WorkspaceScope): Promise<number> {
    return tsRemoveImportersOf(this, targetFile, scope);
  }

  /**
   * Full delete workflow: delegates to `tsDeleteFile` which handles importer
   * removal, Vue SFC cleanup, physical deletion, and project cache invalidation.
   */
  async deleteFile(targetFile: string, scope: WorkspaceScope): Promise<DeleteFileActionResult> {
    return tsDeleteFile(this, targetFile, scope);
  }

  /**
   * Full moveFile workflow: delegates to `tsMoveFile` which handles import
   * rewriting, physical move, project graph update, and fallback importer scan.
   */
  async moveFile(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<MoveFileActionResult> {
    return tsMoveFile(this, oldPath, newPath, scope);
  }

  /**
   * Ensures `filePath` is in the project, then returns the raw TypeScript
   * language service. Callers get compiler access without holding a `Project`
   * reference — no ts-morph coupling at the call site.
   */
  getLanguageServiceForFile(filePath: string): ts.LanguageService {
    const project = this.getProject(filePath);
    if (!project.getSourceFile(filePath)) {
      project.addSourceFileAtPath(filePath);
    }
    return project.getLanguageService().compilerObject;
  }

  /**
   * Same as `getLanguageServiceForFile` but resolves the project by searching
   * for a tsconfig starting from `dirPath` itself — correct when the caller has
   * a directory rather than a file.
   */
  getLanguageServiceForDirectory(dirPath: string): ts.LanguageService {
    const project = this.getProjectForDirectory(dirPath);
    return project.getLanguageService().compilerObject;
  }

  /**
   * Refreshes the given file from disk within its cached project.
   * If the file is already tracked, its content is re-read; if not, it is added.
   * No-op when the project for the file has not been loaded yet.
   */
  refreshSourceFile(filePath: string): void {
    const key = findTsConfigForFile(filePath) ?? "__no_tsconfig__";
    const project = this.projects.get(key);
    if (!project) return;
    const existing = project.getSourceFile(filePath);
    if (existing) {
      existing.refreshFromFileSystemSync();
    } else {
      project.addSourceFileAtPath(filePath);
    }
  }

  /**
   * Returns the file paths of all source files in the project that covers
   * `workspace`. Used by callers that need to iterate over project files
   * without holding a `Project` reference.
   */
  getProjectSourceFilePaths(workspace: string): string[] {
    const project = this.getProjectForDirectory(workspace);
    return project.getSourceFiles().map((sf) => sf.getFilePath() as string);
  }

  /**
   * Returns metadata for a named top-level function declaration in `filePath`,
   * or `undefined` if no such function exists. Ensures the source file is
   * loaded from disk so callers that have just written edits see the current state.
   */
  getFunction(
    filePath: string,
    functionName: string,
  ): { name: string; parameters: Array<{ name: string }> } | undefined {
    const project = this.getProject(filePath);
    let sf = project.getSourceFile(filePath);
    if (!sf) {
      sf = project.addSourceFileAtPath(filePath);
    }
    const fn = sf.getFunction(functionName);
    if (!fn) return undefined;
    return {
      name: fn.getName()!,
      parameters: fn.getParameters().map((p) => ({ name: p.getName() })),
    };
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
    await tsMoveSymbol(this, sourceFile, symbolName, destFile, scope, options);
    const alreadyModified = new Set(scope.modified);
    const files = walkFiles(scope.root, [...TS_EXTENSIONS]).filter((f) => !alreadyModified.has(f));
    new ImportRewriter().rewrite(files, symbolName, sourceFile, destFile, scope);
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
   * Full moveDirectory workflow: rewrite imports for all source files
   * atomically, physically move the entire directory tree (source and
   * non-source files), and record all moved files into scope.
   */
  async moveDirectory(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<{ filesMoved: string[] }> {
    return tsMoveDirectory(this, oldPath, newPath, scope);
  }

  /**
   * Full rename workflow: delegates to `tsRename` which resolves the symbol,
   * collects rename locations from the TS language service, and applies edits
   * within the workspace boundary.
   */
  async rename(
    file: string,
    line: number,
    col: number,
    newName: string,
    scope: WorkspaceScope,
  ): Promise<RenameResult> {
    return tsRename(this, file, line, col, newName, scope);
  }

  /**
   * Full extractFunction workflow: delegates to `tsExtractFunction` which
   * computes extraction edits via the TypeScript language service, substitutes
   * the caller-provided name, writes the result, and returns function metadata.
   */
  async extractFunction(
    file: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    functionName: string,
    scope: WorkspaceScope,
  ): Promise<ExtractFunctionResult> {
    return tsExtractFunction(this, file, startLine, startCol, endLine, endCol, functionName, scope);
  }
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
