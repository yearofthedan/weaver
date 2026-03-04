import * as fs from "node:fs";
import * as path from "node:path";
import { Project } from "ts-morph";
import { removeVueImportsOfDeletedFile } from "../plugins/vue/scan.js";
import type { TsProvider } from "../providers/ts.js";
import { isWithinWorkspace } from "../security.js";
import type { DeleteFileResult } from "../types.js";
import { assertFileExists } from "../utils/assert-file.js";
import { TS_EXTENSIONS, walkFiles } from "../utils/file-walk.js";

export async function deleteFile(
  tsProvider: TsProvider,
  targetFile: string,
  workspace: string,
): Promise<DeleteFileResult> {
  const absTarget = assertFileExists(targetFile);
  const filesModified = new Set<string>();
  const filesSkipped = new Set<string>();
  let importRefsRemoved = 0;

  // Phase 1: In-project TS/JS cleanup via ts-morph.
  // ts-morph resolves module specifiers through the compiler, so it correctly
  // handles path aliases, index files, and all extension variants.
  const project = tsProvider.getProjectForFile(absTarget);
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

    if (!isWithinWorkspace(filePath, workspace)) {
      filesSkipped.add(filePath);
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

    filesModified.add(filePath);
  }

  for (const sf of project.getSourceFiles()) {
    if (!sf.isSaved() && isWithinWorkspace(sf.getFilePath() as string, workspace)) {
      await sf.save();
    }
  }

  // Phase 2: Out-of-project TS/JS cleanup.
  // Files outside tsconfig include aren't in ts-morph's project graph, so we
  // walk the workspace and handle them with a per-file in-memory project.
  // Module specifier resolution uses manual stripExt + path.resolve, which
  // matches all extension variants (bare, .ts, .tsx, .js, .jsx).
  const workspaceRoot = path.resolve(workspace);
  const targetNoExt = stripExt(absTarget);

  for (const filePath of walkFiles(workspaceRoot, [...TS_EXTENSIONS])) {
    if (projectFilePaths.has(filePath)) continue;
    if (filePath === absTarget) continue;
    if (!isWithinWorkspace(filePath, workspace)) {
      filesSkipped.add(filePath);
      continue;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
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
    fs.writeFileSync(filePath, sf.getFullText(), "utf8");
    filesModified.add(filePath);
  }

  // Phase 3: Vue SFC cleanup.
  // The TypeScript compiler is blind to imports inside <script> blocks in .vue
  // files, so we scan them with regex (same approach as updateVueImportsAfterMove).
  const {
    modified: vueModified,
    skipped: vueSkipped,
    refsRemoved: vueRefs,
  } = removeVueImportsOfDeletedFile(absTarget, workspaceRoot, workspace);
  for (const f of vueModified) filesModified.add(f);
  for (const f of vueSkipped) filesSkipped.add(f);
  importRefsRemoved += vueRefs;

  // Phase 4: Physical deletion — after all importer edits are written so that
  // ts-morph can still resolve module specifiers during phases 1–2.
  fs.unlinkSync(absTarget);

  // Phase 5: Drop the cached project so the next request rebuilds without the
  // deleted file. The watcher's `unlink` event also triggers invalidateAll, but
  // the operation must not rely on that timing.
  tsProvider.invalidateProject(absTarget);

  return {
    deletedFile: absTarget,
    filesModified: Array.from(filesModified),
    filesSkipped: Array.from(filesSkipped),
    importRefsRemoved,
  };
}

function stripExt(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}
