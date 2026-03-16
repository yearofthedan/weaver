import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../src/__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { getTypeErrors, getTypeErrorsForFiles } from "../../src/operations/getTypeErrors.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("getTypeErrors operation", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.tsErrors.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("single file mode (file param provided)", () => {
    it("returns type errors with correct shape for a file with errors", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      // broken.ts has exactly 3 deliberate errors
      expect(result.errorCount).toBe(3);
      expect(result.diagnostics).toHaveLength(3);
      expect(result.truncated).toBe(false);

      // Every diagnostic must have the required shape
      for (const diag of result.diagnostics) {
        expect(diag.file).toBe(`${dir}/src/broken.ts`);
        expect(diag.line).toBeGreaterThan(0);
        expect(diag.col).toBeGreaterThan(0);
        expect(diag.code).toBeGreaterThan(0);
        expect(typeof diag.code).toBe("number");
        expect(diag.message.length).toBeGreaterThan(0);
      }
    });

    it("pins the exact error codes, positions and messages for broken.ts", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      const diags = result.diagnostics.slice().sort((a, b) => a.line - b.line);

      expect(diags[0]).toMatchObject({
        line: 6,
        col: 17,
        code: 2345,
        message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
      });
      expect(diags[1]).toMatchObject({
        line: 8,
        col: 7,
        code: 2322,
        message: "Type 'number' is not assignable to type 'string'.",
      });
      expect(diags[2]).toMatchObject({
        line: 10,
        col: 7,
        code: 2322,
        message: "Type 'number' is not assignable to type 'boolean'.",
      });
    });

    it("returns only the top-level message for chained diagnostics, not the full chain", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      // chained-error.ts: function argument with wrong property type — produces a
      // DiagnosticMessageChain where d.messageText is an object (not a string):
      //   chain[0]: "Type '(x: number) => string' is not assignable to type '(x: string) => number'."
      //   chain[1]: "Types of parameters 'x' and 'x' are incompatible."
      //   chain[2]: "Type 'string' is not assignable to type 'number'."
      const result = await getTypeErrors(compiler, `${dir}/src/chained-error.ts`, makeScope(dir));

      expect(result.diagnostics).toHaveLength(1);
      const { message } = result.diagnostics[0];

      // Top-level node only: the function type mismatch
      expect(message).toContain("not assignable to type '(x: string) => number'");
      // Chain levels must NOT be present — they balloon message size for complex generic types
      expect(message).not.toContain("Types of parameters");
      expect(message).not.toContain("Type 'string' is not assignable to type 'number'");
    });

    it("returns empty diagnostics for a clean file", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, `${dir}/src/clean.ts`, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      await expect(
        getTypeErrors(compiler, `${dir}/src/doesNotExist.ts`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws WORKSPACE_VIOLATION for a file outside the workspace", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      await expect(getTypeErrors(compiler, "/etc/hosts", makeScope(dir))).rejects.toMatchObject({
        code: "WORKSPACE_VIOLATION",
      });
    });

    it("errorCount equals diagnostics.length when not truncated", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      // When not truncated, errorCount is the true total and equals diagnostics.length
      expect(result.errorCount).toBe(result.diagnostics.length);
      expect(result.truncated).toBe(false);
    });

    it("caps at 100 and sets truncated=true when a single file has more than 100 errors", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      // many-errors.ts has 105 deliberate type errors
      const result = await getTypeErrors(compiler, `${dir}/src/many-errors.ts`, makeScope(dir));

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.errorCount).toBe(105);
    });

    it("is not truncated and errorCount equals 100 when a file has exactly 100 errors", async () => {
      const dir = setup("ts-100-errors");
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, `${dir}/src/exactly-100.ts`, makeScope(dir));

      expect(result.truncated).toBe(false);
      expect(result.errorCount).toBe(100);
      expect(result.diagnostics).toHaveLength(100);
    });
  });

  describe("project-wide mode (no file param)", () => {
    it("returns errors from all files in the project", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      // broken.ts (3 errors) + many-errors.ts (105 errors) = 108 total, so truncated
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    it("caps at 100 and sets truncated=true; errorCount reflects the full total", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      // errorCount is the total found, not the capped count
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.errorCount).toBeGreaterThan(result.diagnostics.length);
    });

    it("is not truncated and errorCount equals 100 when the project has exactly 100 errors", async () => {
      const dir = setup("ts-100-errors");
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.truncated).toBe(false);
      expect(result.errorCount).toBe(100);
      expect(result.diagnostics).toHaveLength(100);
    });

    it("returns empty result for a project with no errors", async () => {
      const dir = setup("simple-ts");
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("each diagnostic in project-wide results has the correct shape", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      for (const diag of result.diagnostics) {
        expect(typeof diag.file).toBe("string");
        expect(diag.file.length).toBeGreaterThan(0);
        expect(diag.line).toBeGreaterThan(0);
        expect(diag.col).toBeGreaterThan(0);
        expect(typeof diag.code).toBe("number");
        expect(diag.code).toBeGreaterThan(0);
        expect(typeof diag.message).toBe("string");
        expect(diag.message.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("getTypeErrorsForFiles helper", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.tsErrors.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  it("returns an empty result for an empty file list", () => {
    setup(); // create fixture dir so afterEach cleanup runs
    const compiler = new TsMorphCompiler();

    const result = getTypeErrorsForFiles(compiler, [], new NodeFileSystem());

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  it("silently skips non-.ts files and returns empty", () => {
    const dir = setup();
    const compiler = new TsMorphCompiler();

    const result = getTypeErrorsForFiles(
      compiler,
      [`${dir}/some-component.vue`, `${dir}/config.json`],
      new NodeFileSystem(),
    );

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  it("returns type errors with correct shape for a .ts file with errors", () => {
    const dir = setup();
    const compiler = new TsMorphCompiler();

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

  it("returns typeErrors:[], typeErrorCount:0, typeErrorsTruncated:false for a clean .ts file", () => {
    const dir = setup();
    const compiler = new TsMorphCompiler();

    // AC2 equivalent: clean file → all three fields present but empty/zero/false
    const result = getTypeErrorsForFiles(compiler, [`${dir}/src/clean.ts`], new NodeFileSystem());

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    expect(result.typeErrorsTruncated).toBe(false);
  });

  it("only checks the provided files — errors in other files are not included", () => {
    const dir = setup(); // ts-errors fixture: broken.ts has 3 errors, clean.ts has 0
    const compiler = new TsMorphCompiler();

    // AC4 equivalent: provide only clean.ts; broken.ts has errors but is not listed
    const result = getTypeErrorsForFiles(compiler, [`${dir}/src/clean.ts`], new NodeFileSystem());

    expect(result.typeErrors).toEqual([]);
    expect(result.typeErrorCount).toBe(0);
    // Verify we're not accidentally including broken.ts errors
    const files = result.typeErrors.map((d) => d.file);
    expect(files.every((f) => f.endsWith("clean.ts"))).toBe(true);
  });

  it("aggregates errors across multiple files with correct total count", () => {
    const dir = setup();
    const compiler = new TsMorphCompiler();

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

  it("caps typeErrors at 100 and sets typeErrorsTruncated:true when a file exceeds the limit", () => {
    const dir = setup();
    const compiler = new TsMorphCompiler();

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
