import * as fs from "node:fs";
import { describe, expect, vi } from "vitest";
import { FIXTURES, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { InMemoryFileSystem } from "../ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { rename } from "./rename.js";

// assertFileExists (called inside rename) still uses the real filesystem — it is not yet
// migrated to the FileSystem port. In unit tests that mock the compiler, we pass a path
// that is guaranteed to exist on disk so that guard passes without creating extra files.
const EXISTING_FILE = new URL(import.meta.url).pathname;

function makeScope(workspace: string): WorkspaceScope {
  return new WorkspaceScope(workspace, new NodeFileSystem());
}

describe("rename action", () => {
  describe("with TsMorphEngine", () => {
    test.override({ fixtureName: FIXTURES.simpleTs.name });

    test("renames a function at its declaration site", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      const result = await rename(
        compiler,
        `${dir}/src/utils.ts`,
        1,
        17,
        "greetPerson",
        makeScope(dir),
      );

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("greetPerson");
      expect(result.filesModified).toHaveLength(2);

      expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
      expect(readFile(dir, "src/main.ts")).toContain("greetPerson");
    });

    test("renames a function from a call site", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      const result = await rename(
        compiler,
        `${dir}/src/main.ts`,
        3,
        13,
        "sayHello",
        makeScope(dir),
      );

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("sayHello");
      expect(result.filesModified).toHaveLength(2);

      expect(readFile(dir, "src/utils.ts")).toContain("sayHello");
      expect(readFile(dir, "src/main.ts")).toContain("sayHello");
    });

    test("throws FILE_NOT_FOUND for non-existent file", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      await expect(
        rename(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("throws SYMBOL_NOT_FOUND for out-of-range line", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      await expect(
        rename(compiler, `${dir}/src/utils.ts`, 999, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
    });
  });

  describe("with TsMorphEngine — multi-importer", () => {
    test.override({ fixtureName: FIXTURES.multiImporter.name });

    test("renames across three files (multi-importer)", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      const result = await rename(compiler, `${dir}/src/utils.ts`, 1, 17, "sum", makeScope(dir));

      expect(result.symbolName).toBe("add");
      expect(result.newName).toBe("sum");
      expect(result.filesModified).toHaveLength(3);

      expect(readFile(dir, "src/utils.ts")).toContain("sum");
      expect(readFile(dir, "src/featureA.ts")).toContain("sum");
      expect(readFile(dir, "src/featureB.ts")).toContain("sum");
    });
  });

  describe("with VolarEngine", () => {
    test.override({ fixtureName: FIXTURES.vueProject.name });

    test("renames a composable in a .ts file and updates .vue files", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      const filePath = `${dir}/src/composables/useCounter.ts`;
      const result = await rename(compiler, filePath, 1, 17, "useCount", makeScope(dir));

      expect(result.symbolName).toBe("useCounter");
      expect(result.newName).toBe("useCount");
      expect(result.filesModified.length).toBeGreaterThanOrEqual(2);

      const tsContent = readFile(dir, "src/composables/useCounter.ts");
      expect(tsContent).toContain("useCount");
      expect(tsContent).not.toContain("export function useCounter");

      const vueContent = readFile(dir, "src/App.vue");
      expect(vueContent).toContain("useCount");
    });

    test("does not rename symbols in dist/ .vue files", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      // dist/ is conventionally gitignored so it can't live in the committed fixture
      fs.mkdirSync(`${dir}/dist`, { recursive: true });
      fs.writeFileSync(
        `${dir}/dist/App.vue`,
        `<script setup>\nimport { useCounter } from '../src/composables/useCounter';\n</script>\n`,
      );

      const filePath = `${dir}/src/composables/useCounter.ts`;
      const result = await rename(compiler, filePath, 1, 17, "useCount", makeScope(dir));

      expect(result.filesModified).not.toContain(`${dir}/dist/App.vue`);
      const distContent = fs.readFileSync(`${dir}/dist/App.vue`, "utf8");
      expect(distContent).toContain("useCounter");
    });

    test("throws FILE_NOT_FOUND for non-existent file", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await expect(
        rename(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });

  describe("with VolarEngine — vue-ts-boundary", () => {
    test.override({ fixtureName: FIXTURES.vueTsBoundary.name });

    test("renames across TypeScript/Vue boundary", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      const result = await rename(
        compiler,
        `${dir}/src/utils.ts`,
        1,
        17,
        "welcomeUser",
        makeScope(dir),
      );

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("welcomeUser");
      expect(result.filesModified.length).toBeGreaterThanOrEqual(2);

      expect(readFile(dir, "src/utils.ts")).toContain("welcomeUser");
      expect(readFile(dir, "src/App.vue")).toContain("welcomeUser");
      expect(readFile(dir, "src/App.vue")).not.toContain("greetUser");
    });
  });

  describe("via mock engine", () => {
    test.override({ fixtureName: FIXTURES.simpleTs.name });

    test("delegates to engine.rename() and returns the result", async ({ dir: _dir }) => {
      const workspace = new URL("../..", import.meta.url).pathname;
      const expected = {
        filesModified: [EXISTING_FILE],
        filesSkipped: [],
        symbolName: "greetUser",
        newName: "greetPerson",
        locationCount: 2,
      };
      const compiler = makeMockCompiler({
        rename: vi.fn().mockResolvedValue(expected),
      });

      const scope = new WorkspaceScope(workspace, new InMemoryFileSystem());
      const result = await rename(compiler, EXISTING_FILE, 1, 17, "greetPerson", scope);

      expect(result).toEqual(expected);
      expect(compiler.rename).toHaveBeenCalledWith(EXISTING_FILE, 1, 17, "greetPerson", scope);
    });

    test("propagates errors thrown by engine.rename()", async ({ dir: _dir }) => {
      const workspace = new URL("../..", import.meta.url).pathname;
      const compiler = makeMockCompiler({
        rename: vi.fn().mockRejectedValue({ code: "SYMBOL_NOT_FOUND" }),
      });

      const scope = new WorkspaceScope(workspace, new InMemoryFileSystem());

      await expect(rename(compiler, EXISTING_FILE, 1, 17, "newName", scope)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });
    });
  });
});
