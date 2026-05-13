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
import * as path from "node:path";
import { describe, expect } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true },
  include: ["src/**/*.ts"],
});

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("TsMorphEngine.moveSymbol fallback scan", () => {
  test("does not rewrite a file that imports a different symbol from the same source", async ({
    dir,
    seedInlineFixture,
  }) => {
    const originalConsumer = 'import { mul } from "../src/utils";\nconsole.log(mul(3, 4));\n';
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/utils.ts":
        "export function add(a: number, b: number): number { return a + b; }\n" +
        "export function mul(a: number, b: number): number { return a * b; }\n",
      "tests/consumer.ts": originalConsumer,
    });

    const compiler = new TsMorphEngine();
    const scope = makeScope(dir);
    await compiler.moveSymbol(
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    expect(fs.readFileSync(path.join(dir, "tests/consumer.ts"), "utf8")).toBe(originalConsumer);
    expect(scope.modified).not.toContain(path.join(dir, "tests/consumer.ts"));
  });

  test("skips files already in scope.modified before moveSymbol is called", async ({
    dir,
    seedInlineFixture,
  }) => {
    const originalConsumer = 'import { add } from "../src/utils";\nconsole.log(add(1, 2));\n';
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/utils.ts": "export function add(a: number, b: number): number { return a + b; }\n",
      "tests/consumer.ts": originalConsumer,
    });
    const consumerPath = path.join(dir, "tests/consumer.ts");

    const compiler = new TsMorphEngine();
    const scope = makeScope(dir);
    scope.recordModified(consumerPath);
    await compiler.moveSymbol(
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    expect(fs.readFileSync(consumerPath, "utf8")).toBe(originalConsumer);
  });

  test("records nothing when no out-of-project files import the symbol", async ({
    dir,
    seedInlineFixture,
  }) => {
    await seedInlineFixture({
      "tsconfig.json": TSCONFIG,
      "src/utils.ts": "export function add(a: number, b: number): number { return a + b; }\n",
    });

    const compiler = new TsMorphEngine();
    const scope = makeScope(dir);
    await compiler.moveSymbol(
      path.join(dir, "src/utils.ts"),
      "add",
      path.join(dir, "src/helpers.ts"),
      scope,
    );

    expect(scope.modified).not.toContain(undefined);
    expect(scope.skipped).toEqual([]);
    expect(scope.modified.every((f) => f.includes(dir))).toBe(true);
  });
});
