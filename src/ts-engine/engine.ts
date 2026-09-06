import * as fs from "node:fs";
import { Project } from "ts-morph";
import type ts from "typescript";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { GetTypeErrorsResult, RenameResult, SetExportResult } from "../operations/types.js";
import { TS_EXTENSIONS } from "../utils/extensions.js";
import { walkFiles } from "../utils/file-walk.js";
import { findTsConfig, findTsConfigForFile } from "../utils/ts-project.js";
import { tsDeleteFile } from "./delete-file.js";
import {
  buildDiagnosticService,
  type DiagnosticLanguageService,
  type DiagnosticService,
  DiagnosticServiceCache,
} from "./diagnostic-service.js";
import { tsExtractFunction } from "./extract-function.js";
import { tsGetTypeErrors } from "./get-type-errors.js";
import { tsMoveDirectory } from "./move-directory.js";
import { tsMoveFile } from "./move-file.js";
import { tsMoveSymbol } from "./move-symbol.js";
import { tsRemoveImportersOf } from "./remove-importers.js";
import { tsRename } from "./rename.js";
import { isCoexistingJsFileEdit } from "./rewrite-importers-of-moved-file.js";
import { tsSetExport } from "./set-export.js";
import type {
  DefinitionLocation,
  DeleteFileActionResult,
  Engine,
  ExtractFunctionResult,
  FileTextEdit,
  MoveFileActionResult,
  SpanLocation,
} from "./types.js";

/** Cache key for the project covering files with no tsconfig above them. */
const NO_TSCONFIG_CACHE_KEY = "__no_tsconfig__";

/** A cached project together with its seed — see `typeCheckedFiles` for the seed's contract. */
interface ProjectEntry {
  project: Project;
  seed: Set<string>;
}

export class TsMorphEngine implements Engine {
  private projectEntries = new Map<string, ProjectEntry>();
  private diagnosticServices = new DiagnosticServiceCache();
  private workspaceRoot: string;

  constructor(workspaceRoot = "") {
    this.workspaceRoot = workspaceRoot;
  }

  private cacheKey(tsConfigPath: string | null): string {
    return tsConfigPath ?? NO_TSCONFIG_CACHE_KEY;
  }

  /**
   * Adds every workspace TS/JS file to `project` so cross-file operations
   * (rename, find-references) reach files the tsconfig excludes. Returns
   * `project`'s file set from *before* this addition — the seed
   * `typeCheckedFiles` closes over module resolution.
   */
  private addWorkspaceFiles(project: Project): Set<string> {
    const seed = new Set(project.getSourceFiles().map((sf) => sf.getFilePath() as string));
    if (!this.workspaceRoot) return seed;
    for (const file of walkFiles(this.workspaceRoot, [...TS_EXTENSIONS])) {
      if (!seed.has(file)) {
        project.addSourceFileAtPath(file);
      }
    }
    return seed;
  }

  private ensureProject(filePath: string): {
    project: Project;
    languageService: ts.LanguageService;
    sourceFile: import("ts-morph").SourceFile;
  } {
    const project = this.getProject(filePath);
    const sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
    return { project, languageService: project.getLanguageService().compilerObject, sourceFile };
  }

  /** Loads (or returns the cached) project entry for `tsConfigPath`, creating one if needed. */
  private loadProjectEntry(tsConfigPath: string | null): ProjectEntry {
    const cacheKey = this.cacheKey(tsConfigPath);
    let entry = this.projectEntries.get(cacheKey);
    if (!entry) {
      const project = tsConfigPath
        ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
        : new Project({ useInMemoryFileSystem: false });
      const seed = this.addWorkspaceFiles(project);
      entry = { project, seed };
      this.projectEntries.set(cacheKey, entry);
    }
    return entry;
  }

  private getProject(filePath: string): Project {
    return this.loadProjectEntry(findTsConfigForFile(filePath)).project;
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
    return this.loadProjectEntry(findTsConfig(dirPath)).project;
  }

  invalidateProject(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.projectEntries.delete(this.cacheKey(tsConfigPath));
    this.diagnosticServices.invalidate(tsConfigPath);
  }

  /**
   * Returns the cached project for the tsconfig that covers `filePath`, or
   * `undefined` if the project has not been loaded yet. Does not create a
   * new project — use `getProject` for that.
   */
  getCachedProjectForFile(filePath: string): import("ts-morph").Project | undefined {
    return this.projectEntries.get(this.cacheKey(findTsConfigForFile(filePath)))?.project;
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
    return this.ensureProject(filePath).languageService;
  }

  /**
   * Same as `getLanguageServiceForFile` but resolves the project by searching
   * for a tsconfig starting from `dirPath` itself — correct when the caller has
   * a directory rather than a file.
   */
  getLanguageServiceForDirectory(dirPath: string): ts.LanguageService {
    return this.getLanguageServiceForConfig(findTsConfig(dirPath));
  }

  /**
   * Same as `getLanguageServiceForDirectory`, but for a tsconfig path the caller already
   * has (e.g. an explicit `tsconfig` request param) rather than one to discover — `null`
   * for the no-tsconfig project. `loadProjectEntry` already caches by tsconfig path, so
   * this needs no cache shape of its own.
   */
  getLanguageServiceForConfig(tsConfigPath: string | null): ts.LanguageService {
    return this.loadProjectEntry(tsConfigPath).project.getLanguageService().compilerObject;
  }

  /**
   * Loads (or returns the cached) diagnostic service for `tsConfigPath` — a
   * program built from the host `typescript`, not ts-morph's. `compilerOptions`
   * and the root file list come from the already-loaded ts-morph project
   * entry: tsconfig resolution is not what ts-morph gets wrong, so there is
   * no need to parse it a second time.
   */
  private loadDiagnosticServiceEntry(tsConfigPath: string | null): DiagnosticService {
    return this.diagnosticServices.get(tsConfigPath, () => {
      const projectEntry = this.loadProjectEntry(tsConfigPath);
      const compilerOptions = projectEntry.project.getCompilerOptions();
      const scriptFileNames = projectEntry.project
        .getSourceFiles()
        .map((sf) => sf.getFilePath() as string);
      return buildDiagnosticService(compilerOptions, scriptFileNames, tsConfigPath);
    });
  }

  /**
   * Same as `getLanguageServiceForConfig`, but backed by a host-TypeScript
   * program rather than ts-morph's — see `diagnostic-service.ts` for why
   * ts-morph's own diagnostics are unreliable under `module: NodeNext`.
   */
  getDiagnosticServiceForConfig(tsConfigPath: string | null): DiagnosticLanguageService {
    return this.loadDiagnosticServiceEntry(tsConfigPath).languageService;
  }

  /**
   * Same as `getDiagnosticServiceForConfig`, but for a single file whose
   * tsconfig is discovered from its own path — and, like `ensureProject` on
   * the ts-morph side, adds the file to the service's file set when the
   * tsconfig doesn't already cover it. Without this, a single-file check on
   * a file the tsconfig excludes would silently see zero script files and
   * report a clean result no matter what the file contains.
   */
  getDiagnosticServiceForFile(filePath: string): DiagnosticLanguageService {
    const tsConfigPath = findTsConfigForFile(filePath);
    const entry = this.loadDiagnosticServiceEntry(tsConfigPath);
    if (!entry.scriptFileNames.includes(filePath)) {
      entry.scriptFileNames.push(filePath);
    }
    return entry.languageService;
  }

  /**
   * Returns type errors for a single file or the whole project. Delegates to
   * the standalone `tsGetTypeErrors` action which handles both single-file and
   * project-wide modes.
   */
  async getTypeErrors(
    file: string | undefined,
    scope: WorkspaceScope,
    tsConfigPath?: string,
  ): Promise<GetTypeErrorsResult> {
    return tsGetTypeErrors(this, file, scope, tsConfigPath ?? null);
  }

  /**
   * Returns the file paths of all source files in the project that covers
   * `workspace`. Used by callers that need to iterate over project files
   * without holding a `Project` reference.
   */
  getProjectSourceFilePaths(workspace: string): string[] {
    return this.getProjectSourceFilePathsForConfig(findTsConfig(workspace));
  }

  /** Same as `getProjectSourceFilePaths`, but for an explicit tsconfig path rather than a directory to discover one from. */
  getProjectSourceFilePathsForConfig(tsConfigPath: string | null): string[] {
    const project = this.loadProjectEntry(tsConfigPath).project;
    return project.getSourceFiles().map((sf) => sf.getFilePath() as string);
  }

  /** Public accessor for the seed `addWorkspaceFiles` computed — `null` when there's no tsconfig. */
  getSeedFilePaths(workspace: string): string[] | null {
    return this.getSeedFilePathsForConfig(findTsConfig(workspace));
  }

  /** Same as `getSeedFilePaths`, but for an explicit tsconfig path rather than a directory to discover one from. */
  getSeedFilePathsForConfig(tsConfigPath: string | null): string[] | null {
    if (tsConfigPath === null) return null;
    return [...this.loadProjectEntry(tsConfigPath).seed];
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
    const { sourceFile: sf } = this.ensureProject(filePath);
    const fn = sf.getFunction(functionName);
    if (!fn) return undefined;
    return {
      name: fn.getName() as string,
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
  }

  /**
   * Refresh a single source file from disk without rebuilding the whole project.
   * Called by the watcher on `change` events (cheaper than full invalidation) and
   * satisfies the `Engine` interface's post-write freshness guarantee — a no-op
   * when the file isn't tracked yet, since the next lookup adds it from disk anyway.
   */
  refreshFile(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    const entry = this.projectEntries.get(this.cacheKey(tsConfigPath));
    entry?.project.getSourceFile(filePath)?.refreshFromFileSystemSync();
    // Dropped wholesale rather than refreshed in place — see `DiagnosticServiceCache`.
    this.diagnosticServices.invalidate(tsConfigPath);
  }

  resolveOffset(file: string, line: number, col: number): number {
    const { sourceFile } = this.ensureProject(file);
    try {
      return sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${file}`, "SYMBOL_NOT_FOUND");
    }
  }

  async getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null> {
    const { languageService: ls, sourceFile } = this.ensureProject(file);
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
    const { languageService: ls, sourceFile } = this.ensureProject(file);
    const resolvedPath = sourceFile.getFilePath();
    const refs = ls.getReferencesAtPosition(resolvedPath, offset);
    if (!refs || refs.length === 0) return null;

    return refs.map((ref) => ({
      fileName: ref.fileName,
      textSpan: { start: ref.textSpan.start, length: ref.textSpan.length },
    }));
  }

  async getFileReferences(file: string): Promise<SpanLocation[] | null> {
    const { languageService: ls, sourceFile } = this.ensureProject(file);
    const refs = ls.getFileReferences(sourceFile.getFilePath());
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
    const { languageService: ls, sourceFile } = this.ensureProject(file);
    const resolvedPath = sourceFile.getFilePath();
    const defs = ls.getDefinitionAtPosition(resolvedPath, offset);
    if (!defs || defs.length === 0) return null;

    return defs.map((def) => ({
      fileName: def.fileName,
      textSpan: { start: def.textSpan.start, length: def.textSpan.length },
      name: def.name,
    }));
  }

  /**
   * Ask the TypeScript language service what import-specifier edits are needed
   * when `oldPath` is renamed to `newPath`.
   *
   * Uses the cached project so the in-memory graph reflects previous moves
   * within the same session — rebuilding from scratch would lose knowledge of
   * files moved in earlier calls and cause ENOENT.
   *
   * Paths are passed to the LS without symlink resolution: ts-morph stores
   * source files under the *unresolved* path the OS hands back (e.g.
   * `/var/folders/…` on macOS, not `/private/var/folders/…`). Resolving via
   * `realpathSync` would produce a path the LS cannot match to any known
   * source file, returning zero edits.
   */
  async getEditsForFileRename(oldPath: string, newPath: string): Promise<FileTextEdit[]> {
    const project = this.getProject(oldPath);
    if (!project.getSourceFile(oldPath)) {
      project.addSourceFileAtPath(oldPath);
    }

    const ls = project.getLanguageService().compilerObject;
    const edits = ls.getEditsForFileRename(oldPath, newPath, {}, {});

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
   * Add or remove the `export` keyword on a top-level declaration: delegates to
   * `tsSetExport`, which resolves the declaration, guards the remove direction
   * against outside references, and writes through `scope`.
   */
  async setExport(
    file: string,
    symbolName: string,
    exported: boolean,
    scope: WorkspaceScope,
  ): Promise<SetExportResult> {
    return tsSetExport(this, file, symbolName, exported, scope);
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
