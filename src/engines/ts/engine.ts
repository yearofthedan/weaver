import * as fs from "node:fs";
import * as path from "node:path";
import { type ImportDeclaration, type ImportSpecifier, Node, type SourceFile } from "ts-morph";
import { isWithinWorkspace } from "../../workspace.js";
import { BaseEngine } from "../engine.js";
import { EngineError } from "../errors.js";
import { TsProvider } from "../providers/ts.js";
import type { MoveSymbolResult, RefactorEngine } from "../types.js";

function computeRelativeSpecifier(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\.(ts|tsx)$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

export class TsEngine extends BaseEngine implements RefactorEngine {
  private tsProvider: TsProvider;

  constructor(provider?: TsProvider) {
    const p = provider ?? new TsProvider();
    super(p);
    this.tsProvider = p;
  }

  /**
   * Refresh a single file in the engine's in-memory project graph.
   * Called by the daemon watcher on `change` events.
   */
  invalidateFile(filePath: string): void {
    this.tsProvider.refreshFile(filePath);
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

    const project = this.tsProvider.getProjectForFile(absSource);

    let srcSF = project.getSourceFile(absSource);
    if (!srcSF) {
      srcSF = project.addSourceFileAtPath(absSource);
    }

    // Find the exported declaration for the symbol
    const exportedDecls = srcSF.getExportedDeclarations().get(symbolName);
    if (!exportedDecls || exportedDecls.length === 0) {
      throw new EngineError(
        `Symbol '${symbolName}' not found as an export in ${sourceFile}`,
        "SYMBOL_NOT_FOUND",
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
    const filesModified = new Set<string>();
    const filesSkipped = new Set<string>();

    for (const { sf, importDecl, specifiers, totalNamedImports } of importers) {
      const filePath = sf.getFilePath() as string;
      if (filePath === absDest) continue; // skip dest file: it defines the symbol, not imports it
      if (!isWithinWorkspace(filePath, workspace)) {
        filesSkipped.add(filePath);
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

      filesModified.add(filePath);
    }

    // Collect any other dirty files (srcSF, dstSF) that weren't covered above
    for (const sf of project.getSourceFiles()) {
      if (sf.isSaved()) continue;
      const fp = sf.getFilePath() as string;
      if (isWithinWorkspace(fp, workspace)) {
        filesModified.add(fp);
      } else {
        filesSkipped.add(fp);
      }
    }

    // Save all dirty files within the workspace
    for (const sf of project.getSourceFiles()) {
      if (!sf.isSaved() && isWithinWorkspace(sf.getFilePath() as string, workspace)) {
        await sf.save();
      }
    }

    this.tsProvider.invalidateProject(absSource);

    return {
      filesModified: Array.from(filesModified),
      filesSkipped: Array.from(filesSkipped),
      symbolName,
      sourceFile: absSource,
      destFile: absDest,
    };
  }
}
