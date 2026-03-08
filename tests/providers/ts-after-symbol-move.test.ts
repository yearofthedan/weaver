/**
 * Tests for TsProvider.afterSymbolMove — the fallback scan that rewrites
 * imports in files outside tsconfig.include (test files, scripts, etc.).
 *
 * These test the method directly, not through the moveSymbol operation.
 * The method needs files already moved on disk before it runs — each test
 * manually sets up the post-move state rather than calling tsMoveSymbol.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup } from "../helpers.js";

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

describe("TsProvider.afterSymbolMove", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("rewrites a bare specifier (no extension) in an out-of-project file", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-bare-");
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tests/consumer.ts"),
      'import { add } from "../src/utils";\nconsole.log(add(1, 2));\n',
    );

    const provider = new TsProvider();
    const scope = makeScope(dir);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    const content = fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8");
    expect(content).toContain("../src/helpers.js");
    expect(content).not.toContain("../src/utils");
    expect(scope.modified).toContain(path.join(dir, "tests/consumer.ts"));
  });

  it("rewrites a .js-extension specifier in an out-of-project file", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-jsext-");
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tests/consumer.ts"),
      'import { add } from "../src/utils.js";\nconsole.log(add(1, 2));\n',
    );

    const provider = new TsProvider();
    const scope = makeScope(dir);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    const content = fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8");
    expect(content).toContain("../src/helpers.js");
    expect(content).not.toContain("../src/utils.js");
    expect(scope.modified).toContain(path.join(dir, "tests/consumer.ts"));
  });

  it("splits a multi-named-import when only one symbol was moved", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-partial-");
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tests/consumer.ts"),
      'import { add, mul } from "../src/utils";\nconsole.log(add(1, 2), mul(3, 4));\n',
    );

    const provider = new TsProvider();
    const scope = makeScope(dir);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    const content = fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8");
    expect(content).toMatch(/import\s*\{[^}]*mul[^}]*\}\s*from\s*["']\.\.\/src\/utils/);
    expect(content).toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\.\/src\/helpers\.js/);
    expect(content).not.toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\.\/src\/utils/);
    expect(scope.modified).toContain(path.join(dir, "tests/consumer.ts"));
  });

  it("rewrites a re-export declaration in an out-of-project file", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-reexport-");
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "tests/barrel.ts"), 'export { add } from "../src/utils";\n');

    const provider = new TsProvider();
    const scope = makeScope(dir);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    const content = fs.readFileSync(path.join(dir, "tests/barrel.ts"), "utf8");
    expect(content).toContain("../src/helpers.js");
    expect(content).not.toContain("../src/utils");
    expect(scope.modified).toContain(path.join(dir, "tests/barrel.ts"));
  });

  it("does not rewrite a file that imports a different symbol from the same source", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-nomod-");
    dirs.push(dir);
    const originalContent = 'import { mul } from "../src/utils";\nconsole.log(mul(3, 4));\n';
    fs.writeFileSync(path.join(dir, "tests/consumer.ts"), originalContent);

    const provider = new TsProvider();
    const scope = makeScope(dir);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    expect(fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8")).toBe(originalContent);
    expect(scope.modified).not.toContain(path.join(dir, "tests/consumer.ts"));
  });

  it("skips files already in scope.modified", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-skip-already-");
    dirs.push(dir);
    const consumerPath = path.join(dir, "tests/consumer.ts");
    const originalContent = 'import { add } from "../src/utils";\nconsole.log(add(1, 2));\n';
    fs.writeFileSync(consumerPath, originalContent);

    const provider = new TsProvider();
    const scope = makeScope(dir);
    scope.recordModified(consumerPath);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    // File must be unchanged — it was already in scope.modified
    expect(fs.readFileSync(consumerPath, "utf8")).toBe(originalContent);
  });

  it("records nothing when no out-of-project files import the symbol", async () => {
    const { dir, sourceFile, destFile } = setupPostMoveWorkspace("asm-empty-");
    dirs.push(dir);
    // No test files importing add

    const provider = new TsProvider();
    const scope = makeScope(dir);
    await provider.afterSymbolMove(sourceFile, "add", destFile, scope);

    expect(scope.modified).toEqual([]);
    expect(scope.skipped).toEqual([]);
  });
});
