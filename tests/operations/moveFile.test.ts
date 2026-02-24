import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveFile } from "../../src/operations/moveFile.js";
import { TsProvider } from "../../src/providers/ts.js";
import { VolarProvider } from "../../src/providers/volar.js";
import { updateVueImportsAfterMove } from "../../src/providers/vue-scan.js";
import { findTsConfigForFile } from "../../src/utils/ts-project.js";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers.js";

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

    it("does not corrupt comments when updating imports in out-of-project files", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      // Create an out-of-project file with both an import and a comment referencing the same path
      const extraTestFile = path.join(dir, "tests", "import-with-comment.ts");
      fs.writeFileSync(
        extraTestFile,
        [
          "// TODO: migrate logic from ../src/utils to ../lib/utils",
          'import { greetUser } from "../src/utils";',
          "",
          "console.log(greetUser('test'));",
        ].join("\n"),
      );

      await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, dir);

      const content = readFile(dir, "tests/import-with-comment.ts");
      // Import specifier must be updated
      expect(content).toContain('"../lib/utils"');
      // Comment must NOT be rewritten
      expect(content).toContain("// TODO: migrate logic from ../src/utils to ../lib/utils");
    });

    it("throws FILE_NOT_FOUND for non-existent source", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      await expect(
        moveFile(provider, `${dir}/src/doesNotExist.ts`, `${dir}/lib/utils.ts`, dir),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
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
      const vueModified = updateVueImportsAfterMove(oldPath, newPath, searchRoot, dir);
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

      await expect(
        moveFile(provider, `${dir}/src/doesNotExist.ts`, `${dir}/src/utils/doesNotExist.ts`, dir),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });
  });
});
