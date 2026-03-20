import * as path from "node:path";
import type {
  ExportDeclaration,
  ImportDeclaration,
  SourceFile as TsMorphSourceFile,
} from "ts-morph";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { stripExt, TS_EXTENSIONS } from "../utils/extensions.js";
import { walkFiles } from "../utils/file-walk.js";
import { createThrowawaySourceFile } from "./throwaway-project.js";
import type { TsMorphCompiler } from "./ts.js";

/**
 * Removes all import and export declarations that reference `targetFile` from
 * every in-scope TS/JS file. In-project files are resolved via the ts-morph
 * compiler; out-of-project files are matched by specifier path.
 *
 * Returns the total count of declarations removed across all files.
 *
 * Files outside `scope.root` are recorded as skipped and never written.
 */
export async function tsRemoveImportersOf(
  compiler: TsMorphCompiler,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<number> {
  let importRefsRemoved = 0;

  const { projectFilePaths, removed: inProjectRemoved } = await removeInProjectImporters(
    compiler,
    targetFile,
    scope,
  );
  importRefsRemoved += inProjectRemoved;

  const outOfProjectRemoved = removeOutOfProjectImporters(targetFile, projectFilePaths, scope);
  importRefsRemoved += outOfProjectRemoved;

  return importRefsRemoved;
}

/**
 * Phase 1: In-project TS/JS cleanup via ts-morph.
 * ts-morph resolves module specifiers through the compiler, so it correctly
 * handles path aliases, index files, and all extension variants.
 */
async function removeInProjectImporters(
  compiler: TsMorphCompiler,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<{ projectFilePaths: Set<string>; removed: number }> {
  const project = compiler.getProjectForFile(targetFile);
  if (!project.getSourceFile(targetFile)) {
    project.addSourceFileAtPath(targetFile);
  }

  const projectFilePaths = new Set(
    project.getSourceFiles().map((sf) => sf.getFilePath() as string),
  );

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

  return { projectFilePaths, removed };
}

/**
 * Phase 2: Out-of-project TS/JS cleanup.
 * Files outside tsconfig include aren't in ts-morph's project graph, so we
 * walk the workspace and match specifiers by resolved path.
 */
function removeOutOfProjectImporters(
  targetFile: string,
  projectFilePaths: Set<string>,
  scope: WorkspaceScope,
): number {
  const workspaceRoot = path.resolve(scope.root);
  const targetNoExt = stripExt(targetFile);
  let totalRemoved = 0;

  for (const filePath of walkFiles(workspaceRoot, [...TS_EXTENSIONS])) {
    if (projectFilePaths.has(filePath)) continue;
    if (filePath === targetFile) continue;
    if (!scope.contains(filePath)) {
      scope.recordSkipped(filePath);
      continue;
    }

    let raw: string;
    try {
      raw = scope.fs.readFile(filePath);
    } catch {
      scope.recordSkipped(filePath);
      continue;
    }

    const sf = createThrowawaySourceFile(filePath, raw);
    const fromDir = path.dirname(filePath);

    const removed = removeMatchingDeclarations(sf, (decl) => {
      const specifier = decl.getModuleSpecifierValue();
      if (!specifier || !specifier.startsWith(".")) return false;
      return stripExt(path.resolve(fromDir, specifier)) === targetNoExt;
    });

    if (removed === 0) continue;
    totalRemoved += removed;
    scope.writeFile(filePath, sf.getFullText());
  }

  return totalRemoved;
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
