import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/compilers/ts.js";
import { findReferences } from "../../src/operations/findReferences.js";
import { VolarProvider } from "../../src/plugins/vue/compiler.js";
import { cleanup, copyFixture } from "../helpers.js";

describe("findReferences action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("with TsProvider", () => {
    it("finds all references to a symbol from the declaration site", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await findReferences(provider, `${dir}/src/utils.ts`, 1, 17);

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
      const provider = new TsProvider();

      const result = await findReferences(provider, `${dir}/src/main.ts`, 3, 13);

      expect(result.symbolName).toBe("greetUser");
      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const provider = new TsProvider();

      await expect(
        findReferences(provider, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws SYMBOL_NOT_FOUND for an out-of-range line", async () => {
      const dir = setup();
      const provider = new TsProvider();

      await expect(findReferences(provider, `${dir}/src/utils.ts`, 999, 1)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });

  describe("with VolarProvider", () => {
    it("finds references to a composable across .ts and .vue files", async () => {
      const dir = setup("vue-project");
      const provider = new VolarProvider();

      const result = await findReferences(provider, `${dir}/src/composables/useCounter.ts`, 1, 17);

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
      const provider = new VolarProvider();

      await expect(
        findReferences(provider, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
