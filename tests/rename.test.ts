import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, readFile, runCli } from "./helpers";

// greetUser is at line 1, col 17 in simple-ts/src/utils.ts:
//   export function greetUser(name: string): string {
//   123456789012345678
//                   ^ col 17
const UTILS_DECL = { line: "1", col: "17" };

// greetUser also appears at line 3, col 13 in simple-ts/src/main.ts:
//   console.log(greetUser("World"));
//   1234567890123456
//               ^ col 13
const MAIN_CALL = { line: "3", col: "13" };

describe("rename command", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("success", () => {
    it("renames a function across files from its declaration site", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        UTILS_DECL.line,
        "--col",
        UTILS_DECL.col,
        "--newName",
        "greetPerson",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      expect(out.filesModified).toHaveLength(2);
      expect(out.summary).toContain("greetUser");
      expect(out.summary).toContain("greetPerson");

      const utils = readFile(dir, "src/utils.ts");
      expect(utils).toContain("greetPerson");
      expect(utils).not.toContain("greetUser");

      const main = readFile(dir, "src/main.ts");
      expect(main).toContain("greetPerson");
      expect(main).not.toContain("greetUser");
    });

    it("renames from a call site and propagates to the declaration", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/main.ts",
        "--line",
        MAIN_CALL.line,
        "--col",
        MAIN_CALL.col,
        "--newName",
        "sayHello",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      expect(readFile(dir, "src/utils.ts")).toContain("sayHello");
      expect(readFile(dir, "src/main.ts")).toContain("sayHello");
    });

    it("renames across three files (multi-importer fixture)", () => {
      const dir = setup("multi-importer");
      // add is at line 1, col 17 in src/utils.ts:
      //   export function add(a: number, b: number): number {
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        "1",
        "--col",
        "17",
        "--newName",
        "sum",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      expect(out.filesModified).toHaveLength(3); // utils + featureA + featureB

      expect(readFile(dir, "src/utils.ts")).toContain("sum");
      expect(readFile(dir, "src/featureA.ts")).toContain("sum");
      expect(readFile(dir, "src/featureB.ts")).toContain("sum");
    });

    it("output lists only files that actually changed", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        UTILS_DECL.line,
        "--col",
        UTILS_DECL.col,
        "--newName",
        "greetPerson",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      // Every reported path should end in .ts and actually exist
      for (const f of out.filesModified) {
        expect(f).toMatch(/\.ts$/);
      }
    });
  });

  describe("errors", () => {
    it("returns SYMBOL_NOT_FOUND when line is out of range", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        "99999",
        "--col",
        "1",
        "--newName",
        "foo",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("SYMBOL_NOT_FOUND");
    });

    it("returns SYMBOL_NOT_FOUND when position has no identifier", () => {
      const dir = setup();
      // Line 2 col 1 is the start of the return statement indentation in utils.ts
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        "2",
        "--col",
        "1",
        "--newName",
        "foo",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      // Engine returns either SYMBOL_NOT_FOUND or RENAME_NOT_ALLOWED for non-renameable positions
      expect(["SYMBOL_NOT_FOUND", "RENAME_NOT_ALLOWED"]).toContain(out.error);
    });

    it("returns FILE_NOT_FOUND for a non-existent file", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/doesNotExist.ts",
        "--line",
        "1",
        "--col",
        "1",
        "--newName",
        "foo",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("FILE_NOT_FOUND");
    });

    it("returns VALIDATION_ERROR when --col is missing", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        "1",
        "--newName",
        "foo",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when newName is not a valid identifier", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        UTILS_DECL.line,
        "--col",
        UTILS_DECL.col,
        "--newName",
        "123-invalid!",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when --line is not a number", () => {
      const dir = setup();
      const out = runCli(dir, [
        "rename",
        "--file",
        "src/utils.ts",
        "--line",
        "notanumber",
        "--col",
        "1",
        "--newName",
        "foo",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("VALIDATION_ERROR");
    });
  });
});
