import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  copyFixture,
  FIXTURES,
  fileExists,
  readFile,
} from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { tsDeleteFile } from "./delete-file.js";
import { TsMorphEngine } from "./engine.js";

function makeScope(workspace: string): WorkspaceScope {
  return new WorkspaceScope(workspace, new NodeFileSystem());
}

describe("tsDeleteFile", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("in-project TS/JS importer removal", () => {
    it("removes named import declarations that reference the deleted file", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      expect(scope.modified).toContain(`${dir}/src/importer.ts`);
      expect(readFile(dir, "src/importer.ts")).not.toMatch(/from ['"]\.\/target['"]/);
    });

    it("removes type-only import declarations that reference the deleted file", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      const content = readFile(dir, "src/importer.ts");
      expect(content).not.toMatch(/import type.*from ['"]\.\/target['"]/);
    });

    it("removes export * and named re-export declarations from barrel files", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      expect(scope.modified).toContain(`${dir}/src/barrel.ts`);
      const content = readFile(dir, "src/barrel.ts");
      expect(content).not.toMatch(/from ['"]\.\/target['"]/);
    });

    it("returns importRefsRemoved = 0 when nothing imports the file", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const isolated = path.join(dir, "src", "isolated.ts");
      fs.writeFileSync(isolated, "export const x = 1;\n", "utf8");

      const scope = makeScope(dir);
      const result = await tsDeleteFile(new TsMorphEngine(), isolated, scope);

      expect(result.importRefsRemoved).toBe(0);
      expect(scope.modified).toHaveLength(0);
    });
  });

  describe("out-of-project TS/JS importer removal", () => {
    it("removes imports from files not included in tsconfig", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      expect(scope.modified).toContain(`${dir}/tests/out-of-project.ts`);
      expect(readFile(dir, "tests/out-of-project.ts")).not.toMatch(/from ['"][^'"]*target['"]/);
    });

    it("handles imports that use an explicit file extension", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const extra = path.join(dir, "tests", "explicit-ext.ts");
      fs.writeFileSync(
        extra,
        'import { targetFn } from "../src/target.ts";\nconst _ = targetFn();\n',
        "utf8",
      );

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      expect(scope.modified).toContain(extra);
      expect(fs.readFileSync(extra, "utf8")).not.toMatch(/from ['"][^'"]*target/);
    });
  });

  describe("physical file deletion", () => {
    it("removes the target file from disk after cleaning importers", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      expect(fileExists(dir, "src/target.ts")).toBe(true);
      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      expect(fileExists(dir, "src/target.ts")).toBe(false);
    });

    it("deletes the file even when it has no importers", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const isolated = path.join(dir, "src", "isolated.ts");
      fs.writeFileSync(isolated, "export const x = 1;\n", "utf8");

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), isolated, scope);

      expect(fs.existsSync(isolated)).toBe(false);
    });
  });

  describe("import ref counts", () => {
    it("counts every removed TS declaration in importRefsRemoved", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      // importer.ts: 2 decls (named import + type import)
      // barrel.ts:   2 decls (export * + named re-export)
      // tests/out-of-project.ts: 1 decl
      const scope = makeScope(dir);
      const result = await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      expect(result.importRefsRemoved).toBe(5);
    });
  });

  describe("workspace boundary", () => {
    it("skips out-of-workspace importers without writing them", async () => {
      const root = copyFixture(FIXTURES.crossBoundary.name);
      dirs.push(root);

      const workspace = path.join(root, "workspace");
      const targetFile = path.join(workspace, "src", "utils.ts");
      const consumerFile = path.join(root, "consumer", "main.ts");
      const consumerBefore = fs.readFileSync(consumerFile, "utf8");

      const scope = makeScope(workspace);
      await tsDeleteFile(new TsMorphEngine(), targetFile, scope);

      expect(fs.readFileSync(consumerFile, "utf8")).toBe(consumerBefore);
      expect(scope.skipped).toContain(consumerFile);
      expect(fs.existsSync(targetFile)).toBe(false);
    });

    it("only records files within the workspace in scope.modified", async () => {
      const dir = copyFixture(FIXTURES.deleteFileTs.name);
      dirs.push(dir);

      const scope = makeScope(dir);
      await tsDeleteFile(new TsMorphEngine(), `${dir}/src/target.ts`, scope);

      for (const f of scope.modified) {
        expect(f.startsWith(dir)).toBe(true);
      }
    });
  });
});
