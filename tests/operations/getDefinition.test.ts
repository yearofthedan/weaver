import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/compilers/ts.js";
import { getDefinition } from "../../src/operations/getDefinition.js";
import { VolarProvider } from "../../src/plugins/vue/compiler.js";
import { cleanup, copyFixture } from "../helpers.js";

describe("getDefinition action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("with TsProvider", () => {
    it("returns the definition location from a call site", async () => {
      const dir = setup();
      const provider = new TsProvider();

      // main.ts line 3: console.log(greetUser("World")); → col 13
      const result = await getDefinition(provider, `${dir}/src/main.ts`, 3, 13);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.length).toBeGreaterThanOrEqual(1);
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);

      for (const def of result.definitions) {
        expect(def.line).toBeGreaterThan(0);
        expect(def.col).toBeGreaterThan(0);
        expect(def.length).toBeGreaterThan(0);
      }
    });

    it("returns the definition location from the declaration site itself", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await getDefinition(provider, `${dir}/src/utils.ts`, 1, 17);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const provider = new TsProvider();

      await expect(
        getDefinition(provider, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws SYMBOL_NOT_FOUND for an out-of-range line", async () => {
      const dir = setup();
      const provider = new TsProvider();

      await expect(getDefinition(provider, `${dir}/src/utils.ts`, 999, 1)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });

    it("throws SYMBOL_NOT_FOUND when position is valid but has no definition", async () => {
      // Exercises the `!defs || defs.length === 0` path in getDefinition.ts:
      // line 2 of main.ts is blank — resolveOffset succeeds but getDefinitionAtPosition returns null.
      const dir = setup();
      const provider = new TsProvider();

      await expect(getDefinition(provider, `${dir}/src/main.ts`, 2, 1)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });

  describe("with VolarProvider", () => {
    it("resolves a composable definition from a .vue call site", async () => {
      const dir = setup("vue-ts-boundary");
      const provider = new VolarProvider();

      const appVue = `${dir}/src/App.vue`;
      const content = fs.readFileSync(appVue, "utf8");
      const lineIdx = content.split("\n").findIndex((l) => l.includes("greetUser"));
      expect(lineIdx).toBeGreaterThanOrEqual(0);
      const line = lineIdx + 1;
      const col = content.split("\n")[lineIdx].indexOf("greetUser") + 1;

      const result = await getDefinition(provider, appVue, line, col);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.length).toBeGreaterThanOrEqual(1);
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);
      // Assert specific span values so offset-translation mutants are caught.
      const def = result.definitions.find((d) => d.file.endsWith("utils.ts"));
      expect(def).toBeDefined();
      expect(def?.line).toBe(1);
      expect(def?.col).toBeGreaterThan(0);
      expect(def?.length).toBeGreaterThan(0);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup("vue-project");
      const provider = new VolarProvider();

      await expect(
        getDefinition(provider, `${dir}/src/doesNotExist.ts`, 1, 1),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws SYMBOL_NOT_FOUND for an out-of-range line in a .vue file", async () => {
      // Exercises the resolveOffset catch block in VolarProvider (volar.ts line 103).
      const dir = setup("vue-ts-boundary");
      const provider = new VolarProvider();

      await expect(getDefinition(provider, `${dir}/src/App.vue`, 999, 1)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });
});
