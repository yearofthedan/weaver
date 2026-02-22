import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsEngine } from "../../src/engines/ts/engine";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers";

// simple-ts fixture layout (1-based coords):
// src/utils.ts  line 1: export function greetUser(...  → col 17
// src/main.ts   line 1: import { greetUser } from ...  → col 10
//               line 3: console.log(greetUser(...      → col 13

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
      const result = await engine.rename(filePath, 1, 17, "greetPerson", dir);

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
      const result = await engine.rename(filePath, 3, 13, "sayHello", dir);

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
      const result = await engine.rename(filePath, 1, 17, "sum", dir);

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
        await engine.rename(filePath, 1, 1, "foo", dir);
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
        await engine.rename(filePath, 999, 1, "foo", dir);
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

      const result = await engine.moveFile(oldPath, newPath, dir);

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

      const result = await engine.moveFile(oldPath, newPath, dir);

      expect(fileExists(dir, "deep/nested/lib/utils.ts")).toBe(true);
      expect(result.filesModified).toContain(newPath);
    });

    it("updates imports on move-back with the same engine instance", async () => {
      const dir = setup();
      const engine = new TsEngine();

      // Move 1: src/utils.ts → lib/utils.ts
      await engine.moveFile(`${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, dir);
      expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

      // Move 2 (back): lib/utils.ts → src/utils.ts
      await engine.moveFile(`${dir}/lib/utils.ts`, `${dir}/src/utils.ts`, dir);

      expect(fileExists(dir, "src/utils.ts")).toBe(true);
      expect(fileExists(dir, "lib/utils.ts")).toBe(false);
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("./utils");
      expect(mainContent).not.toContain("../lib/utils");
    });

    it("updates imports in out-of-project files (e.g. tests/)", async () => {
      // tests/utils.test.ts imports from ../src/utils but is excluded from
      // the fixture tsconfig `include: ["src/**/*.ts"]`. The post-scan must
      // still rewrite its import without widening the ts-morph Project scope.
      const dir = setup();
      const engine = new TsEngine();

      await engine.moveFile(`${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, dir);

      const testContent = readFile(dir, "tests/utils.test.ts");
      expect(testContent).toContain("../lib/utils");
      expect(testContent).not.toContain("../src/utils");
    });

    it("throws FILE_NOT_FOUND for non-existent source", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const oldPath = `${dir}/src/doesNotExist.ts`;
      const newPath = `${dir}/lib/utils.ts`;

      try {
        await engine.moveFile(oldPath, newPath, dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string; message: string };
        expect(error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("findReferences", () => {
    it("finds all references to a symbol from the declaration site", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const result = await engine.findReferences(`${dir}/src/utils.ts`, 1, 17);

      expect(result.symbolName).toBe("greetUser");
      expect(result.references.length).toBeGreaterThanOrEqual(2);

      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);

      for (const ref of result.references) {
        expect(ref.line).toBeGreaterThan(0);
        expect(ref.col).toBeGreaterThan(0);
        expect(ref.length).toBeGreaterThan(0);
      }
    });

    it("finds the same references from a call site", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const result = await engine.findReferences(`${dir}/src/main.ts`, 3, 13);

      expect(result.symbolName).toBe("greetUser");
      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const engine = new TsEngine();

      try {
        await engine.findReferences(`${dir}/src/doesNotExist.ts`, 1, 1);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });

    it("throws SYMBOL_NOT_FOUND for an out-of-range line", async () => {
      const dir = setup();
      const engine = new TsEngine();

      try {
        await engine.findReferences(`${dir}/src/utils.ts`, 999, 1);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
      }
    });
  });

  describe("getDefinition", () => {
    it("returns the definition location from a call site", async () => {
      const dir = setup();
      const engine = new TsEngine();

      // main.ts line 3: console.log(greetUser("World")); → col 13
      const result = await engine.getDefinition(`${dir}/src/main.ts`, 3, 13);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.length).toBeGreaterThanOrEqual(1);

      // Definition must point back to utils.ts
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);
      for (const def of result.definitions) {
        expect(def.line).toBeGreaterThan(0);
        expect(def.col).toBeGreaterThan(0);
        expect(def.length).toBeGreaterThan(0);
      }
    });

    it("returns the definition location from the declaration site itself", async () => {
      const dir = setup();
      const engine = new TsEngine();

      // utils.ts line 1, col 17: greetUser declaration
      const result = await engine.getDefinition(`${dir}/src/utils.ts`, 1, 17);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const engine = new TsEngine();

      try {
        await engine.getDefinition(`${dir}/src/doesNotExist.ts`, 1, 1);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });

    it("throws SYMBOL_NOT_FOUND for an out-of-range line", async () => {
      const dir = setup();
      const engine = new TsEngine();

      try {
        await engine.getDefinition(`${dir}/src/utils.ts`, 999, 1);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
      }
    });
  });

  describe("moveSymbol", () => {
    it("moves a function to a new file", async () => {
      const dir = setup();
      const engine = new TsEngine();

      const srcPath = `${dir}/src/utils.ts`;
      const dstPath = `${dir}/src/helpers.ts`;

      const result = await engine.moveSymbol(srcPath, "greetUser", dstPath, dir);

      expect(result.symbolName).toBe("greetUser");
      expect(result.sourceFile).toBe(srcPath);
      expect(result.destFile).toBe(dstPath);

      // Symbol moved to dest
      expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
      // Symbol removed from source
      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    });

    it("moves a function to an existing file", async () => {
      const dir = setup();
      // Create dest file with an existing export
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      const engine = new TsEngine();

      await engine.moveSymbol(`${dir}/src/utils.ts`, "greetUser", `${dir}/src/helpers.ts`, dir);

      const destContent = readFile(dir, "src/helpers.ts");
      expect(destContent).toContain("helper");
      expect(destContent).toContain("greetUser");
    });

    it("updates the import in the importing file", async () => {
      const dir = setup();
      const engine = new TsEngine();

      await engine.moveSymbol(`${dir}/src/utils.ts`, "greetUser", `${dir}/src/helpers.ts`, dir);

      const mainContent = readFile(dir, "src/main.ts");
      // Import should now point to helpers, not utils
      expect(mainContent).toContain("./helpers");
      expect(mainContent).not.toContain("./utils");
    });

    it("merges with an existing dest import when the importer already imports from dest", async () => {
      const dir = setup("multi-importer");
      // Create a dest file
      const dstPath = `${dir}/src/shared.ts`;
      fs.writeFileSync(dstPath, "export const PI = 3.14;\n");
      // Make featureA also import from shared.ts
      const featureAPath = path.join(dir, "src/featureA.ts");
      const originalA = fs.readFileSync(featureAPath, "utf8");
      fs.writeFileSync(featureAPath, `import { PI } from "./shared";\n${originalA}`);

      const engine = new TsEngine();
      // Move `add` from utils.ts to shared.ts
      await engine.moveSymbol(`${dir}/src/utils.ts`, "add", dstPath, dir);

      const featureAContent = readFile(dir, "src/featureA.ts");
      // Should have a single import from shared that includes both PI and add
      const importMatches = featureAContent.match(
        /import\s*\{[^}]+\}\s*from\s*["']\.\/shared["']/g,
      );
      expect(importMatches).toHaveLength(1);
      expect(importMatches?.[0]).toContain("PI");
      expect(importMatches?.[0]).toContain("add");
    });

    it("symbol is absent from source file after move", async () => {
      const dir = setup();
      const engine = new TsEngine();

      await engine.moveSymbol(`${dir}/src/utils.ts`, "greetUser", `${dir}/src/helpers.ts`, dir);

      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    });

    it("throws SYMBOL_NOT_FOUND for an unknown symbol", async () => {
      const dir = setup();
      const engine = new TsEngine();

      try {
        await engine.moveSymbol(
          `${dir}/src/utils.ts`,
          "doesNotExist",
          `${dir}/src/helpers.ts`,
          dir,
        );
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string };
        expect(error.code).toBe("SYMBOL_NOT_FOUND");
      }
    });

    it("throws FILE_NOT_FOUND for a missing source file", async () => {
      const dir = setup();
      const engine = new TsEngine();

      try {
        await engine.moveSymbol(
          `${dir}/src/doesNotExist.ts`,
          "greetUser",
          `${dir}/src/helpers.ts`,
          dir,
        );
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string };
        expect(error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });
});
