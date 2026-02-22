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
import { EngineError } from "../errors.js";
import { walkFiles } from "../file-walk.js";
import { applyTextEdits, offsetToLineCol } from "../text-utils.js";
import type {
  FindReferencesResult,
  GetDefinitionResult,
  MoveResult,
  MoveSymbolResult,
  RefactorEngine,
  RenameResult,
} from "../types.js";
import { findTsConfigForFile } from "./project.js";


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
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
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
      throw new EngineError(`Line ${line} out of range in ${filePath}`, "SYMBOL_NOT_FOUND");
    }
    let pos: number;
    try {
      pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw new EngineError(`No renameable symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const node = sourceFile.getDescendantAtPos(pos);
    if (!node) {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    // Walk up to find the nearest renameable identifier
    let target: Node | undefined = node;
    while (target && !Node.isIdentifier(target) && !Node.isPrivateIdentifier(target)) {
      target = target.getParent();
    }

    if (!target || (!Node.isIdentifier(target) && !Node.isPrivateIdentifier(target))) {
      throw new EngineError(`No renameable symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const oldName = target.getText();

    // Check rename is allowed via language service
    const ls = project.getLanguageService();
    const renameInfo = ls.compilerObject.getRenameInfo(absPath, pos, {
      allowRenameOfImportPath: false,
    });

    if (!renameInfo.canRename) {
      throw new EngineError(renameInfo.localizedErrorMessage ?? "Symbol cannot be renamed", "RENAME_NOT_ALLOWED");
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

  async findReferences(
    filePath: string,
    line: number,
    col: number,
  ): Promise<FindReferencesResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const project = this.getProject(absPath);
    let sourceFile = project.getSourceFile(absPath);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(absPath);
    }

    const lineCount = sourceFile.getEndLineNumber();
    if (line - 1 > lineCount) {
      throw new EngineError(`Line ${line} out of range in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    let pos: number;
    try {
      pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const ls = project.getLanguageService().compilerObject;
    const refs = ls.getReferencesAtPosition(absPath, pos);

    if (!refs || refs.length === 0) {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    // Extract symbol name from the definition reference, falling back to the first.
    const defRef = refs.find((r) => r.isDefinition) ?? refs[0];
    const contentCache = new Map<string, string>();
    const getContent = (fp: string) => {
      if (!contentCache.has(fp)) contentCache.set(fp, fs.readFileSync(fp, "utf8"));
      return contentCache.get(fp) as string;
    };
    const symbolName = getContent(defRef.fileName).slice(
      defRef.textSpan.start,
      defRef.textSpan.start + defRef.textSpan.length,
    );

    const references = refs.map((ref) => {
      const content = getContent(ref.fileName);
      const lc = offsetToLineCol(content, ref.textSpan.start);
      return { file: ref.fileName, line: lc.line, col: lc.col, length: ref.textSpan.length };
    });

    return { symbolName, references };
  }

  async getDefinition(
    filePath: string,
    line: number,
    col: number,
  ): Promise<GetDefinitionResult> {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new EngineError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }

    const project = this.getProject(absPath);
    let sourceFile = project.getSourceFile(absPath);
    if (!sourceFile) {
      sourceFile = project.addSourceFileAtPath(absPath);
    }

    const lineCount = sourceFile.getEndLineNumber();
    if (line - 1 > lineCount) {
      throw new EngineError(`Line ${line} out of range in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    let pos: number;
    try {
      pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, col - 1);
    } catch {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const ls = project.getLanguageService().compilerObject;
    const defs = ls.getDefinitionAtPosition(absPath, pos);

    if (!defs || defs.length === 0) {
      throw new EngineError(`No symbol at line ${line}, col ${col} in ${filePath}`, "SYMBOL_NOT_FOUND");
    }

    const symbolName = defs[0].name;
    const contentCache = new Map<string, string>();
    const getContent = (fp: string) => {
      if (!contentCache.has(fp)) contentCache.set(fp, fs.readFileSync(fp, "utf8"));
      return contentCache.get(fp) as string;
    };

    const definitions = defs.map((def) => {
      const content = getContent(def.fileName);
      const lc = offsetToLineCol(content, def.textSpan.start);
      return { file: def.fileName, line: lc.line, col: lc.col, length: def.textSpan.length };
    });

    return { symbolName, definitions };
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
      throw new EngineError(`File not found: ${sourceFile}`, "FILE_NOT_FOUND");
    }

    const project = this.getProject(absSource);

    let srcSF = project.getSourceFile(absSource);
    if (!srcSF) {
      srcSF = project.addSourceFileAtPath(absSource);
    }

    // Find the exported declaration for the symbol
    const exportedDecls = srcSF.getExportedDeclarations().get(symbolName);
    if (!exportedDecls || exportedDecls.length === 0) {
      throw new EngineError(`Symbol '${symbolName}' not found as an export in ${sourceFile}`, "SYMBOL_NOT_FOUND");
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
      throw new EngineError(
        `Symbol '${symbolName}' in ${sourceFile} is not a direct export. Re-exports via 'export { }' are not supported.`,
        "NOT_SUPPORTED",
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
      throw new EngineError(`File not found: ${oldPath}`, "FILE_NOT_FOUND");
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
    for (const filePath of walkFiles(workspaceRoot, [".ts", ".tsx"])) {
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
