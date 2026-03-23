import type {
  ExportDeclaration,
  ImportDeclaration,
  SourceFile as TsMorphSourceFile,
} from "ts-morph";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { TsMorphEngine } from "./engine.js";

/**
 * Removes all import and export declarations that reference `targetFile` from
 * every in-scope TS/JS file. In-project files are resolved via the ts-morph
 * compiler.
 *
 * Returns the total count of declarations removed across all files.
 *
 * Files outside `scope.root` are recorded as skipped and never written.
 */
export async function tsRemoveImportersOf(
  compiler: TsMorphEngine,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<number> {
  return removeInProjectImporters(compiler, targetFile, scope);
}

/**
 * In-project TS/JS cleanup via ts-morph.
 * ts-morph resolves module specifiers through the compiler, so it correctly
 * handles path aliases, index files, and all extension variants.
 */
async function removeInProjectImporters(
  compiler: TsMorphEngine,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<number> {
  const project = compiler.getProjectForFile(targetFile);
  if (!project.getSourceFile(targetFile)) {
    project.addSourceFileAtPath(targetFile);
  }

  let removed = 0;

  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath() as string;
    if (filePath === targetFile) continue;

    const hasRefs =
      sf
        .getImportDeclarations()
        .some((d) => d.getModuleSpecifierSourceFile()?.getFilePath() === targetFile) ||
      sf
        .getExportDeclarations()
        .some((d) => d.getModuleSpecifierSourceFile()?.getFilePath() === targetFile);

    if (!hasRefs) continue;

    if (!scope.contains(filePath)) {
      scope.recordSkipped(filePath);
      continue;
    }

    removed += removeMatchingDeclarations(
      sf,
      (decl) => decl.getModuleSpecifierSourceFile()?.getFilePath() === targetFile,
    );

    scope.recordModified(filePath);
  }

  for (const sf of project.getSourceFiles()) {
    if (!sf.isSaved() && scope.contains(sf.getFilePath() as string)) {
      await sf.save();
    }
  }

  return removed;
}

/**
 * Remove import/export declarations from a source file one at a time,
 * re-querying after each removal so stale node references are never used.
 * Returns the count of declarations removed.
 */
function removeMatchingDeclarations(
  sf: TsMorphSourceFile,
  predicate: (decl: ImportDeclaration | ExportDeclaration) => boolean,
): number {
  let removed = 0;
  let found = true;
  while (found) {
    found = false;
    for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      if (predicate(decl)) {
        decl.remove();
        removed++;
        found = true;
        break;
      }
    }
  }
  return removed;
}
