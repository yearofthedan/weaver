import * as fs from "node:fs";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { getTypeErrorsForFiles } from "./post-write-diagnostics.js";

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("getTypeErrorsForFiles", () => {
  test("returns an empty result for an empty file list", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(compiler, [], makeScope(dir));

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("silently skips non-.ts files and returns empty", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(
      compiler,
      [`${dir}/some-component.vue`, `${dir}/config.json`],
      makeScope(dir),
    );

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("returns type errors with correct shape for a .ts file with errors", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(compiler, [`${dir}/src/broken.ts`], makeScope(dir));

    // broken.ts has exactly 3 deliberate errors
    expect(result.typeErrorCount).toBe(3);
    expect(result.typeErrors).toHaveLength(3);
    expect(result.typeErrorsTruncated).toBe(false);
    for (const d of result.typeErrors) {
      expect(d.file).toBe(`${dir}/src/broken.ts`);
      expect(d.line).toBeGreaterThan(0);
      expect(d.col).toBeGreaterThan(0);
      expect(typeof d.code).toBe("number");
      expect(d.code).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(0);
    }
  });

  test("returns typeErrors:[], typeErrorCount:0, typeErrorsTruncated:false for a clean .ts file", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(compiler, [`${dir}/src/clean.ts`], makeScope(dir));

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("only checks the provided files — errors in other files are not included", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    // provide only clean.ts; broken.ts has errors but is not listed
    const result = await getTypeErrorsForFiles(compiler, [`${dir}/src/clean.ts`], makeScope(dir));

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    // Verify we're not accidentally including broken.ts errors
    const files = result.typeErrors.map((d) => d.file);
    expect(files.every((f) => f.endsWith("clean.ts"))).toBe(true);
  });

  test("aggregates errors across multiple files with correct total count", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    // broken.ts: 3 errors, chained-error.ts: 1 error
    const result = await getTypeErrorsForFiles(
      compiler,
      [`${dir}/src/broken.ts`, `${dir}/src/chained-error.ts`],
      makeScope(dir),
    );

    expect(result.typeErrorCount).toBe(4);
    expect(result.typeErrors).toHaveLength(4);
    expect(result.typeErrorsTruncated).toBe(false);
    const files = new Set(result.typeErrors.map((d) => d.file));
    expect(files.size).toBe(2);
  });

  test("caps typeErrors at 100 and sets typeErrorsTruncated:true when a file exceeds the limit", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();

    // many-errors.ts has 105 errors
    const result = await getTypeErrorsForFiles(
      compiler,
      [`${dir}/src/many-errors.ts`],
      makeScope(dir),
    );

    expect(result.typeErrorsTruncated).toBe(true);
    expect(result.typeErrors).toHaveLength(100);
    expect(result.typeErrorCount).toBe(105);
  });

  test("skips a non-TS file that exists, not merely one that is absent", async ({
    seedInlineFixture,
  }) => {
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src/**/*.ts"],
      }),
      "src/ok.ts": "export const a: number = 1;\n",
      // Real file, real type error, but not a TS extension — must never be checked.
      "src/Broken.vue": "<script lang='ts'>const bad: number = 'no';</script>\n",
    });
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(compiler, [`${dir}/src/Broken.vue`], makeScope(dir));

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
  });

  test("does not flag truncation when the total across files is exactly the cap", async ({
    seedInlineFixture,
  }) => {
    const half = (n: number) =>
      Array.from({ length: n }, (_, i) => `export const e${i}: number = 'x';`).join("\n");
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src/**/*.ts"],
      }),
      "src/a.ts": `${half(50)}\n`,
      "src/b.ts": `${half(50)}\n`,
    });
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(
      compiler,
      [`${dir}/src/a.ts`, `${dir}/src/b.ts`],
      makeScope(dir),
    );

    expect(result.typeErrorCount).toBe(100);
    expect(result.typeErrors).toHaveLength(100);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("caps the collected list at 100 when several files each contribute errors", async ({
    seedInlineFixture,
  }) => {
    const errors = (n: number) =>
      Array.from({ length: n }, (_, i) => `export const e${i}: number = 'x';`).join("\n");
    const dir = await seedInlineFixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src/**/*.ts"],
      }),
      "src/a.ts": `${errors(60)}\n`,
      "src/b.ts": `${errors(60)}\n`,
    });
    const compiler = new TsMorphEngine();

    const result = await getTypeErrorsForFiles(
      compiler,
      [`${dir}/src/a.ts`, `${dir}/src/b.ts`],
      makeScope(dir),
    );

    expect(result.typeErrors).toHaveLength(100);
    expect(result.typeErrorCount).toBe(120);
    expect(result.typeErrorsTruncated).toBe(true);
  });

  test("refreshes each file from disk so content written after the project loaded is seen", async ({
    seedNamedFixture,
  }) => {
    const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
    const compiler = new TsMorphEngine();
    const file = `${dir}/src/clean.ts`;
    // Load the project against the original, clean content.
    compiler.getLanguageServiceForFile(file);
    // Simulate a write that lands after the project was loaded but before the check.
    fs.writeFileSync(file, "export const bad: number = 'not-a-number';\n");

    const result = await getTypeErrorsForFiles(compiler, [file], makeScope(dir));

    expect(result.typeErrorCount).toBeGreaterThanOrEqual(1);
    expect(result.typeErrors.some((d) => d.file === file)).toBe(true);
  });
});
