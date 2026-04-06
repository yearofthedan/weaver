import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { getTypeErrorsForFiles } from "./post-write-diagnostics.js";

describe("getTypeErrorsForFiles", () => {
  test.override({ fixtureName: FIXTURES.tsErrors.name });

  test("returns an empty result for an empty file list", ({ dir: _dir }) => {
    const compiler = new TsMorphEngine();

    const result = getTypeErrorsForFiles(compiler, [], new NodeFileSystem());

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("silently skips non-.ts files and returns empty", ({ dir }) => {
    const compiler = new TsMorphEngine();

    const result = getTypeErrorsForFiles(
      compiler,
      [`${dir}/some-component.vue`, `${dir}/config.json`],
      new NodeFileSystem(),
    );

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("returns type errors with correct shape for a .ts file with errors", ({ dir }) => {
    const compiler = new TsMorphEngine();

    const result = getTypeErrorsForFiles(compiler, [`${dir}/src/broken.ts`], new NodeFileSystem());

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

  test("returns typeErrors:[], typeErrorCount:0, typeErrorsTruncated:false for a clean .ts file", ({
    dir,
  }) => {
    const compiler = new TsMorphEngine();

    const result = getTypeErrorsForFiles(compiler, [`${dir}/src/clean.ts`], new NodeFileSystem());

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  test("only checks the provided files — errors in other files are not included", ({ dir }) => {
    const compiler = new TsMorphEngine();

    // provide only clean.ts; broken.ts has errors but is not listed
    const result = getTypeErrorsForFiles(compiler, [`${dir}/src/clean.ts`], new NodeFileSystem());

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    // Verify we're not accidentally including broken.ts errors
    const files = result.typeErrors.map((d) => d.file);
    expect(files.every((f) => f.endsWith("clean.ts"))).toBe(true);
  });

  test("aggregates errors across multiple files with correct total count", ({ dir }) => {
    const compiler = new TsMorphEngine();

    // broken.ts: 3 errors, chained-error.ts: 1 error
    const result = getTypeErrorsForFiles(
      compiler,
      [`${dir}/src/broken.ts`, `${dir}/src/chained-error.ts`],
      new NodeFileSystem(),
    );

    expect(result.typeErrorCount).toBe(4);
    expect(result.typeErrors).toHaveLength(4);
    expect(result.typeErrorsTruncated).toBe(false);
    const files = new Set(result.typeErrors.map((d) => d.file));
    expect(files.size).toBe(2);
  });

  test("caps typeErrors at 100 and sets typeErrorsTruncated:true when a file exceeds the limit", ({
    dir,
  }) => {
    const compiler = new TsMorphEngine();

    // many-errors.ts has 105 errors
    const result = getTypeErrorsForFiles(
      compiler,
      [`${dir}/src/many-errors.ts`],
      new NodeFileSystem(),
    );

    expect(result.typeErrorsTruncated).toBe(true);
    expect(result.typeErrors).toHaveLength(100);
    expect(result.typeErrorCount).toBe(105);
  });
});
