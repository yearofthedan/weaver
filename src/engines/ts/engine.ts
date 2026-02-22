import * as fs from "node:fs";
import * as path from "node:path";
import {
  type ImportDeclaration,
  type ImportSpecifier,
  Node,
  Project,
  type SourceFile,
} from "ts-morph";
import { isWithinWorkspace } from "../../workspace.js";
import { applyTextEdits } from "../text-utils.js";
import type { MoveResult, MoveSymbolResult, RefactorEngine, RenameResult } from "../types.js";
import { findTsConfigForFile } from "./project.js";

/**
 * Recursively collect all .ts/.tsx files under `dir`, skipping directories
 * that are never part of a TypeScript project (node_modules, dist, .git).
 * Used by the moveFile post-scan to reach files outside tsconfig `include`.
 */
function collectTsFiles(dir: string): string[] {
  const SKIP = new Set(["node_modules", "dist", ".git"]);
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function computeRelativeSpecifier(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\.(ts|tsx)$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

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

  async moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    workspace: string,
  ): Promise<MoveSymbolResult> {
    const absSource = path.resolve(sourceFile);
    const absDest = path.resolve(destFile);

    if (!fs.existsSync(absSource)) {
      throw Object.assign(new Error(`File not found: ${sourceFile}`), {
        code: "FILE_NOT_FOUND" as const,
      });
    }

    const project = this.getProject(absSource);

    let srcSF = project.getSourceFile(absSource);
    if (!srcSF) {
      srcSF = project.addSourceFileAtPath(absSource);
    }

    // Find the exported declaration for the symbol
    const exportedDecls = srcSF.getExportedDeclarations().get(symbolName);
    if (!exportedDecls || exportedDecls.length === 0) {
      throw Object.assign(
        new Error(`Symbol '${symbolName}' not found as an export in ${sourceFile}`),
        { code: "SYMBOL_NOT_FOUND" as const },
      );
    }

    const decl = exportedDecls[0];

    // Resolve to the containing statement
    // VariableDeclaration lives inside VariableDeclarationList → VariableStatement
    type Removable = { getText(): string; remove(): void };
    let stmt: Removable;
    if (Node.isVariableDeclaration(decl)) {
      stmt = decl.getParent().getParent() as unknown as Removable;
    } else {
      stmt = decl as unknown as Removable;
    }

    const declarationText = stmt.getText();

    // Reject re-exports via `export { foo }` (these are ExportSpecifiers, not direct declarations)
    if (!declarationText.trimStart().startsWith("export")) {
      throw Object.assign(
        new Error(
          `Symbol '${symbolName}' in ${sourceFile} is not a direct export. Re-exports via 'export { }' are not supported.`,
        ),
        { code: "NOT_SUPPORTED" as const },
      );
    }

    // Snapshot importers before any mutations
    type ImporterEntry = {
      sf: SourceFile;
      importDecl: ImportDeclaration;
      specifiers: ImportSpecifier[];
      totalNamedImports: number;
    };
    const importers: ImporterEntry[] = [];

    for (const sf of project.getSourceFiles()) {
      if (sf.getFilePath() === absSource) continue;
      for (const importDecl of sf.getImportDeclarations()) {
        if (importDecl.getModuleSpecifierSourceFile()?.getFilePath() === absSource) {
          const specifiers = importDecl.getNamedImports().filter((s) => s.getName() === symbolName);
          if (specifiers.length > 0) {
            importers.push({
              sf,
              importDecl,
              specifiers,
              totalNamedImports: importDecl.getNamedImports().length,
            });
          }
        }
      }
    }

    // Remove the declaration from the source file
    stmt.remove();

    // Create or load the destination source file
    const destDir = path.dirname(absDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let dstSF: SourceFile;
    if (fs.existsSync(absDest)) {
      dstSF = project.getSourceFile(absDest) ?? project.addSourceFileAtPath(absDest);
    } else {
      dstSF = project.createSourceFile(absDest, "");
    }

    // Append the declaration to the destination file
    const existingText = dstSF.getText();
    const separator = existingText.trimEnd().length === 0 ? "" : "\n\n";
    dstSF.replaceWithText(`${existingText.trimEnd()}${separator}${declarationText}\n`);

    // Update import declarations in each importer
    const filesModified: string[] = [];
    const filesSkipped: string[] = [];

    for (const { sf, importDecl, specifiers, totalNamedImports } of importers) {
      const filePath = sf.getFilePath() as string;
      if (filePath === absDest) continue; // skip dest file: it defines the symbol, not imports it
      if (!isWithinWorkspace(filePath, workspace)) {
        if (!filesSkipped.includes(filePath)) filesSkipped.push(filePath);
        continue;
      }

      const destSpecifier = computeRelativeSpecifier(filePath, absDest);

      // Find any existing import from destFile in this source file
      const existingDestImport = sf
        .getImportDeclarations()
        .find((id) => id.getModuleSpecifierSourceFile()?.getFilePath() === absDest);

      if (totalNamedImports === specifiers.length) {
        // This import declaration only contained our symbol
        if (existingDestImport) {
          existingDestImport.addNamedImport(symbolName);
          importDecl.remove();
        } else {
          importDecl.setModuleSpecifier(destSpecifier);
        }
      } else {
        // Multiple symbols; remove only the ones being moved
        for (const spec of specifiers) {
          spec.remove();
        }
        if (existingDestImport) {
          existingDestImport.addNamedImport(symbolName);
        } else {
          sf.addImportDeclaration({ namedImports: [symbolName], moduleSpecifier: destSpecifier });
        }
      }

      if (!filesModified.includes(filePath)) filesModified.push(filePath);
    }

    // Collect any other dirty files (srcSF, dstSF) that weren't covered above
    for (const sf of project.getSourceFiles()) {
      if (sf.isSaved()) continue;
      const fp = sf.getFilePath() as string;
      if (isWithinWorkspace(fp, workspace)) {
        if (!filesModified.includes(fp)) filesModified.push(fp);
      } else {
        if (!filesSkipped.includes(fp)) filesSkipped.push(fp);
      }
    }

    // Save all dirty files within the workspace
    for (const sf of project.getSourceFiles()) {
      if (!sf.isSaved() && isWithinWorkspace(sf.getFilePath() as string, workspace)) {
        await sf.save();
      }
    }

    this.invalidateProject(absSource);

    return {
      filesModified,
      filesSkipped,
      symbolName,
      sourceFile: absSource,
      destFile: absDest,
    };
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

    // Post-scan: fix imports in files not tracked by the ts-morph project.
    // The TypeScript language service only sees files listed in tsconfig `include`.
    // Files outside (e.g. tests/) are invisible to getEditsForFileRename.
    // We do a text-level search-replace here; we deliberately do NOT add these
    // files to the Project — that would widen the type-checking scope beyond
    // what tsconfig intends.
    const projectFilePaths = new Set(
      project.getSourceFiles().map((sf) => sf.getFilePath() as string),
    );
    const workspaceRoot = path.resolve(workspace);
    for (const filePath of collectTsFiles(workspaceRoot)) {
      if (projectFilePaths.has(filePath)) continue; // already handled above
      if (!isWithinWorkspace(filePath, workspace)) {
        if (!filesSkipped.includes(filePath)) filesSkipped.push(filePath);
        continue;
      }
      const fromDir = path.dirname(filePath);
      const relOldBase = (() => {
        const r = path.relative(fromDir, absOld.replace(/\.(ts|tsx)$/, ""));
        return r.startsWith(".") ? r : `./${r}`;
      })();
      const relNewBase = (() => {
        const r = path.relative(fromDir, absNew.replace(/\.(ts|tsx)$/, ""));
        return r.startsWith(".") ? r : `./${r}`;
      })();
      // Try all specifier variants (bare, .js, .ts, .tsx) to handle any
      // module-resolution convention the out-of-project file may use.
      const raw = fs.readFileSync(filePath, "utf8");
      let updated = raw;
      for (const ext of ["", ".js", ".ts", ".tsx"]) {
        updated = updated.replaceAll(relOldBase + ext, relNewBase + ext);
      }
      if (updated === raw) continue;
      fs.writeFileSync(filePath, updated, "utf8");
      if (!filesModified.includes(filePath)) filesModified.push(filePath);
    }

    // Invalidate the cached project: the TypeScript program is now stale.
    this.invalidateProject(absOld);

    return { filesModified, filesSkipped, oldPath: absOld, newPath: absNew };
  }
}
