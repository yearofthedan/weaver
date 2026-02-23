import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveFile } from "../../../src/engines/actions/moveFile.js";
import { TsProvider } from "../../../src/engines/providers/ts.js";
import { VolarProvider } from "../../../src/engines/providers/volar.js";
import { findTsConfigForFile } from "../../../src/engines/ts/project.js";
import { updateVueImportsAfterMove } from "../../../src/engines/vue/scan.js";
import { cleanup, copyFixture, fileExists, readFile } from "../../helpers.js";

describe("moveFile action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("with TsProvider", () => {
    it("moves a file and updates imports", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      const oldPath = `${dir}/src/utils.ts`;
      const newPath = `${dir}/lib/utils.ts`;

      const result = await moveFile(provider, oldPath, newPath, dir);

      expect(result.oldPath).toBe(oldPath);
      expect(result.newPath).toBe(newPath);
      expect(fileExists(dir, "lib/utils.ts")).toBe(true);
      expect(fileExists(dir, "src/utils.ts")).toBe(false);

      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("../lib/utils");
    });

    it("creates destination directory if missing", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      const oldPath = `${dir}/src/utils.ts`;
      const newPath = `${dir}/deep/nested/lib/utils.ts`;

      const result = await moveFile(provider, oldPath, newPath, dir);

      expect(fileExists(dir, "deep/nested/lib/utils.ts")).toBe(true);
      expect(result.filesModified).toContain(newPath);
    });

    it("updates imports on move-back with the same provider instance", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, dir);
      expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

      await moveFile(provider, `${dir}/lib/utils.ts`, `${dir}/src/utils.ts`, dir);

      expect(fileExists(dir, "src/utils.ts")).toBe(true);
      expect(fileExists(dir, "lib/utils.ts")).toBe(false);
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("./utils");
      expect(mainContent).not.toContain("../lib/utils");
    });

    it("updates imports in out-of-project files (e.g. tests/)", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, dir);

      const testContent = readFile(dir, "tests/utils.test.ts");
      expect(testContent).toContain("../lib/utils");
      expect(testContent).not.toContain("../src/utils");
    });

    it("throws FILE_NOT_FOUND for non-existent source", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      try {
        await moveFile(provider, `${dir}/src/doesNotExist.ts`, `${dir}/lib/utils.ts`, dir);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("with VolarProvider", () => {
    it("moves a composable file and updates .vue imports", async () => {
      const dir = copyFixture("vue-project");
      dirs.push(dir);
      const provider = new VolarProvider();

      const oldPath = `${dir}/src/composables/useCounter.ts`;
      const newPath = `${dir}/src/utils/useCounter.ts`;

      const result = await moveFile(provider, oldPath, newPath, dir);

      expect(result.oldPath).toBe(oldPath);
      expect(result.newPath).toBe(newPath);
      expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(false);
      expect(fileExists(dir, "src/utils/useCounter.ts")).toBe(true);

      // Post-step: scan .vue files for import rewrites (mirrors what dispatcher does)
      const tsConfig = findTsConfigForFile(oldPath);
      const searchRoot = tsConfig ? path.dirname(tsConfig) : path.dirname(oldPath);
      const vueModified = updateVueImportsAfterMove(oldPath, newPath, searchRoot);
      for (const f of vueModified) {
        if (!result.filesModified.includes(f)) result.filesModified.push(f);
      }

      const vueContent = readFile(dir, "src/App.vue");
      expect(vueContent).toContain("utils/useCounter");
      expect(vueContent).not.toContain("composables/useCounter");

      expect(result.filesModified).toContain(`${dir}/src/App.vue`);
    });

    it("updates imports on move-back with the same provider instance", async () => {
      const dir = copyFixture("vue-project");
      dirs.push(dir);
      const provider = new VolarProvider();

      await moveFile(
        provider,
        `${dir}/src/composables/useCounter.ts`,
        `${dir}/src/utils/useCounter.ts`,
        dir,
      );
      expect(readFile(dir, "src/main.ts")).toContain("utils/useCounter");

      await moveFile(
        provider,
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
      const dir = copyFixture("vue-project");
      dirs.push(dir);
      const provider = new VolarProvider();

      try {
        await moveFile(
          provider,
          `${dir}/src/doesNotExist.ts`,
          `${dir}/src/utils/doesNotExist.ts`,
          dir,
        );
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });
  });
});
