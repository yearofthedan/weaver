import { describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { findReferences } from "./findReferences.js";

const nodeFs = new NodeFileSystem();

describe("findReferences action", () => {
  describe("with TsMorphEngine", () => {
    test("finds all references to a symbol from the declaration site", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      const result = await findReferences(compiler, `${dir}/src/utils.ts`, 1, 17, nodeFs);

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

    test("finds the same references from a call site", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      const result = await findReferences(compiler, `${dir}/src/main.ts`, 3, 13, nodeFs);

      expect(result.symbolName).toBe("greetUser");
      const files = result.references.map((r) => r.file);
      expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
    });

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      await expect(
        findReferences(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, nodeFs),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("throws SYMBOL_NOT_FOUND for an out-of-range line", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      await expect(
        findReferences(compiler, `${dir}/src/utils.ts`, 999, 1, nodeFs),
      ).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });

  describe("with VolarEngine", () => {
    test("finds references to a composable across .ts and .vue files", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const compiler = new VolarEngine(new TsMorphEngine());

      const result = await findReferences(
        compiler,
        `${dir}/src/composables/useCounter.ts`,
        1,
        17,
        nodeFs,
      );

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

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const compiler = new VolarEngine(new TsMorphEngine());

      await expect(
        findReferences(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, nodeFs),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });

  describe("existence check goes through the injected FileSystem", () => {
    it("resolves existence from the injected fs, not real disk", async () => {
      // Seed the file only in memory — it does not exist on disk, so the
      // laziest wrong impl (inline node:fs.existsSync) would throw FILE_NOT_FOUND.
      const fs = new InMemoryFileSystem();
      fs.writeFile("/ws/src/a.ts", "greetUser");
      const compiler = makeMockCompiler({
        getReferencesAtPosition: async () => [
          { fileName: "/ws/src/a.ts", textSpan: { start: 0, length: 9 } },
        ],
        readFile: () => "greetUser()",
      });

      const result = await findReferences(compiler, "/ws/src/a.ts", 1, 1, fs);

      expect(result.symbolName).toBe("greetUser");
      expect(result.references).toHaveLength(1);
    });
  });
});
