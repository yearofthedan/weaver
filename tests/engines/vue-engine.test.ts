import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findTsConfigForFile } from "../../src/engines/ts/project";
import { VueEngine } from "../../src/engines/vue/engine";
import { updateVueImportsAfterMove } from "../../src/engines/vue/scan";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers";

describe("VueEngine (unit tests)", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  function setup(fixture = "vue-project") {
    const dir = copyFixture(fixture);
    dirs.push(dir);
    return dir;
  }

  describe("rename", () => {
    it("renames a composable in a .ts file and updates .vue files", async () => {
      const dir = setup();
      const engine = new VueEngine();

      const filePath = `${dir}/src/composables/useCounter.ts`;
      const result = await engine.rename(filePath, 1, 17, "useCount", dir);

      expect(result.symbolName).toBe("useCounter");
      expect(result.newName).toBe("useCount");
      expect(result.filesModified.length).toBeGreaterThanOrEqual(2); // At least .ts and .vue

      // Verify both files were updated
      const tsContent = readFile(dir, "src/composables/useCounter.ts");
      expect(tsContent).toContain("useCount");
      expect(tsContent).not.toContain("export function useCounter");

      const vueContent = readFile(dir, "src/App.vue");
      expect(vueContent).toContain("useCount");
    });

    it("renames across TypeScript/Vue boundary", async () => {
      const dir = setup("vue-ts-boundary");
      const engine = new VueEngine();

      const filePath = `${dir}/src/utils.ts`;
      const result = await engine.rename(filePath, 1, 17, "welcomeUser", dir);

      expect(result.symbolName).toBe("greetUser");
      expect(result.newName).toBe("welcomeUser");
      expect(result.filesModified.length).toBeGreaterThanOrEqual(2);

      // Verify .ts file updated
      expect(readFile(dir, "src/utils.ts")).toContain("welcomeUser");

      // Verify .vue file updated
      expect(readFile(dir, "src/App.vue")).toContain("welcomeUser");
      expect(readFile(dir, "src/App.vue")).not.toContain("greetUser");
    });

    it("does not rename symbols in dist/ .vue files", async () => {
      const dir = setup();
      const engine = new VueEngine();

      // Simulate a built dist/ with a .vue file referencing the composable
      fs.mkdirSync(`${dir}/dist`, { recursive: true });
      fs.writeFileSync(
        `${dir}/dist/App.vue`,
        `<script setup>\nimport { useCounter } from '../src/composables/useCounter';\n</script>\n`,
      );

      const filePath = `${dir}/src/composables/useCounter.ts`;
      const result = await engine.rename(filePath, 1, 17, "useCount", dir);

      // dist/App.vue must not be touched
      expect(result.filesModified).not.toContain(`${dir}/dist/App.vue`);
      const distContent = fs.readFileSync(`${dir}/dist/App.vue`, "utf8");
      expect(distContent).toContain("useCounter");
    });

    it("throws FILE_NOT_FOUND for non-existent file", async () => {
      const dir = setup();
      const engine = new VueEngine();

      const filePath = `${dir}/src/doesNotExist.ts`;

      try {
        await engine.rename(filePath, 1, 1, "foo", dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string; message: string };
        expect(error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("findReferences", () => {
    it("finds references to a composable across .ts and .vue files", async () => {
      const dir = setup();
      const engine = new VueEngine();

      // useCounter.ts line 1: export function useCounter(  → col 17
      const result = await engine.findReferences(`${dir}/src/composables/useCounter.ts`, 1, 17);

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
      const dir = setup();
      const engine = new VueEngine();

      try {
        await engine.findReferences(`${dir}/src/doesNotExist.ts`, 1, 1);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("getDefinition", () => {
    it("resolves a composable definition from a .vue call site", async () => {
      const dir = setup("vue-ts-boundary");
      const engine = new VueEngine();

      // App.vue imports and calls greetUser from utils.ts.
      // Point at App.vue's usage of greetUser — definition should resolve to utils.ts.
      const appVue = `${dir}/src/App.vue`;
      const content = fs.readFileSync(appVue, "utf8");
      const lineIdx = content.split("\n").findIndex((l) => l.includes("greetUser"));
      expect(lineIdx).toBeGreaterThanOrEqual(0);
      const line = lineIdx + 1;
      const col = content.split("\n")[lineIdx].indexOf("greetUser") + 1;

      const result = await engine.getDefinition(appVue, line, col);

      expect(result.symbolName).toBe("greetUser");
      expect(result.definitions.length).toBeGreaterThanOrEqual(1);
      expect(result.definitions.some((d) => d.file.endsWith("utils.ts"))).toBe(true);
    });

    it("throws FILE_NOT_FOUND for a non-existent file", async () => {
      const dir = setup();
      const engine = new VueEngine();

      try {
        await engine.getDefinition(`${dir}/src/doesNotExist.ts`, 1, 1);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("moveFile", () => {
    it("moves a composable file and updates .vue imports", async () => {
      const dir = setup();
      const engine = new VueEngine();

      const oldPath = `${dir}/src/composables/useCounter.ts`;
      const newPath = `${dir}/src/utils/useCounter.ts`;

      const result = await engine.moveFile(oldPath, newPath, dir);

      expect(result.oldPath).toBe(oldPath);
      expect(result.newPath).toBe(newPath);

      // File is physically moved
      expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(false);
      expect(fileExists(dir, "src/utils/useCounter.ts")).toBe(true);

      // Dispatcher post-step: scan .vue files for import rewrites.
      // VueEngine.moveFile() handles .ts imports via Volar; .vue SFC imports
      // are updated by updateVueImportsAfterMove(), run by the dispatcher after moveFile.
      const tsConfig = findTsConfigForFile(oldPath);
      const searchRoot = tsConfig ? path.dirname(tsConfig) : path.dirname(oldPath);
      const vueModified = updateVueImportsAfterMove(oldPath, newPath, searchRoot);
      for (const f of vueModified) {
        if (!result.filesModified.includes(f)) result.filesModified.push(f);
      }

      // App.vue import is rewritten by the scan post-step
      const vueContent = readFile(dir, "src/App.vue");
      expect(vueContent).toContain("utils/useCounter");
      expect(vueContent).not.toContain("composables/useCounter");

      // App.vue should be in filesModified (added by scan post-step)
      expect(result.filesModified).toContain(`${dir}/src/App.vue`);
    });

    it("updates imports on move-back with the same engine instance", async () => {
      const dir = setup(); // vue-project — App.vue and main.ts both import the composable
      const engine = new VueEngine();

      // Move 1: src/composables/useCounter.ts → src/utils/useCounter.ts
      await engine.moveFile(
        `${dir}/src/composables/useCounter.ts`,
        `${dir}/src/utils/useCounter.ts`,
        dir,
      );
      expect(readFile(dir, "src/main.ts")).toContain("utils/useCounter");

      // Move 2 (back): src/utils/useCounter.ts → src/composables/useCounter.ts
      await engine.moveFile(
        `${dir}/src/utils/useCounter.ts`,
        `${dir}/src/composables/useCounter.ts`,
        dir,
      );

      expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(true);
      expect(fileExists(dir, "src/utils/useCounter.ts")).toBe(false);
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("composables/useCounter");
      expect(mainContent).not.toContain("utils/useCounter");
    });

    it("throws FILE_NOT_FOUND for non-existent source", async () => {
      const dir = setup();
      const engine = new VueEngine();

      const oldPath = `${dir}/src/doesNotExist.ts`;
      const newPath = `${dir}/src/utils/doesNotExist.ts`;

      try {
        await engine.moveFile(oldPath, newPath, dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        const error = err as { code?: string; message: string };
        expect(error.code).toBe("FILE_NOT_FOUND");
      }
    });
  });
});
