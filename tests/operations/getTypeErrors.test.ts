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

    it("pins the exact error codes and positions for broken.ts", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getTypeErrors(provider, `${dir}/src/broken.ts`, dir);

      const codes = result.diagnostics.map((d) => d.code).sort((a, b) => a - b);
      // TS2322 × 2 (wrong return type) and TS2345 × 1 (wrong argument type)
      expect(codes).toEqual([2322, 2322, 2345]);

      // All errors reference lines 6–10 (the bad calls, not the function declaration)
      for (const diag of result.diagnostics) {
        expect(diag.line).toBeGreaterThanOrEqual(6);
        expect(diag.line).toBeLessThanOrEqual(10);
      }
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
