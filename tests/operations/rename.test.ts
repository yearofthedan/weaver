import * as fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { rename } from "../../src/operations/rename.js";
import { TsProvider } from "../../src/providers/ts.js";
import { VolarProvider } from "../../src/providers/volar.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

describe("rename action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "simple-ts") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("with TsProvider", () => {
    it("renames a function at its declaration site", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await rename(provider, `${dir}/src/utils.ts`, 1, 17, "greetPerson", dir);

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("greetPerson");
      expect(result.filesModified).toHaveLength(2);

      expect(readFile(dir, "src/utils.ts")).toContain("greetPerson");
      expect(readFile(dir, "src/main.ts")).toContain("greetPerson");
    });

    it("renames a function from a call site", async () => {
      const dir = setup();
      const provider = new TsProvider();

      const result = await rename(provider, `${dir}/src/main.ts`, 3, 13, "sayHello", dir);

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("sayHello");
      expect(result.filesModified).toHaveLength(2);

      expect(readFile(dir, "src/utils.ts")).toContain("sayHello");
      expect(readFile(dir, "src/main.ts")).toContain("sayHello");
    });

    it("renames across three files (multi-importer)", async () => {
      const dir = setup("multi-importer");
      const provider = new TsProvider();

      const result = await rename(provider, `${dir}/src/utils.ts`, 1, 17, "sum", dir);

      expect(result.symbolName).toBe("add");
      expect(result.newName).toBe("sum");
      expect(result.filesModified).toHaveLength(3);

      expect(readFile(dir, "src/utils.ts")).toContain("sum");
      expect(readFile(dir, "src/featureA.ts")).toContain("sum");
      expect(readFile(dir, "src/featureB.ts")).toContain("sum");
    });

    it("throws FILE_NOT_FOUND for non-existent file", async () => {
      const dir = setup();
      const provider = new TsProvider();

      try {
        await rename(provider, `${dir}/src/doesNotExist.ts`, 1, 1, "foo", dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });

    it("throws SYMBOL_NOT_FOUND for out-of-range line", async () => {
      const dir = setup();
      const provider = new TsProvider();

      try {
        await rename(provider, `${dir}/src/utils.ts`, 999, 1, "foo", dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
      }
    });
  });

  describe("with VolarProvider", () => {
    function vueSetup(fixture = "vue-project") {
      const dir = copyFixture(fixture);
      dirs.push(dir);
      return dir;
    }

    it("renames a composable in a .ts file and updates .vue files", async () => {
      const dir = vueSetup();
      const provider = new VolarProvider();

      const filePath = `${dir}/src/composables/useCounter.ts`;
      const result = await rename(provider, filePath, 1, 17, "useCount", dir);

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
      const provider = new VolarProvider();

      const result = await rename(provider, `${dir}/src/utils.ts`, 1, 17, "welcomeUser", dir);

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("welcomeUser");
      expect(result.filesModified.length).toBeGreaterThanOrEqual(2);

      expect(readFile(dir, "src/utils.ts")).toContain("welcomeUser");
      expect(readFile(dir, "src/App.vue")).toContain("welcomeUser");
      expect(readFile(dir, "src/App.vue")).not.toContain("greetUser");
    });

    it("does not rename symbols in dist/ .vue files", async () => {
      const dir = vueSetup();
      const provider = new VolarProvider();

      fs.mkdirSync(`${dir}/dist`, { recursive: true });
      fs.writeFileSync(
        `${dir}/dist/App.vue`,
        `<script setup>\nimport { useCounter } from '../src/composables/useCounter';\n</script>\n`,
      );

      const filePath = `${dir}/src/composables/useCounter.ts`;
      const result = await rename(provider, filePath, 1, 17, "useCount", dir);

      expect(result.filesModified).not.toContain(`${dir}/dist/App.vue`);
      const distContent = fs.readFileSync(`${dir}/dist/App.vue`, "utf8");
      expect(distContent).toContain("useCounter");
    });

    it("throws FILE_NOT_FOUND for non-existent file", async () => {
      const dir = vueSetup();
      const provider = new VolarProvider();

      try {
        await rename(provider, `${dir}/src/doesNotExist.ts`, 1, 1, "foo", dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });
  });
});
