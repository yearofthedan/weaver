import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { getTypeErrors } from "./getTypeErrors.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("getTypeErrors operation", () => {
  describe("single file mode (file param provided)", () => {
    let dir: string;
    beforeAll(() => {
      dir = copyFixture(FIXTURES.tsErrors.name);
    });
    afterAll(() => cleanup(dir));

    it("returns type errors with correct shape for a file with errors", async () => {
      const compiler = new TsMorphEngine();

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
      const compiler = new TsMorphEngine();

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
      const compiler = new TsMorphEngine();

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
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/clean.ts`, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const compiler = new TsMorphEngine();

      await expect(
        getTypeErrors(compiler, `${dir}/src/doesNotExist.ts`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws WORKSPACE_VIOLATION for a file outside the workspace", async () => {
      const compiler = new TsMorphEngine();

      await expect(getTypeErrors(compiler, "/etc/hosts", makeScope(dir))).rejects.toMatchObject({
        code: "WORKSPACE_VIOLATION",
      });
    });

    it("errorCount equals diagnostics.length when not truncated", async () => {
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      // When not truncated, errorCount is the true total and equals diagnostics.length
      expect(result.errorCount).toBe(result.diagnostics.length);
      expect(result.truncated).toBe(false);
    });

    it("caps at 100 and sets truncated=true when a single file has more than 100 errors", async () => {
      const compiler = new TsMorphEngine();

      // many-errors.ts has 105 deliberate type errors
      const result = await getTypeErrors(compiler, `${dir}/src/many-errors.ts`, makeScope(dir));

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.errorCount).toBe(105);
    });

    it("is not truncated and errorCount equals 100 when a file has exactly 100 errors", async () => {
      const ts100Dir = copyFixture(FIXTURES.ts100Errors.name);
      try {
        const compiler = new TsMorphEngine();

        const result = await getTypeErrors(
          compiler,
          `${ts100Dir}/src/exactly-100.ts`,
          makeScope(ts100Dir),
        );

        expect(result.truncated).toBe(false);
        expect(result.errorCount).toBe(100);
        expect(result.diagnostics).toHaveLength(100);
      } finally {
        cleanup(ts100Dir);
      }
    });
  });

  describe("project-wide mode (no file param)", () => {
    let dir: string;
    beforeAll(() => {
      dir = copyFixture(FIXTURES.tsErrors.name);
    });
    afterAll(() => cleanup(dir));

    it("returns errors from all files in the project", async () => {
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      // broken.ts (3 errors) + many-errors.ts (105 errors) = 108 total, so truncated
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    it("caps at 100 and sets truncated=true; errorCount reflects the full total", async () => {
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      // errorCount is the total found, not the capped count
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.errorCount).toBeGreaterThan(result.diagnostics.length);
    });

    it("is not truncated and errorCount equals 100 when the project has exactly 100 errors", async () => {
      const ts100Dir = copyFixture(FIXTURES.ts100Errors.name);
      try {
        const compiler = new TsMorphEngine();

        const result = await getTypeErrors(compiler, undefined, makeScope(ts100Dir));

        expect(result.truncated).toBe(false);
        expect(result.errorCount).toBe(100);
        expect(result.diagnostics).toHaveLength(100);
      } finally {
        cleanup(ts100Dir);
      }
    });

    it("returns empty result for a project with no errors", async () => {
      const simpleDir = copyFixture(FIXTURES.simpleTs.name);
      try {
        const compiler = new TsMorphEngine();

        const result = await getTypeErrors(compiler, undefined, makeScope(simpleDir));

        expect(result.diagnostics).toHaveLength(0);
        expect(result.errorCount).toBe(0);
        expect(result.truncated).toBe(false);
      } finally {
        cleanup(simpleDir);
      }
    });

    it("each diagnostic in project-wide results has the correct shape", async () => {
      const compiler = new TsMorphEngine();

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
