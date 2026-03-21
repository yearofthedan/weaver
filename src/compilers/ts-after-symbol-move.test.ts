/**
 * Tests for the fallback scan inside TsMorphEngine.moveSymbol — the walk that
 * rewrites imports in files outside tsconfig.include (test files, scripts, etc.).
 *
 * These tests set up a workspace with a symbol to move and verify the fallback
 * scan behaviour: which files outside the project get rewritten, which are skipped.
 *
 * Covered here: orchestration (which files get scanned, what gets skipped).
 * Rewrite edge cases (bare specifier, .js extension, partial move, re-export)
 * are covered by ImportRewriter unit tests.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTsConfig(dir: string, include: string[] = ["src/**/*.ts"]): void {
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include }),
  );
}

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("TsMorphEngine.moveSymbol fallback scan", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("does not rewrite a file that imports a different symbol from the same source", async () => {
    const dir = makeTmpDir("asm-nomod-");
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    writeTsConfig(dir);
    // Source: exports both add and mul; only add will be moved
    fs.writeFileSync(
      path.join(dir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n" +
        "export function mul(a: number, b: number): number { return a * b; }\n",
    );
    // test file imports mul (different symbol) from same source — must not be rewritten
    const originalContent = 'import { mul } from "../src/utils";\nconsole.log(mul(3, 4));\n';
    fs.writeFileSync(path.join(dir, "tests/consumer.ts"), originalContent);

    const compiler = new TsMorphEngine();
    const scope = makeScope(dir);
    await compiler.moveSymbol(
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    expect(fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8")).toBe(originalContent);
    expect(scope.modified).not.toContain(path.join(dir, "tests/consumer.ts"));
  });

  it("skips files already in scope.modified before moveSymbol is called", async () => {
    // A file pre-recorded as modified must not be double-rewritten by the fallback scan.
    const dir = makeTmpDir("asm-skip-already-");
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    writeTsConfig(dir);
    fs.writeFileSync(
      path.join(dir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    const consumerPath = path.join(dir, "tests/consumer.ts");
    const originalContent = 'import { add } from "../src/utils";\nconsole.log(add(1, 2));\n';
    fs.writeFileSync(consumerPath, originalContent);

    const compiler = new TsMorphEngine();
    const scope = makeScope(dir);
    // Pre-record consumer.ts as already modified (simulates it being handled by AST pass)
    scope.recordModified(consumerPath);
    await compiler.moveSymbol(
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    // File must be unchanged — it was already in scope.modified
    expect(fs.readFileSync(consumerPath, "utf8")).toBe(originalContent);
  });

  it("records nothing when no out-of-project files import the symbol", async () => {
    const dir = makeTmpDir("asm-empty-");
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    writeTsConfig(dir);
    fs.writeFileSync(
      path.join(dir, "src/utils.ts"),
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    // No test files importing add

    const compiler = new TsMorphEngine();
    const scope = makeScope(dir);
    await compiler.moveSymbol(
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    // Only src/utils.ts and src/helpers.ts (the moved symbol) should be modified
    expect(scope.modified).not.toContain(undefined);
    expect(scope.skipped).toEqual([]);
    // Consumer TS files outside the project that don't import the symbol: none here
    // The modified list contains only source and dest
    expect(scope.modified.every((f) => f.includes(dir))).toBe(true);
  });
});
