import { afterEach, describe, expect, it } from "vitest";
import { TsEngine } from "../../src/engines/ts-engine";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers";

describe("TsEngine (unit tests)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("rename", () => {
    it("renames a function at its declaration site", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const filePath = `${dir}/src/utils.ts`;
      const result = await engine.rename(filePath, 1, 17, "greetPerson");

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("greetPerson");
      expect(result.filesModified).toHaveLength(2); // utils.ts + main.ts
      expect(result.filesModified.map((f) => f.endsWith(".ts"))).toEqual([true, true]);

      expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
      expect(readFile(dir, "src/main.ts")).toContain("greetPerson");
    });

    it("renames a function from a call site", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const filePath = `${dir}/src/main.ts`;
      const result = await engine.rename(filePath, 3, 13, "sayHello");

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("sayHello");
      expect(result.filesModified).toHaveLength(2);

      expect(readFile(dir, "src/utils.ts")).toContain("sayHello");
      expect(readFile(dir, "src/main.ts")).toContain("sayHello");
    });

    it("renames across three files (multi-importer)", async () => {
      const dir = setup("multi-importer");
      const engine = new TsEngine();

      const filePath = `${dir}/src/utils.ts`;
      const result = await engine.rename(filePath, 1, 17, "sum");

      expect(result.symbolName).toBe("add");
      expect(result.newName).toBe("sum");
      expect(result.filesModified).toHaveLength(3); // utils + featureA + featureB

      expect(readFile(dir, "src/utils.ts")).toContain("sum");
      expect(readFile(dir, "src/featureA.ts")).toContain("sum");
      expect(readFile(dir, "src/featureB.ts")).toContain("sum");
    });

    it("throws FILE_NOT_FOUND for non-existent file", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const filePath = `${dir}/src/doesNotExist.ts`;

      try {
        await engine.rename(filePath, 1, 1, "foo");
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string; message: string };
        expect(error.code).toBe("FILE_NOT_FOUND");
      }
    });

    it("throws SYMBOL_NOT_FOUND for out-of-range line", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const filePath = `${dir}/src/utils.ts`;

      try {
        await engine.rename(filePath, 999, 1, "foo");
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string; message: string };
        expect(error.code).toBe("SYMBOL_NOT_FOUND");
      }
    });
  });

  describe("moveFile", () => {
    it("moves a file and updates imports", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const oldPath = `${dir}/src/utils.ts`;
      const newPath = `${dir}/lib/utils.ts`;

      const result = await engine.moveFile(oldPath, newPath);

      expect(result.oldPath).toBe(oldPath);
      expect(result.newPath).toBe(newPath);
      expect(fileExists(dir, "lib/utils.ts")).toBe(true);
      expect(fileExists(dir, "src/utils.ts")).toBe(false);

      // Verify import in main.ts was updated
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("../lib/utils");
    });

    it("creates destination directory if missing", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const oldPath = `${dir}/src/utils.ts`;
      const newPath = `${dir}/deep/nested/lib/utils.ts`;

      const result = await engine.moveFile(oldPath, newPath);

      expect(fileExists(dir, "deep/nested/lib/utils.ts")).toBe(true);
      expect(result.filesModified).toContain(newPath);
    });

    it("updates imports on move-back with the same engine instance", async () => {
      const dir = setup();
      const engine = new TsEngine();

      // Move 1: src/utils.ts → lib/utils.ts
      await engine.moveFile(`${dir}/src/utils.ts`, `${dir}/lib/utils.ts`);
      expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

      // Move 2 (back): lib/utils.ts → src/utils.ts
      await engine.moveFile(`${dir}/lib/utils.ts`, `${dir}/src/utils.ts`);

      expect(fileExists(dir, "src/utils.ts")).toBe(true);
      expect(fileExists(dir, "lib/utils.ts")).toBe(false);
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("./utils");
      expect(mainContent).not.toContain("../lib/utils");
    });

    it("throws FILE_NOT_FOUND for non-existent source", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const oldPath = `${dir}/src/doesNotExist.ts`;
      const newPath = `${dir}/lib/utils.ts`;

      try {
        await engine.moveFile(oldPath, newPath);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string; message: string };
        expect(error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });
});
