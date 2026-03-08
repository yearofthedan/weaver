import * as path from "node:path";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import type { TsProvider } from "../providers/ts.js";
import type { LanguageProvider, MoveSymbolResult } from "../types.js";
import { assertFileExists } from "../utils/assert-file.js";

/**
 * Move a named export from `sourceFile` to `destFile`, updating all importers
 * within the workspace.
 *
 * `tsProvider` performs the AST surgery on TypeScript files.
 * `projectProvider.afterSymbolMove` runs a post-step for any files the TypeScript
 * language service doesn't see (e.g. `.vue` SFC script blocks in a Vue project).
 */
export async function moveSymbol(
  tsProvider: TsProvider,
  projectProvider: LanguageProvider,
  sourceFile: string,
  symbolName: string,
  destFile: string,
  scope: WorkspaceScope,
  options?: { force?: boolean },
): Promise<MoveSymbolResult> {
  const absSource = assertFileExists(sourceFile);
  const absDest = path.resolve(destFile);

  await tsProvider.moveSymbol(absSource, symbolName, absDest, scope, options);

  // Post-step: let the project provider handle any files ts-morph didn't see
  // (e.g. .vue SFC script blocks in a Vue project, or TS files outside tsconfig.include).
  // scope.modified already contains files rewritten by the ts-morph AST pass.
  await projectProvider.afterSymbolMove(absSource, symbolName, absDest, scope);

  return {
    filesModified: scope.modified,
    filesSkipped: scope.skipped,
    symbolName,
    sourceFile: absSource,
    destFile: absDest,
  };
}
