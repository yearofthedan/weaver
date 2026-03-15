/**
 * Tests for TsMorphCompiler.afterSymbolMove — the fallback scan that rewrites
 * imports in files outside tsconfig.include (test files, scripts, etc.).
 *
 * These test the method directly, not through the moveSymbol operation.
 * The method needs files already moved on disk before it runs — each test
 * manually sets up the post-move state rather than calling tsMoveSymbol.
 *
 * Covered here: orchestration (which files get scanned, what gets skipped).
 * Rewrite edge cases (bare specifier, .js extension, partial move, re-export)
 * are covered by ImportRewriter unit tests.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "../../src/__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTsConfig(dir: string, include: string[] = ["src/**/*.ts"]): void {
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include }),
  );
}

/**
 * Set up a workspace where `src/utils.ts` has already been moved to
 * `src/helpers.ts` (symbol `add`). The source file still exists but
 * no longer exports `add`. Returns paths for assertions.
 */
function setupPostMoveWorkspace(prefix: string) {
  const dir = makeTmpDir(prefix);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeTsConfig(dir);
  // Source file post-move: add removed
  fs.writeFileSync(
    path.join(dir, "src/utils.ts"),
    "export function mul(a: number, b: number): number { return a * b; }\n",
  );
  // Dest file post-move: add landed here
  fs.writeFileSync(
    path.join(dir, "src/helpers.ts"),
    "export function add(a: number, b: number): number { return a + b; }\n",
  );
  return {
    dir,
    sourceFile: path.join(dir, "src/utils.ts"),
    destFile: path.join(dir, "src/helpers.ts"),
  };
}

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("TsMorphCompiler.afterSymbolMove", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("does not rewrite a file that imports a different symbol from the same source", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-nomod-");
    dirs.push(dir);
    const originalContent = 'import { mul } from "../src/utils";\nconsole.log(mul(3, 4));\n';
    fs.writeFileSync(path.join(dir, "tests/consumer.ts"), originalContent);

    const compiler = new TsMorphCompiler();
    const scope = makeScope(dir);
    await compiler.afterSymbolMove(sourceFile, "add", destFile, scope);

    expect(fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8")).toBe(originalContent);
    expect(scope.modified).not.toContain(path.join(dir, "tests/consumer.ts"));
  });

  it("skips files already in scope.modified", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-skip-already-");
    dirs.push(dir);
    const consumerPath = path.join(dir, "tests/consumer.ts");
    const originalContent = 'import { add } from "../src/utils";\nconsole.log(add(1, 2));\n';
    fs.writeFileSync(consumerPath, originalContent);

    const compiler = new TsMorphCompiler();
    const scope = makeScope(dir);
    scope.recordModified(consumerPath);
    await compiler.afterSymbolMove(sourceFile, "add", destFile, scope);

    // File must be unchanged — it was already in scope.modified
    expect(fs.readFileSync(consumerPath, "utf8")).toBe(originalContent);
  });

  it("records nothing when no out-of-project files import the symbol", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-empty-");
    dirs.push(dir);
    // No test files importing add

    const compiler = new TsMorphCompiler();
    const scope = makeScope(dir);
    await compiler.afterSymbolMove(sourceFile, "add", destFile, scope);

    expect(scope.modified).toEqual([]);
    expect(scope.skipped).toEqual([]);
  });
});
