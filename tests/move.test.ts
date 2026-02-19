import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, fileExists, readFile, runCli } from "./helpers";

describe("move command", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("success", () => {
    it("moves a file and updates its single importer", () => {
      const dir = setup();
      const out = runCli(dir, [
        "move",
        "--oldPath",
        "src/utils.ts",
        "--newPath",
        "src/lib/utils.ts",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      // Old path gone, new path exists
      expect(fileExists(dir, "src/utils.ts")).toBe(false);
      expect(fileExists(dir, "src/lib/utils.ts")).toBe(true);

      // The importer's path is updated
      const main = readFile(dir, "src/main.ts");
      expect(main).toContain("./lib/utils");
      expect(main).not.toContain('"./utils"');
    });

    it("creates the destination directory when it does not exist", () => {
      const dir = setup();
      // deep/nested/path does not exist in the fixture
      const out = runCli(dir, [
        "move",
        "--oldPath",
        "src/utils.ts",
        "--newPath",
        "src/deep/nested/path/utils.ts",
      ]);

      expect(out.ok).toBe(true);
      expect(fileExists(dir, "src/deep/nested/path/utils.ts")).toBe(true);
    });

    it("moves a file with multiple importers and updates all of them", () => {
      const dir = setup("multi-importer");
      const out = runCli(dir, [
        "move",
        "--oldPath",
        "src/utils.ts",
        "--newPath",
        "src/lib/utils.ts",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      expect(fileExists(dir, "src/utils.ts")).toBe(false);
      expect(fileExists(dir, "src/lib/utils.ts")).toBe(true);

      // Both importers updated
      expect(readFile(dir, "src/featureA.ts")).toContain("lib/utils");
      expect(readFile(dir, "src/featureB.ts")).toContain("lib/utils");
    });

    it("includes the moved file in filesModified", () => {
      const dir = setup();
      const out = runCli(dir, [
        "move",
        "--oldPath",
        "src/utils.ts",
        "--newPath",
        "src/lib/utils.ts",
      ]);

      expect(out.ok).toBe(true);
      if (!out.ok) return;

      const movedFile = out.filesModified.find((f) => f.endsWith("lib/utils.ts"));
      expect(movedFile).toBeDefined();
    });
  });

  describe("errors", () => {
    it("returns FILE_NOT_FOUND when the source file does not exist", () => {
      const dir = setup();
      const out = runCli(dir, [
        "move",
        "--oldPath",
        "src/doesNotExist.ts",
        "--newPath",
        "src/lib/doesNotExist.ts",
      ]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("FILE_NOT_FOUND");
    });

    it("returns VALIDATION_ERROR when --newPath is missing", () => {
      const dir = setup();
      const out = runCli(dir, ["move", "--oldPath", "src/utils.ts"]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when both paths are missing", () => {
      const dir = setup();
      const out = runCli(dir, ["move"]);

      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toBe("VALIDATION_ERROR");
    });
  });
});
