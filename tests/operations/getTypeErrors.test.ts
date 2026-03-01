import { afterEach, describe, expect, it } from "vitest";
import { getTypeErrors } from "../../src/operations/getTypeErrors.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup, copyFixture } from "../helpers.js";

describe("getTypeErrors operation", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "ts-errors") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("single file mode (file param provided)", () => {
    it("returns type errors with correct shape for a file with errors", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, `${dir}/src/broken.ts`, dir);

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
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, `${dir}/src/broken.ts`, dir);

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
      const provider = new TsProvider();

      // chained-error.ts: function argument with wrong property type — produces a
      // DiagnosticMessageChain where d.messageText is an object (not a string):
      //   chain[0]: "Type '(x: number) => string' is not assignable to type '(x: string) => number'."
      //   chain[1]: "Types of parameters 'x' and 'x' are incompatible."
      //   chain[2]: "Type 'string' is not assignable to type 'number'."
      const result = await getTypeErrors(provider, `${dir}/src/chained-error.ts`, dir);

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
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, `${dir}/src/clean.ts`, dir);

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const provider = new TsProvider();

      await expect(
        getTypeErrors(provider, `${dir}/src/doesNotExist.ts`, dir),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws WORKSPACE_VIOLATION for a file outside the workspace", async () => {
      const dir = setup();
      const provider = new TsProvider();

      await expect(getTypeErrors(provider, "/etc/hosts", dir)).rejects.toMatchObject({
        code: "WORKSPACE_VIOLATION",
      });
    });

    it("errorCount equals diagnostics.length when not truncated", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, `${dir}/src/broken.ts`, dir);

      // When not truncated, errorCount is the true total and equals diagnostics.length
      expect(result.errorCount).toBe(result.diagnostics.length);
      expect(result.truncated).toBe(false);
    });

    it("caps at 100 and sets truncated=true when a single file has more than 100 errors", async () => {
      const dir = setup();
      const provider = new TsProvider();

      // many-errors.ts has 105 deliberate type errors
      const result = await getTypeErrors(provider, `${dir}/src/many-errors.ts`, dir);

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.errorCount).toBe(105);
    });

    it("is not truncated and errorCount equals 100 when a file has exactly 100 errors", async () => {
      const dir = setup("ts-100-errors");
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, `${dir}/src/exactly-100.ts`, dir);

      expect(result.truncated).toBe(false);
      expect(result.errorCount).toBe(100);
      expect(result.diagnostics).toHaveLength(100);
    });
  });

  describe("project-wide mode (no file param)", () => {
    it("returns errors from all files in the project", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, undefined, dir);

      // broken.ts (3 errors) + many-errors.ts (105 errors) = 108 total, so truncated
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    it("caps at 100 and sets truncated=true; errorCount reflects the full total", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, undefined, dir);

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      // errorCount is the total found, not the capped count
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.errorCount).toBeGreaterThan(result.diagnostics.length);
    });

    it("is not truncated and errorCount equals 100 when the project has exactly 100 errors", async () => {
      const dir = setup("ts-100-errors");
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, undefined, dir);

      expect(result.truncated).toBe(false);
      expect(result.errorCount).toBe(100);
      expect(result.diagnostics).toHaveLength(100);
    });

    it("returns empty result for a project with no errors", async () => {
      const dir = setup("simple-ts");
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, undefined, dir);

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("each diagnostic in project-wide results has the correct shape", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, undefined, dir);

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
