import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { deleteFile } from "../../src/operations/deleteFile.js";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers.js";

describe("deleteFile", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("in-project TS/JS files", () => {
    it("removes named import declarations that reference the deleted file", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(`${dir}/src/importer.ts`);
      expect(readFile(dir, "src/importer.ts")).not.toMatch(/from ['"]\.\/target['"]/);
    });

    it("removes type-only import declarations that reference the deleted file", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      // importer.ts has both a named import and a type-only import from target
      const content = readFile(dir, "src/importer.ts");
      expect(content).not.toMatch(/import type.*from ['"]\.\/target['"]/);
    });

    it("removes export * and named re-export declarations from barrel files", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(`${dir}/src/barrel.ts`);
      const content = readFile(dir, "src/barrel.ts");
      expect(content).not.toMatch(/from ['"]\.\/target['"]/);
    });

    it("counts every removed declaration in importRefsRemoved", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      // importer.ts: 2 decls (named import + type import)
      // barrel.ts:   2 decls (export * + named re-export)
      // tests/out-of-project.ts: 1 decl (out-of-project, but still within workspace)
      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.importRefsRemoved).toBe(5);
    });

    it("does not include the deleted file itself in filesModified", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).not.toContain(`${dir}/src/target.ts`);
    });

    it("returns importRefsRemoved = 0 and empty filesModified when nothing imports the file", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const isolated = path.join(dir, "src", "isolated.ts");
      fs.writeFileSync(isolated, "export const x = 1;\n", "utf8");

      const result = await deleteFile(new TsMorphCompiler(), isolated, dir);

      expect(result.importRefsRemoved).toBe(0);
      expect(result.filesModified).toHaveLength(0);
    });
  });

  describe("physical deletion", () => {
    it("removes the target file from disk after cleaning importers", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      expect(fileExists(dir, "src/target.ts")).toBe(true);
      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(fileExists(dir, "src/target.ts")).toBe(false);
      expect(result.deletedFile).toBe(`${dir}/src/target.ts`);
    });

    it("deletes the file even when it has no importers", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const isolated = path.join(dir, "src", "isolated.ts");
      fs.writeFileSync(isolated, "export const x = 1;\n", "utf8");

      await deleteFile(new TsMorphCompiler(), isolated, dir);

      expect(fs.existsSync(isolated)).toBe(false);
    });
  });

  describe("out-of-project TS/JS files", () => {
    it("removes imports from files not included in tsconfig", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      // tests/out-of-project.ts is outside tsconfig include (src/**/*.ts)
      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(`${dir}/tests/out-of-project.ts`);
      expect(readFile(dir, "tests/out-of-project.ts")).not.toMatch(/from ['"][^'"]*target['"]/);
    });

    it("handles imports that use an explicit file extension", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const extra = path.join(dir, "tests", "explicit-ext.ts");
      fs.writeFileSync(
        extra,
        'import { targetFn } from "../src/target.ts";\nconst _ = targetFn();\n',
        "utf8",
      );

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(extra);
      expect(fs.readFileSync(extra, "utf8")).not.toMatch(/from ['"][^'"]*target/);
    });
  });

  describe("Vue SFC script blocks", () => {
    it("removes named and type-only import lines from script blocks", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const vueFile = path.join(dir, "src", "Comp.vue");
      fs.writeFileSync(
        vueFile,
        [
          '<script setup lang="ts">',
          "import { targetFn } from './target';",
          "import type { TargetType } from './target';",
          "import * as All from './target';",
          "const x = targetFn();",
          "</script>",
          "<template><div>hello</div></template>",
        ].join("\n"),
        "utf8",
      );

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(vueFile);
      const content = fs.readFileSync(vueFile, "utf8");
      expect(content).not.toMatch(/from ['"]\.\/target['"]/);
      // Non-import content is preserved
      expect(content).toContain("const x = targetFn();");
      expect(content).toContain("<template>");
    });

    it("removes bare side-effect import lines from script blocks", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const vueFile = path.join(dir, "src", "SideEffect.vue");
      fs.writeFileSync(
        vueFile,
        ["<script setup>", "import './target';", "const x = 1;", "</script>"].join("\n"),
        "utf8",
      );

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(vueFile);
      const content = fs.readFileSync(vueFile, "utf8");
      expect(content).not.toContain("import './target'");
      expect(content).toContain("const x = 1;");
    });

    it("removes re-export lines from script blocks", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const vueFile = path.join(dir, "src", "ReExport.vue");
      fs.writeFileSync(
        vueFile,
        [
          "<script>",
          "export * from './target';",
          "export { targetFn } from './target';",
          "</script>",
        ].join("\n"),
        "utf8",
      );

      const result = await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(result.filesModified).toContain(vueFile);
      expect(fs.readFileSync(vueFile, "utf8")).not.toMatch(/from ['"]\.\/target['"]/);
    });

    it("does not modify Vue files that do not import the deleted file", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const originalContent = [
        "<script setup>",
        "import { other } from './other-module';",
        "const x = 1;",
        "</script>",
      ].join("\n");
      const vueFile = path.join(dir, "src", "Unrelated.vue");
      fs.writeFileSync(vueFile, originalContent, "utf8");

      await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(fs.readFileSync(vueFile, "utf8")).toBe(originalContent);
    });

    it("does not remove side-effect imports from paths other than the deleted file", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const originalContent = [
        "<script setup>",
        "import './other-module';",
        "const x = 1;",
        "</script>",
      ].join("\n");
      const vueFile = path.join(dir, "src", "OtherSideEffect.vue");
      fs.writeFileSync(vueFile, originalContent, "utf8");

      await deleteFile(new TsMorphCompiler(), `${dir}/src/target.ts`, dir);

      expect(fs.readFileSync(vueFile, "utf8")).toBe(originalContent);
    });
  });

  describe("workspace boundary", () => {
    it("skips out-of-workspace importers and reports them in filesSkipped without writing", async () => {
      // cross-boundary fixture: tsconfig includes ../consumer/**/* so ts-morph's
      // in-project scan finds consumer/main.ts, which is outside the workspace.
      const root = copyFixture("cross-boundary");
      dirs.push(root);

      const workspace = path.join(root, "workspace");
      const targetFile = path.join(workspace, "src", "utils.ts");
      const consumerFile = path.join(root, "consumer", "main.ts");
      const consumerBefore = fs.readFileSync(consumerFile, "utf8");

      const result = await deleteFile(new TsMorphCompiler(), targetFile, workspace);

      // consumer/main.ts is outside workspace — must not be written
      expect(fs.readFileSync(consumerFile, "utf8")).toBe(consumerBefore);
      // It must appear in filesSkipped
      expect(result.filesSkipped).toContain(consumerFile);
      // The target file is gone
      expect(fs.existsSync(targetFile)).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws a structured FILE_NOT_FOUND error when the target does not exist", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      await expect(
        deleteFile(new TsMorphCompiler(), `${dir}/src/does-not-exist.ts`, dir),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("does not touch any other files when the target is missing", async () => {
      const dir = copyFixture("delete-file-ts");
      dirs.push(dir);

      const importerBefore = readFile(dir, "src/importer.ts");

      await expect(
        deleteFile(new TsMorphCompiler(), `${dir}/src/missing.ts`, dir),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });

      expect(readFile(dir, "src/importer.ts")).toBe(importerBefore);
    });
  });
});
