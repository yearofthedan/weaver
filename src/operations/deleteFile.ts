import * as path from "node:path";
import { Project } from "ts-morph";
import type { TsMorphCompiler } from "../compilers/ts.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { removeVueImportsOfDeletedFile } from "../plugins/vue/scan.js";
import { assertFileExists } from "../utils/assert-file.js";
import { TS_EXTENSIONS } from "../utils/extensions.js";
import { walkFiles } from "../utils/file-walk.js";
import type { DeleteFileResult } from "./types.js";

export async function deleteFile(
  tsCompiler: TsMorphCompiler,
  targetFile: string,
  scope: WorkspaceScope,
): Promise<DeleteFileResult> {
  const absTarget = assertFileExists(targetFile);
  let importRefsRemoved = 0;

  // Phase 1: In-project TS/JS cleanup via ts-morph.
  // ts-morph resolves module specifiers through the compiler, so it correctly
  // handles path aliases, index files, and all extension variants.
  const project = tsCompiler.getProjectForFile(absTarget);
  if (!project.getSourceFile(absTarget)) {
    project.addSourceFileAtPath(absTarget);
  }

  const projectFilePaths = new Set(
    project.getSourceFiles().map((sf) => sf.getFilePath() as string),
  );

  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath() as string;
    if (filePath === absTarget) continue;

    const hasRefs =
      sf
        .getImportDeclarations()
        .some((d) => d.getModuleSpecifierSourceFile()?.getFilePath() === absTarget) ||
      sf
        .getExportDeclarations()
        .some((d) => d.getModuleSpecifierSourceFile()?.getFilePath() === absTarget);

    if (!hasRefs) continue;

    if (!scope.contains(filePath)) {
      scope.recordSkipped(filePath);
      continue;
    }

    // Remove one declaration at a time and re-query after each removal so that
    // stale node references from the same SourceFile are never used.
    let found = true;
    while (found) {
      found = false;
      for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
        if (decl.getModuleSpecifierSourceFile()?.getFilePath() === absTarget) {
          decl.remove();
          importRefsRemoved++;
          found = true;
          break;
        }
      }
    }

    scope.recordModified(filePath);
  }

  for (const sf of project.getSourceFiles()) {
    if (!sf.isSaved() && scope.contains(sf.getFilePath() as string)) {
      await sf.save();
    }
  }

  // Phase 2: Out-of-project TS/JS cleanup.
  // Files outside tsconfig include aren't in ts-morph's project graph, so we
  // walk the workspace and handle them with a per-file in-memory project.
  // Module specifier resolution uses manual stripExt + path.resolve, which
  // matches all extension variants (bare, .ts, .tsx, .js, .jsx).
  const workspaceRoot = path.resolve(scope.root);
  const targetNoExt = stripExt(absTarget);

  for (const filePath of walkFiles(workspaceRoot, [...TS_EXTENSIONS])) {
    if (projectFilePaths.has(filePath)) continue;
    if (filePath === absTarget) continue;
    if (!scope.contains(filePath)) {
      scope.recordSkipped(filePath);
      continue;
    }

    let raw: string;
    try {
      raw = scope.fs.readFile(filePath);
    } catch {
      continue;
    }

    const tmpProject = new Project({ useInMemoryFileSystem: true });
    const sf = tmpProject.createSourceFile(filePath, raw);
    const fromDir = path.dirname(filePath);

    let removed = 0;
    let found = true;
    while (found) {
      found = false;
      for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
        const specifier = decl.getModuleSpecifierValue();
        if (!specifier || !specifier.startsWith(".")) continue;
        if (stripExt(path.resolve(fromDir, specifier)) === targetNoExt) {
          decl.remove();
          removed++;
          found = true;
          break;
        }
      }
    }

    if (removed === 0) continue;
    importRefsRemoved += removed;
    scope.writeFile(filePath, sf.getFullText());
  }

  // Phase 3: Vue SFC cleanup.
  // The TypeScript compiler is blind to imports inside <script> blocks in .vue
  // files, so we scan them with regex (same approach as updateVueImportsAfterMove).
  const { skipped: vueSkipped, refsRemoved: vueRefs } = removeVueImportsOfDeletedFile(
    absTarget,
    workspaceRoot,
    scope,
  );
  for (const f of vueSkipped) scope.recordSkipped(f);
  importRefsRemoved += vueRefs;

  // Phase 4: Physical deletion — after all importer edits are written so that
  // ts-morph can still resolve module specifiers during phases 1–2.
  scope.fs.unlink(absTarget);

  // Phase 5: Drop the cached project so the next request rebuilds without the
  // deleted file. The watcher's `unlink` event also triggers invalidateAll, but
  // the operation must not rely on that timing.
  tsCompiler.invalidateProject(absTarget);

  return {
    deletedFile: absTarget,
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    importRefsRemoved,
  };
}

function stripExt(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}
