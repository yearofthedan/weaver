import * as fs from "node:fs";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { getDefinition } from "./getDefinition.js";

const nodeFs = new NodeFileSystem();

describe("getDefinition action", () => {
  describe("with TsMorphEngine", () => {
    test("returns the definition location from a call site", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      // main.ts line 3: console.log(greetUser("World")); → col 13
      const result = await getDefinition(compiler, `${dir}/src/main.ts`, 3, 13, nodeFs);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.length).toBeGreaterThanOrEqual(1);
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);

      for (const def of result.definitions) {
        expect(def.line).toBeGreaterThan(0);
        expect(def.col).toBeGreaterThan(0);
        expect(def.length).toBeGreaterThan(0);
      }
    });

    test("returns the definition location from the declaration site itself", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      const result = await getDefinition(compiler, `${dir}/src/utils.ts`, 1, 17, nodeFs);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);
    });

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      await expect(
        getDefinition(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, nodeFs),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("throws SYMBOL_NOT_FOUND for an out-of-range line", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      await expect(
        getDefinition(compiler, `${dir}/src/utils.ts`, 999, 1, nodeFs),
      ).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });

    test("throws SYMBOL_NOT_FOUND when position is valid but has no definition", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      // Exercises the `!defs || defs.length === 0` path in getDefinition.ts:
      // line 2 of main.ts is blank — resolveOffset succeeds but getDefinitionAtPosition returns null.
      const compiler = new TsMorphEngine();

      await expect(
        getDefinition(compiler, `${dir}/src/main.ts`, 2, 1, nodeFs),
      ).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });

  describe("with VolarEngine", () => {
    test("resolves a composable definition from a .vue call site", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.vueTsBoundary.name);
      const compiler = new VolarEngine(new TsMorphEngine());

      const appVue = `${dir}/src/App.vue`;
      const content = fs.readFileSync(appVue, "utf8");
      const lineIdx = content.split("\n").findIndex((l) => l.includes("greetUser"));
      expect(lineIdx).toBeGreaterThanOrEqual(0);
      const line = lineIdx + 1;
      const col = content.split("\n")[lineIdx].indexOf("greetUser") + 1;

      const result = await getDefinition(compiler, appVue, line, col, nodeFs);

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

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.vueTsBoundary.name);
      const compiler = new VolarEngine(new TsMorphEngine());

      await expect(
        getDefinition(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, nodeFs),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("resolves existence from the injected fs, not real disk", async () => {
      // File seeded only in memory — the inline node:fs.existsSync it replaced
      // would throw FILE_NOT_FOUND here.
      const memFs = new InMemoryFileSystem();
      memFs.writeFile("/ws/src/a.ts", "greetUser");
      const compiler = makeMockCompiler({
        getDefinitionAtPosition: async () => [
          { name: "greetUser", fileName: "/ws/src/a.ts", textSpan: { start: 0, length: 9 } },
        ],
        readFile: () => "greetUser()",
      });

      const result = await getDefinition(compiler, "/ws/src/a.ts", 1, 1, memFs);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions).toHaveLength(1);
    });

    test("throws SYMBOL_NOT_FOUND for an out-of-range line in a .vue file", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueTsBoundary.name);
      // Exercises the resolveOffset catch block in VolarEngine (volar.ts line 103).
      const compiler = new VolarEngine(new TsMorphEngine());

      await expect(
        getDefinition(compiler, `${dir}/src/App.vue`, 999, 1, nodeFs),
      ).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });
});
