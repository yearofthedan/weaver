import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../__testHelpers__/helpers.js";
import { VolarCompiler } from "../plugins/vue/compiler.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { findReferences } from "./findReferences.js";

describe("findReferences action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = FIXTURES.simpleTs.name) {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("with TsMorphEngine", () => {
    it("finds all references to a symbol from the declaration site", async () => {
      const dir = setup();
      const compiler = new TsMorphEngine();

      const result = await findReferences(compiler, `${dir}/src/utils.ts`, 1, 17);

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
      const compiler = new TsMorphEngine();

      const result = await findReferences(compiler, `${dir}/src/main.ts`, 3, 13);

      expect(result.symbolName).toBe("greetUser");
      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const compiler = new TsMorphEngine();

      await expect(
        findReferences(compiler, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws SYMBOL_NOT_FOUND for an out-of-range line", async () => {
      const dir = setup();
      const compiler = new TsMorphEngine();

      await expect(findReferences(compiler, `${dir}/src/utils.ts`, 999, 1)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });

  describe("with VolarCompiler", () => {
    it("finds references to a composable across .ts and .vue files", async () => {
      const dir = setup("vue-project");
      const compiler = new VolarCompiler();

      const result = await findReferences(compiler, `${dir}/src/composables/useCounter.ts`, 1, 17);

      expect(result.symbolName).toBe("useCounter");
      expect(result.references.length).toBeGreaterThanOrEqual(2);

      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("useCounter.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith(".vue"))).toBe(true);

      for (const ref of result.references) {
        expect(ref.line).toBeGreaterThan(0);
        expect(ref.col).toBeGreaterThan(0);
        expect(ref.length).toBeGreaterThan(0);
      }
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup("vue-project");
      const compiler = new VolarCompiler();

      await expect(
        findReferences(compiler, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
