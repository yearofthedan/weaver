import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { isWithinWorkspace } from "../security.js";
import type { DefinitionLocation, FileTextEdit, LanguageProvider, SpanLocation } from "../types.js";
import { EngineError } from "../utils/errors.js";
import { TS_EXTENSIONS, walkFiles } from "../utils/file-walk.js";
import { findTsConfigForFile } from "../utils/ts-project.js";

export class TsProvider implements LanguageProvider {
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

  invalidateProject(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.projects.delete(tsConfigPath ?? "__no_tsconfig__");
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
    const renameInfo = ls.getRenameInfo(file, offset, { allowRenameOfImportPath: false });
    if (!renameInfo.canRename) {
      throw new EngineError(
        renameInfo.localizedErrorMessage ?? "Symbol cannot be renamed",
        "RENAME_NOT_ALLOWED",
      );
    }

    const locs = ls.findRenameLocations(file, offset, false, false, {
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
    const refs = ls.getReferencesAtPosition(file, offset);
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
    const defs = ls.getDefinitionAtPosition(file, offset);
    if (!defs || defs.length === 0) return null;

    return defs.map((def) => ({
      fileName: def.fileName,
      textSpan: { start: def.textSpan.start, length: def.textSpan.length },
      name: def.name,
    }));
  }

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
        textChanges: e.textChanges.map((c) => ({
          span: { start: c.span.start, length: c.span.length },
          newText: c.newText,
        })),
      }));
  }

  readFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
  }

  notifyFileWritten(_path: string, _content: string): void {
    // ts-morph reads from disk; no in-memory cache to update.
  }

  async afterSymbolMove(
    _sourceFile: string,
    _symbolName: string,
    _destFile: string,
    _workspace: string,
  ): Promise<{ modified: string[]; skipped: string[] }> {
    // ts-morph AST edits in TsEngine.moveSymbol handle TS importers directly.
    return { modified: [], skipped: [] };
  }

  async afterFileRename(
    oldPath: string,
    newPath: string,
    workspace: string,
  ): Promise<{ modified: string[]; skipped: string[] }> {
    // Capture project file paths before invalidation (for the post-scan skip list).
    const project = this.getProject(oldPath);
    const projectFilePaths = new Set(
      project.getSourceFiles().map((sf) => sf.getFilePath() as string),
    );
    this.invalidateProject(oldPath);

    // Scan out-of-project files that the TS language service doesn't see.
    // (The language service only processes files listed in tsconfig `include`.)
    const workspaceRoot = path.resolve(workspace);
    const modified: string[] = [];
    const skipped: string[] = [];

    for (const filePath of walkFiles(workspaceRoot, [...TS_EXTENSIONS])) {
      if (projectFilePaths.has(filePath)) continue;
      if (!isWithinWorkspace(filePath, workspace)) {
        skipped.push(filePath);
        continue;
      }

      const fromDir = path.dirname(filePath);
      const relOldBase = (() => {
        const r = path.relative(fromDir, oldPath.replace(/\.(ts|tsx)$/, ""));
        return r.startsWith(".") ? r : `./${r}`;
      })();
      const relNewBase = (() => {
        const r = path.relative(fromDir, newPath.replace(/\.(ts|tsx)$/, ""));
        return r.startsWith(".") ? r : `./${r}`;
      })();

      const raw = fs.readFileSync(filePath, "utf8");

      // Use ts-morph to update only import/export specifiers, not comments or strings.
      const tmpProject = new Project({ useInMemoryFileSystem: true });
      const sf = tmpProject.createSourceFile(filePath, raw);
      let hasChanges = false;

      for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
        const specifier = decl.getModuleSpecifierValue();
        if (specifier === undefined) continue;
        for (const ext of ["", ".js", ".ts", ".tsx"]) {
          if (specifier === relOldBase + ext) {
            decl.setModuleSpecifier(relNewBase + ext);
            hasChanges = true;
            break;
          }
        }
      }

      if (!hasChanges) continue;

      fs.writeFileSync(filePath, sf.getFullText(), "utf8");
      modified.push(filePath);
    }

    return { modified, skipped };
  }
}
