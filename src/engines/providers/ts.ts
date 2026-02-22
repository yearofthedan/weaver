import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { isWithinWorkspace } from "../../workspace.js";
import { EngineError } from "../errors.js";
import { walkFiles } from "../file-walk.js";
import type {
  DefinitionLocation,
  FileTextEdit,
  LanguageProvider,
  SpanLocation,
} from "../types.js";
import { findTsConfigForFile } from "../ts/project.js";

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

  resolveOffset(file: string, line: number, col: number): number {
    const project = this.getProject(file);
    let sourceFile = project.getSourceFile(file);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(file);
    }
    try {
      return sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw new EngineError(
        `No symbol at line ${line}, col ${col} in ${file}`,
        "SYMBOL_NOT_FOUND",
      );
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

    for (const filePath of walkFiles(workspaceRoot, [".ts", ".tsx"])) {
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
      let updated = raw;
      for (const ext of ["", ".js", ".ts", ".tsx"]) {
        updated = updated.replaceAll(relOldBase + ext, relNewBase + ext);
      }
      if (updated === raw) continue;

      fs.writeFileSync(filePath, updated, "utf8");
      modified.push(filePath);
    }

    return { modified, skipped };
  }
}
