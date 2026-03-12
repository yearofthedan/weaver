import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { rename } from "../../src/operations/rename.js";
import { VolarCompiler } from "../../src/plugins/vue/compiler.js";
import { InMemoryFileSystem } from "../../src/ports/in-memory-filesystem.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import type { SpanLocation } from "../../src/types.js";
import { makeMockCompiler } from "../compilers/__helpers__/mock-compiler.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

// assertFileExists (called inside rename) still uses the real filesystem — it is not yet
// migrated to the FileSystem port. In unit tests that mock the compiler, we pass a path
// that is guaranteed to exist on disk so that guard passes without creating extra files.
const EXISTING_FILE = new URL(import.meta.url).pathname;

function makeScope(workspace: string): WorkspaceScope {
  return new WorkspaceScope(workspace, new NodeFileSystem());
}

describe("rename action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("with TsMorphCompiler", () => {
    it("renames a function at its declaration site", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

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

    it("renames a function from a call site", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

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

    it("renames across three files (multi-importer)", async () => {
      const dir = setup("multi-importer");
      const compiler = new TsMorphCompiler();

      const result = await rename(compiler, `${dir}/src/utils.ts`, 1, 17, "sum", makeScope(dir));

      expect(result.symbolName).toBe("add");
      expect(result.newName).toBe("sum");
      expect(result.filesModified).toHaveLength(3);

      expect(readFile(dir, "src/utils.ts")).toContain("sum");
      expect(readFile(dir, "src/featureA.ts")).toContain("sum");
      expect(readFile(dir, "src/featureB.ts")).toContain("sum");
    });

    it("throws FILE_NOT_FOUND for non-existent file", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      await expect(
        rename(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws SYMBOL_NOT_FOUND for out-of-range line", async () => {
      const dir = setup();
      const compiler = new TsMorphCompiler();

      await expect(
        rename(compiler, `${dir}/src/utils.ts`, 999, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
    });
  });

  describe("with VolarCompiler", () => {
    function vueSetup(fixture = "vue-project") {
      const dir = copyFixture(fixture);
      dirs.push(dir);
      return dir;
    }

    it("renames a composable in a .ts file and updates .vue files", async () => {
      const dir = vueSetup();
      const compiler = new VolarCompiler();

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

    it("renames across TypeScript/Vue boundary", async () => {
      const dir = vueSetup("vue-ts-boundary");
      const compiler = new VolarCompiler();

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

    it("does not rename symbols in dist/ .vue files", async () => {
      const dir = vueSetup();
      const compiler = new VolarCompiler();

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

    it("throws FILE_NOT_FOUND for non-existent file", async () => {
      const dir = vueSetup();
      const compiler = new VolarCompiler();

      await expect(
        rename(compiler, `${dir}/src/doesNotExist.ts`, 1, 1, "foo", makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });

  describe("workspace boundary and scope tracking", () => {
    it("throws SYMBOL_NOT_FOUND when compiler returns null locations", async () => {
      const workspace = new URL("../..", import.meta.url).pathname;
      const compiler = makeMockCompiler({
        resolveOffset: vi.fn().mockReturnValue(17),
        getRenameLocations: vi.fn().mockResolvedValue(null),
        readFile: vi.fn().mockReturnValue("export function greetUser() {}"),
      });

      const scope = new WorkspaceScope(workspace, new InMemoryFileSystem());

      await expect(rename(compiler, EXISTING_FILE, 1, 17, "newName", scope)).rejects.toMatchObject({
        code: "SYMBOL_NOT_FOUND",
      });

      expect(scope.modified).toHaveLength(0);
      expect(scope.skipped).toHaveLength(0);
    });

    it("writes in-workspace files and skips out-of-workspace files", async () => {
      const workspace = new URL("../..", import.meta.url).pathname;
      const outFile = "/outside/consumer.ts";
      const originalContent = "export function greetUser() {}";

      // "greetUser" starts at index 16 and is 9 chars long
      const locs: SpanLocation[] = [
        { fileName: EXISTING_FILE, textSpan: { start: 16, length: 9 } },
        { fileName: outFile, textSpan: { start: 16, length: 9 } },
      ];

      const compiler = makeMockCompiler({
        resolveOffset: vi.fn().mockReturnValue(17),
        getRenameLocations: vi.fn().mockResolvedValue(locs),
        readFile: vi.fn().mockReturnValue(originalContent),
      });

      const memFs = new InMemoryFileSystem();
      const scope = new WorkspaceScope(workspace, memFs);
      const result = await rename(compiler, EXISTING_FILE, 1, 17, "greetPerson", scope);

      expect(result.filesModified).toContain(EXISTING_FILE);
      expect(result.filesModified).not.toContain(outFile);
      expect(memFs.readFile(EXISTING_FILE)).toContain("greetPerson");

      expect(result.filesSkipped).toContain(outFile);
      expect(() => memFs.readFile(outFile)).toThrow();

      expect(compiler.notifyFileWritten).toHaveBeenCalledWith(EXISTING_FILE, expect.any(String));
      expect(compiler.notifyFileWritten).not.toHaveBeenCalledWith(outFile, expect.any(String));
    });
  });
});
