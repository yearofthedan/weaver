import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { findReferences } from "./findReferences.js";

describe("findReferences action", () => {
  describe("with TsMorphEngine", () => {
    test.override({ fixtureName: FIXTURES.simpleTs.name });

    test("finds all references to a symbol from the declaration site", async ({ dir }) => {
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

    test("finds the same references from a call site", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      const result = await findReferences(compiler, `${dir}/src/main.ts`, 3, 13);

      expect(result.symbolName).toBe("greetUser");
      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
    });

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      await expect(
        findReferences(compiler, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("throws SYMBOL_NOT_FOUND for an out-of-range line", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      await expect(findReferences(compiler, `${dir}/src/utils.ts`, 999, 1)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });

  describe("with VolarEngine", () => {
    test.override({ fixtureName: FIXTURES.vueProject.name });

    test("finds references to a composable across .ts and .vue files", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

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

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await expect(
        findReferences(compiler, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
