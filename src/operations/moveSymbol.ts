import * as path from "node:path";
import type { TsMorphCompiler } from "../compilers/ts.js";
import type { Compiler } from "../compilers/types.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { assertFileExists } from "../utils/assert-file.js";
import type { MoveSymbolResult } from "./types.js";

/**
 * Move a named export from `sourceFile` to `destFile`, updating all importers
 * within the workspace.
 *
 * `tsCompiler` performs the AST surgery on TypeScript files.
 * `projectCompiler.afterSymbolMove` runs a post-step for any files the TypeScript
 * language service doesn't see (e.g. `.vue` SFC script blocks in a Vue project).
 */
export async function moveSymbol(
  tsCompiler: TsMorphCompiler,
  projectCompiler: Compiler,
  sourceFile: string,
  symbolName: string,
  destFile: string,
  scope: WorkspaceScope,
  options?: { force?: boolean },
): Promise<MoveSymbolResult> {
  const absSource = assertFileExists(sourceFile);
  const absDest = path.resolve(destFile);

  await tsCompiler.moveSymbol(absSource, symbolName, absDest, scope, options);

  // Post-step: let the project compiler handle any files ts-morph didn't see
  // (e.g. .vue SFC script blocks in a Vue project, or TS files outside tsconfig.include).
  // scope.modified already contains files rewritten by the ts-morph AST pass.
  await projectCompiler.afterSymbolMove(absSource, symbolName, absDest, scope);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    symbolName,
    sourceFile: absSource,
    destFile: absDest,
  };
}
