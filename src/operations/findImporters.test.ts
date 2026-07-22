import { describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { findImporters } from "./findImporters.js";

const nodeFs = new NodeFileSystem();

describe("findImporters", () => {
  test("returns all files that import the given file", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const compiler = new TsMorphEngine();

    const result = await findImporters(compiler, `${dir}/src/utils.ts`, nodeFs);

    expect(result.fileName).toBe("utils.ts");
    expect(result.references.length).toBeGreaterThanOrEqual(1);
    expect(result.references.some((r) => r.file.endsWith("main.ts"))).toBe(true);
    for (const ref of result.references) {
      expect(ref.line).toBeGreaterThan(0);
      expect(ref.col).toBeGreaterThan(0);
      expect(ref.length).toBeGreaterThan(0);
    }
  });

  test("returns empty references for a file with no importers", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const compiler = new TsMorphEngine();

    const result = await findImporters(compiler, `${dir}/src/main.ts`, nodeFs);

    expect(result.fileName).toBe("main.ts");
    expect(result.references).toEqual([]);
  });

  test("throws FILE_NOT_FOUND for a non-existent file", async ({ seedNamedFixture }) => {
    const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
    const compiler = new TsMorphEngine();

    await expect(
      findImporters(compiler, `${dir}/src/doesNotExist.ts`, nodeFs),
    ).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });
  });

  it("resolves existence from the injected fs, not real disk", async () => {
    // File seeded only in memory — the inline node:fs.existsSync it replaced
    // would throw FILE_NOT_FOUND here.
    const memFs = new InMemoryFileSystem();
    memFs.writeFile("/ws/src/a.ts", "");
    const compiler = makeMockCompiler({
      getFileReferences: async () => [
        { fileName: "/ws/src/b.ts", textSpan: { start: 0, length: 3 } },
      ],
      readFile: () => "import './a'",
    });

    const result = await findImporters(compiler, "/ws/src/a.ts", memFs);

    expect(result.fileName).toBe("a.ts");
    expect(result.references).toHaveLength(1);
  });

  describe("with VolarEngine", () => {
    test(".ts target imported by both .ts and .vue files returns references from both", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueTsBoundary.name);
      const compiler = new VolarEngine(new TsMorphEngine(), dir);

      const result = await findImporters(compiler, `${dir}/src/utils.ts`, nodeFs);

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
    test(".vue target imported by another file returns references with correct positions", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.moveDirVue.name);
      const compiler = new VolarEngine(new TsMorphEngine(), dir);

      const result = await findImporters(compiler, `${dir}/src/components/Button.vue`, nodeFs);

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
