/**
 * Shared setup helpers for moveSymbol tests.
 *
 * Extracted from moveSymbol.test.ts to keep the main test file under the
 * 500-line threshold. These helpers provide project scaffolding utilities
 * used across multiple test groups.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { TsProvider } from "../../src/providers/ts.js";
import { copyFixture } from "../helpers.js";

export { copyFixture };

/**
 * Create a temp directory with a prefix.
 */
export function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Write tsconfig.json with strict: true and a given include pattern.
 */
export function writeTsConfig(dir: string, include: string[] = ["**/*.ts"]): void {
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include }),
  );
}

/**
 * Set up a simple-ts fixture copy with a fresh TsProvider.
 * Returns the dir and provider. The caller must push dir to a cleanup list.
 */
export function setupSimpleTs(): { dir: string; tsProvider: TsProvider } {
  const dir = copyFixture("simple-ts");
  return { dir, tsProvider: new TsProvider() };
}

/**
 * Set up a multi-importer fixture copy with a fresh TsProvider.
 * Returns the dir and provider. The caller must push dir to a cleanup list.
 */
export function setupMultiImporter(): { dir: string; tsProvider: TsProvider } {
  const dir = copyFixture("multi-importer");
  return { dir, tsProvider: new TsProvider() };
}

/**
 * Set up a conflict scenario: src/a.ts exports FOO=1, src/b.ts exports FOO=42.
 * Returns a fresh TsProvider. Caller must push dir to cleanup list.
 */
export function setupConflictScenario(dir: string): TsProvider {
  fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
  fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
  return new TsProvider();
}

/**
 * Convenience wrapper: move a symbol within a project using TsProvider as both
 * tsProvider and projectProvider. Reduces boilerplate in tests that only care
 * about the TS path.
 */
export function moveWithTs(
  tsProvider: TsProvider,
  srcFile: string,
  symbolName: string,
  dstFile: string,
  workspace: string,
  opts?: { force?: boolean },
) {
  const scope = new WorkspaceScope(workspace, new NodeFileSystem());
  return moveSymbol(tsProvider, tsProvider, srcFile, symbolName, dstFile, scope, opts);
}

/**
 * Move `symbolName` from `src/utils.ts` to `src/helpers.ts` within a
 * simple-ts fixture copy. Registers the fixture dir for cleanup.
 * Returns both the result and the dir path.
 */
export async function moveGreetUser(
  dirs: string[],
  opts?: { force?: boolean },
): Promise<{ result: Awaited<ReturnType<typeof moveSymbol>>; dir: string }> {
  const dir = copyFixture("simple-ts");
  dirs.push(dir);
  const tsProvider = new TsProvider();
  const result = await moveWithTs(
    tsProvider,
    `${dir}/src/utils.ts`,
    "greetUser",
    `${dir}/src/helpers.ts`,
    dir,
    opts,
  );
  return { result, dir };
}
