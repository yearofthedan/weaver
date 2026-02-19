import * as fs from "node:fs";
import * as path from "node:path";
import { Node, Project } from "ts-morph";
import { findTsConfigForFile } from "../project.js";
import { updateVueImportsAfterMove } from "../vue-scan.js";
import type { MoveResult, RefactorEngine, RenameResult } from "./types.js";

export class TsEngine implements RefactorEngine {
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

  async rename(
    filePath: string,
    line: number,
    col: number,
    newName: string,
  ): Promise<RenameResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw Object.assign(new Error(`File not found: ${filePath}`), {
        code: "FILE_NOT_FOUND" as const,
      });
    }

    const project = this.getProject(absPath);

    // Ensure the target file is in the project
    let sourceFile = project.getSourceFile(absPath);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(absPath);
    }

    // Convert 1-based to 0-based
    const lineCount = sourceFile.getEndLineNumber(); // 0-based last line index
    if (line - 1 > lineCount) {
      throw Object.assign(new Error(`Line ${line} out of range in ${filePath}`), {
        code: "SYMBOL_NOT_FOUND" as const,
      });
    }
    let pos: number;
    try {
      pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw Object.assign(
        new Error(`No renameable symbol at line ${line}, col ${col} in ${filePath}`),
        { code: "SYMBOL_NOT_FOUND" as const },
      );
    }

    const node = sourceFile.getDescendantAtPos(pos);
    if (!node) {
      throw Object.assign(new Error(`No symbol at line ${line}, col ${col} in ${filePath}`), {
        code: "SYMBOL_NOT_FOUND" as const,
      });
    }

    // Walk up to find the nearest renameable identifier
    let target: Node | undefined = node;
    while (target && !Node.isIdentifier(target) && !Node.isPrivateIdentifier(target)) {
      target = target.getParent();
    }

    if (!target || (!Node.isIdentifier(target) && !Node.isPrivateIdentifier(target))) {
      throw Object.assign(
        new Error(`No renameable symbol at line ${line}, col ${col} in ${filePath}`),
        { code: "SYMBOL_NOT_FOUND" as const },
      );
    }

    const oldName = target.getText();

    // Check rename is allowed via language service
    const ls = project.getLanguageService();
    const renameInfo = ls.compilerObject.getRenameInfo(absPath, pos, {
      allowRenameOfImportPath: false,
    });

    if (!renameInfo.canRename) {
      throw Object.assign(
        new Error(renameInfo.localizedErrorMessage ?? "Symbol cannot be renamed"),
        { code: "RENAME_NOT_ALLOWED" as const },
      );
    }

    // Perform the rename — ts-morph propagates across all project files
    target.rename(newName);

    // Collect which files changed (unsaved = modified)
    const modifiedFiles = project
      .getSourceFiles()
      .filter((sf) => !sf.isSaved())
      .map((sf) => sf.getFilePath() as string);

    await project.save();

    return {
      filesModified: modifiedFiles,
      symbolName: oldName,
      newName,
      locationCount: modifiedFiles.length, // approximate; ts-morph doesn't expose count directly
    };
  }

  async moveFile(oldPath: string, newPath: string): Promise<MoveResult> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);

    if (!fs.existsSync(absOld)) {
      throw Object.assign(new Error(`File not found: ${oldPath}`), {
        code: "FILE_NOT_FOUND" as const,
      });
    }

    const project = this.getProject(absOld);

    let sourceFile = project.getSourceFile(absOld);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(absOld);
    }

    // Ensure destination directory exists
    const destDir = path.dirname(absNew);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // ts-morph move() rewrites all imports and schedules the physical file rename
    sourceFile.move(absNew, { overwrite: true });

    const modifiedFiles = project
      .getSourceFiles()
      .filter((sf) => !sf.isSaved())
      .map((sf) => sf.getFilePath() as string);

    await project.save();

    // ts-morph doesn't know about .vue files; scan and rewrite their imports manually
    const tsConfigForScan = findTsConfigForFile(absOld);
    const searchRoot = tsConfigForScan ? path.dirname(tsConfigForScan) : path.dirname(absOld);
    const vueModified = updateVueImportsAfterMove(absOld, absNew, searchRoot);
    for (const f of vueModified) {
      if (!modifiedFiles.includes(f)) modifiedFiles.push(f);
    }

    return {
      filesModified: modifiedFiles,
      oldPath: absOld,
      newPath: absNew,
    };
  }
}
