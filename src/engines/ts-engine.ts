import * as fs from "node:fs";
import * as path from "node:path";
import { Node, Project } from "ts-morph";
import { isWithinWorkspace } from "../daemon/workspace.js";
import { findTsConfigForFile } from "./project.js";
import { applyTextEdits } from "./text-utils.js";
import type { MoveResult, RefactorEngine, RenameResult } from "./types.js";
import { updateVueImportsAfterMove } from "./vue-scan.js";

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
    workspace: string,
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

    // Collect dirty files and partition by workspace boundary.
    const dirtySources = project.getSourceFiles().filter((sf) => !sf.isSaved());
    const filesModified: string[] = [];
    const filesSkipped: string[] = [];
    for (const sf of dirtySources) {
      const fp = sf.getFilePath() as string;
      if (isWithinWorkspace(fp, workspace)) {
        await sf.save();
        filesModified.push(fp);
      } else {
        filesSkipped.push(fp);
      }
    }

    return {
      filesModified,
      filesSkipped,
      symbolName: oldName,
      newName,
      locationCount: dirtySources.length, // approximate; ts-morph doesn't expose count directly
    };
  }

  private invalidateProject(filePath: string): void {
    const tsConfigPath = findTsConfigForFile(filePath);
    this.projects.delete(tsConfigPath ?? "__no_tsconfig__");
  }

  async moveFile(oldPath: string, newPath: string, workspace: string): Promise<MoveResult> {
    const absOld = path.resolve(oldPath);
    const absNew = path.resolve(newPath);

    if (!fs.existsSync(absOld)) {
      throw Object.assign(new Error(`File not found: ${oldPath}`), {
        code: "FILE_NOT_FOUND" as const,
      });
    }

    const project = this.getProject(absOld);

    // Ensure the source file is loaded into the project
    if (!project.getSourceFile(absOld)) {
      project.addSourceFileAtPath(absOld);
    }

    // Use the language service directly to compute import rewrites.
    // This gives us per-file control before anything touches disk — we never
    // call sourceFile.move() + project.save() because that pair has no
    // whitelist API and would write all files atomically.
    const ls = project.getLanguageService().compilerObject;
    const edits = ls.getEditsForFileRename(absOld, absNew, {}, {});

    const filesModified: string[] = [];
    const filesSkipped: string[] = [];

    for (const edit of edits) {
      if (edit.textChanges.length === 0) continue;
      if (!isWithinWorkspace(edit.fileName, workspace)) {
        if (!filesSkipped.includes(edit.fileName)) filesSkipped.push(edit.fileName);
        continue;
      }
      const original = fs.readFileSync(edit.fileName, "utf8");
      const updated = applyTextEdits(original, edit.textChanges);
      fs.writeFileSync(edit.fileName, updated, "utf8");
      if (!filesModified.includes(edit.fileName)) filesModified.push(edit.fileName);
    }

    // Ensure destination directory exists, then do the physical move.
    const destDir = path.dirname(absNew);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.renameSync(absOld, absNew);
    if (!filesModified.includes(absNew)) filesModified.push(absNew);

    // Invalidate the cached project: the TypeScript program is now stale.
    this.invalidateProject(absOld);

    // ts-morph doesn't know about .vue files; scan and rewrite their imports manually.
    const tsConfigForScan = findTsConfigForFile(absOld);
    const searchRoot = tsConfigForScan ? path.dirname(tsConfigForScan) : path.dirname(absOld);
    const vueModified = updateVueImportsAfterMove(absOld, absNew, searchRoot);
    for (const f of vueModified) {
      if (!filesModified.includes(f)) filesModified.push(f);
    }

    return { filesModified, filesSkipped, oldPath: absOld, newPath: absNew };
  }
}
