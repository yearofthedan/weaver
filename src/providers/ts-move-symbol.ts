import * as path from "node:path";
import {
  type ImportDeclaration,
  type ImportSpecifier,
  Node,
  type SourceFile,
  type Node as TsMorphNode,
} from "ts-morph";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { EngineError } from "../utils/errors.js";
import { computeRelativeImportPath } from "../utils/relative-path.js";
import type { TsProvider } from "./ts.js";

type Removable = { getText(): string; remove(): void };

/**
 * Resolve a declaration node to the removable top-level statement that
 * contains it. VariableDeclaration lives inside VariableDeclarationList →
 * VariableStatement and must be unwrapped before removal.
 */
function toRemovableStatement(decl: TsMorphNode): Removable {
  if (Node.isVariableDeclaration(decl)) {
    return decl.getParent().getParent() as unknown as Removable;
  }
  return decl as unknown as Removable;
}

/**
 * Snapshot all importers of `symbolName` from `absSource` across the project.
 */
function snapshotImporters(
  project: ReturnType<TsProvider["getProjectForFile"]>,
  absSource: string,
  symbolName: string,
) {
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
  return importers;
}

/**
 * Rewrite import declarations in importers to point at the new destination file.
 * Files outside the workspace boundary are recorded as skipped rather than modified.
 */
function rewriteImporters(
  importers: ReturnType<typeof snapshotImporters>,
  absDest: string,
  symbolName: string,
  scope: WorkspaceScope,
): void {
  for (const { sf, importDecl, specifiers, totalNamedImports } of importers) {
    const filePath = sf.getFilePath() as string;
    if (filePath === absDest) continue;
    if (!scope.contains(filePath)) {
      scope.recordSkipped(filePath);
      continue;
    }

    const destSpecifier = computeRelativeImportPath(filePath, absDest);
    const existingDestImport = sf
      .getImportDeclarations()
      .find((id) => id.getModuleSpecifierSourceFile()?.getFilePath() === absDest);

    if (totalNamedImports === specifiers.length) {
      if (existingDestImport) {
        existingDestImport.addNamedImport(symbolName);
        importDecl.remove();
      } else {
        importDecl.setModuleSpecifier(destSpecifier);
      }
    } else {
      for (const spec of specifiers) {
        spec.remove();
      }
      if (existingDestImport) {
        existingDestImport.addNamedImport(symbolName);
      } else {
        sf.addImportDeclaration({ namedImports: [symbolName], moduleSpecifier: destSpecifier });
      }
    }

    scope.recordModified(filePath);
  }
}

/**
 * Perform all compiler work for a named-symbol move: symbol lookup, destination
 * preparation, importer rewriting, AST surgery, dirty-file tracking, and saving.
 *
 * Called by `TsProvider.moveSymbol`; not intended for direct use by operations.
 */
export async function tsMoveSymbol(
  tsProvider: TsProvider,
  absSource: string,
  symbolName: string,
  absDest: string,
  scope: WorkspaceScope,
  options?: { force?: boolean },
): Promise<void> {
  const force = options?.force === true;
  const project = tsProvider.getProjectForFile(absSource);

  let srcSF = project.getSourceFile(absSource);
  if (!srcSF) {
    srcSF = project.addSourceFileAtPath(absSource);
  }

  const exportedDecls = srcSF.getExportedDeclarations().get(symbolName);
  if (!exportedDecls) {
    throw new EngineError(
      `Symbol '${symbolName}' not found as an export in ${absSource}`,
      "SYMBOL_NOT_FOUND",
    );
  }

  const decl = exportedDecls[0];
  const stmt = toRemovableStatement(decl);
  const declarationText = stmt.getText();

  if (!declarationText.trimStart().startsWith("export")) {
    throw new EngineError(
      `Symbol '${symbolName}' in ${absSource} is not a direct export. Re-exports via 'export { }' are not supported.`,
      "NOT_SUPPORTED",
    );
  }

  // Prepare the destination directory and source file before any mutations.
  const destDir = path.dirname(absDest);
  if (!scope.fs.exists(destDir)) {
    scope.fs.mkdir(destDir, { recursive: true });
  }

  let dstSF: SourceFile;
  if (scope.fs.exists(absDest)) {
    dstSF = project.getSourceFile(absDest) ?? project.addSourceFileAtPath(absDest);
  } else {
    dstSF = project.createSourceFile(absDest, "");
  }

  const destExportedDecls = dstSF.getExportedDeclarations().get(symbolName);
  const symbolExistsInDest = Boolean(destExportedDecls);
  if (symbolExistsInDest && !force) {
    throw new EngineError(
      `Symbol '${symbolName}' already exists as an export in ${absDest}. Pass force: true to replace the existing declaration with the source version.`,
      "SYMBOL_EXISTS",
    );
  }

  // Snapshot importers before any mutations so the AST references remain valid.
  const importers = snapshotImporters(project, absSource, symbolName);

  // Remove declaration from source file.
  stmt.remove();

  // When force is true and the symbol already exists in dest, remove it first
  // so the source version replaces it (source wins).
  if (force && symbolExistsInDest && destExportedDecls) {
    const destDecl = destExportedDecls[0];
    const destStmt = toRemovableStatement(destDecl);
    destStmt.remove();
  }

  // Append the declaration to the destination file.
  const existingText = dstSF.getText();
  const separator = existingText.trimEnd().length === 0 ? "" : "\n\n";
  dstSF.replaceWithText(`${existingText.trimEnd()}${separator}${declarationText}\n`);

  // Rewrite import declarations in each importer.
  rewriteImporters(importers, absDest, symbolName, scope);

  // Collect any other dirty files (srcSF, dstSF) not covered by importer rewrites.
  for (const sf of project.getSourceFiles()) {
    if (sf.isSaved()) continue;
    const fp = sf.getFilePath() as string;
    if (scope.contains(fp)) {
      scope.recordModified(fp);
    } else {
      scope.recordSkipped(fp);
    }
  }

  // Save all dirty files within the workspace.
  for (const sf of project.getSourceFiles()) {
    if (!sf.isSaved() && scope.contains(sf.getFilePath() as string)) {
      await sf.save();
    }
  }

  tsProvider.invalidateProject(absSource);
}
