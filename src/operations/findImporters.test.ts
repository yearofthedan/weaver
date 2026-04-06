import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { findImporters } from "./findImporters.js";

describe("findImporters", () => {
  test.override({ fixtureName: FIXTURES.simpleTs.name });

  test("returns all files that import the given file", async ({ dir }) => {
    const compiler = new TsMorphEngine();

    const result = await findImporters(compiler, `${dir}/src/utils.ts`);

    expect(result.fileName).toBe("utils.ts");
    expect(result.references.length).toBeGreaterThanOrEqual(1);
    expect(result.references.some((r) => r.file.endsWith("main.ts"))).toBe(true);
    for (const ref of result.references) {
      expect(ref.line).toBeGreaterThan(0);
      expect(ref.col).toBeGreaterThan(0);
      expect(ref.length).toBeGreaterThan(0);
    }
  });

  test("returns empty references for a file with no importers", async ({ dir }) => {
    const compiler = new TsMorphEngine();

    const result = await findImporters(compiler, `${dir}/src/main.ts`);

    expect(result.fileName).toBe("main.ts");
    expect(result.references).toEqual([]);
  });

  test("throws FILE_NOT_FOUND for a non-existent file", async ({ dir }) => {
    const compiler = new TsMorphEngine();

    await expect(findImporters(compiler, `${dir}/src/doesNotExist.ts`)).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });

  describe("with VolarEngine", () => {
    test.override({ fixtureName: FIXTURES.vueTsBoundary.name });

    test(".ts target imported by both .ts and .vue files returns references from both", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine(), dir);

      const result = await findImporters(compiler, `${dir}/src/utils.ts`);

      expect(result.fileName).toBe("utils.ts");
      expect(result.references.length).toBeGreaterThanOrEqual(1);
      expect(result.references.some((r) => r.file.endsWith("App.vue"))).toBe(true);
      for (const ref of result.references) {
        expect(ref.line).toBeGreaterThan(0);
        expect(ref.col).toBeGreaterThan(0);
        expect(ref.length).toBeGreaterThan(0);
      }
    });
  });

  describe("with VolarEngine — .vue target", () => {
    test.override({ fixtureName: FIXTURES.moveDirVue.name });

    test(".vue target imported by another file returns references with correct positions", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine(), dir);

      const result = await findImporters(compiler, `${dir}/src/components/Button.vue`);

      expect(result.fileName).toBe("Button.vue");
      expect(result.references.length).toBeGreaterThanOrEqual(1);
      expect(result.references.some((r) => r.file.endsWith("App.vue"))).toBe(true);
      for (const ref of result.references) {
        expect(ref.line).toBeGreaterThan(0);
        expect(ref.col).toBeGreaterThan(0);
        expect(ref.length).toBeGreaterThan(0);
      }
    });
  });
});
