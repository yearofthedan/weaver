import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, fileExists, readFile } from "../../src/__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveDirectory } from "../../src/operations/moveDirectory.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { makeMockCompiler } from "../compilers/__helpers__/mock-compiler.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveDirectory", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("basic directory move", () => {
    it("moves directory files and rewrites external imports", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib/helpers`,
        makeScope(dir),
      );

      const movedA = `${dir}/src/lib/helpers/a.ts`;
      const movedB = `${dir}/src/lib/helpers/b.ts`;

      expect(result.filesMoved).toContain(movedA);
      expect(result.filesMoved).toContain(movedB);

      expect(fileExists(dir, "src/lib/helpers/a.ts")).toBe(true);
      expect(fileExists(dir, "src/lib/helpers/b.ts")).toBe(true);
      expect(fileExists(dir, "src/utils/a.ts")).toBe(false);
      expect(fileExists(dir, "src/utils/b.ts")).toBe(false);

      const appContent = readFile(dir, "src/app.ts");
      expect(appContent).toContain("./lib/helpers/a");
      expect(appContent).toContain("./lib/helpers/b");
      expect(appContent).not.toContain("./utils/a");
      expect(appContent).not.toContain("./utils/b");

      // Key assertion: filesModified must include external files (app.ts), not just moved files
      expect(result.filesModified).toContain(`${dir}/src/app.ts`);

      // oldPath and newPath echoed
      expect(result.oldPath).toBe(`${dir}/src/utils`);
      expect(result.newPath).toBe(`${dir}/src/lib/helpers`);
    });

    it("includes moved files in filesModified", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib/helpers`,
        makeScope(dir),
      );

      expect(result.filesModified).toContain(`${dir}/src/lib/helpers/a.ts`);
      expect(result.filesModified).toContain(`${dir}/src/lib/helpers/b.ts`);
    });
  });

  describe("non-source files", () => {
    it("moves non-source files (json, css) via plain filesystem copy", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      fs.writeFileSync(path.join(dir, "src/utils/config.json"), '{"key": "value"}');
      fs.writeFileSync(path.join(dir, "src/utils/styles.css"), ".foo { color: red; }");

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib`,
        makeScope(dir),
      );

      expect(fileExists(dir, "src/lib/config.json")).toBe(true);
      expect(fileExists(dir, "src/lib/styles.css")).toBe(true);
      expect(fileExists(dir, "src/utils/config.json")).toBe(false);
      expect(fileExists(dir, "src/utils/styles.css")).toBe(false);

      expect(result.filesMoved).toContain(`${dir}/src/lib/config.json`);
      expect(result.filesMoved).toContain(`${dir}/src/lib/styles.css`);
      expect(result.filesModified).toContain(`${dir}/src/lib/config.json`);
      expect(result.filesModified).toContain(`${dir}/src/lib/styles.css`);
    });

    it("creates destination directory when moving non-source files into a new directory", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const assetsDir = path.join(dir, "assets");
      fs.mkdirSync(assetsDir);
      fs.writeFileSync(path.join(assetsDir, "logo.svg"), "<svg/>");
      fs.writeFileSync(path.join(assetsDir, "style.css"), "body { margin: 0; }");

      const result = await moveDirectory(
        compiler,
        assetsDir,
        `${dir}/public/static`,
        makeScope(dir),
      );

      expect(fileExists(dir, "public/static/logo.svg")).toBe(true);
      expect(fileExists(dir, "public/static/style.css")).toBe(true);
      expect(result.filesMoved).toContain(`${dir}/public/static/logo.svg`);
      expect(result.filesMoved).toContain(`${dir}/public/static/style.css`);
    });
  });

  describe("nested subdirectories", () => {
    it("preserves nested subdirectory structure when moving", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib`,
        makeScope(dir),
      );

      expect(fileExists(dir, "src/lib/nested/c.ts")).toBe(true);
      expect(fileExists(dir, "src/utils/nested/c.ts")).toBe(false);
      expect(result.filesMoved).toContain(`${dir}/src/lib/nested/c.ts`);
    });

    it("skips SKIP_DIRS (node_modules) inside the moved directory", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const fakeNodeModules = path.join(dir, "src/utils/node_modules");
      fs.mkdirSync(fakeNodeModules);
      fs.writeFileSync(path.join(fakeNodeModules, "dep.ts"), "export const x = 1;");

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib`,
        makeScope(dir),
      );

      const movedBasenames = result.filesMoved.map((f) => path.basename(f));
      expect(movedBasenames).not.toContain("dep.ts");
      expect(fileExists(dir, "src/utils/node_modules/dep.ts")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("throws MOVE_INTO_SELF when oldPath and newPath are the same directory", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await expect(
        moveDirectory(compiler, `${dir}/src/utils`, `${dir}/src/utils`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "MOVE_INTO_SELF" });
    });

    it("skips symlinks in directory enumeration", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const symlinkPath = path.join(dir, "src/utils/link-to-app");
      fs.symlinkSync(path.join(dir, "src/app.ts"), symlinkPath);

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib/helpers`,
        makeScope(dir),
      );

      const movedPaths = result.filesMoved.map((f) => path.basename(f));
      expect(movedPaths).not.toContain("link-to-app");
      expect(movedPaths).toContain("a.ts");
      expect(movedPaths).toContain("b.ts");
    });
  });

  describe("import rewriting across moved files", () => {
    it("rewrites external imports and preserves intra-directory imports without introducing parent paths", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(compiler, `${dir}/src/utils`, `${dir}/src/lib`, makeScope(dir));

      const movedBContent = readFile(dir, "src/lib/b.ts");
      expect(movedBContent).toContain("./a");
      expect(movedBContent).not.toContain("../");
      expect(movedBContent).not.toContain("src/lib/a");

      const appContent = readFile(dir, "src/app.ts");
      expect(appContent).toContain("./lib/a");
      expect(appContent).toContain("./lib/b");
      expect(appContent).not.toContain("./utils/a");
      expect(appContent).not.toContain("./utils/b");
    });
  });

  describe("empty directory", () => {
    it("returns empty arrays and no error for a directory with no files", async () => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "move-dir-empty-"));
      dirs.push(tmpRoot);
      const emptyDir = path.join(tmpRoot, "source");
      fs.mkdirSync(emptyDir);
      const destDir = path.join(tmpRoot, "dest");
      const compiler = new TsMorphCompiler();
      const scope = makeScope(tmpRoot);

      const result = await moveDirectory(compiler, emptyDir, destDir, scope);

      expect(result.filesMoved).toEqual([]);
      expect(result.filesModified).toEqual([]);
      expect(result.filesSkipped).toEqual([]);
      expect(result.oldPath).toBe(emptyDir);
      expect(result.newPath).toBe(destDir);
    });
  });

  describe("error cases", () => {
    it.each([
      [
        "source does not exist",
        (dir: string) => `${dir}/src/nonexistent`,
        (dir: string) => `${dir}/src/dest`,
        "FILE_NOT_FOUND",
      ],
      [
        "source is a file",
        (dir: string) => `${dir}/src/app.ts`,
        (dir: string) => `${dir}/src/dest`,
        "NOT_A_DIRECTORY",
      ],
      [
        "destination is a non-empty directory",
        (dir: string) => `${dir}/src/utils`,
        (dir: string) => `${dir}/src`,
        "DESTINATION_EXISTS",
      ],
      [
        "newPath is inside oldPath",
        (dir: string) => `${dir}/src/utils`,
        (dir: string) => `${dir}/src/utils/subdir`,
        "MOVE_INTO_SELF",
      ],
    ])("throws when %s", async (_, oldPathFn, newPathFn, code) => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await expect(
        moveDirectory(compiler, oldPathFn(dir), newPathFn(dir), makeScope(dir)),
      ).rejects.toMatchObject({ code });
    });

    it("leaves all files at original paths when compute phase fails for a Vue file", async () => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "move-dir-atomic-"));
      dirs.push(tmpRoot);

      const srcDir = path.join(tmpRoot, "src");
      const destDir = path.join(tmpRoot, "dest");
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, "plain.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(srcDir, "Component.vue"), "<template><div/></template>");

      const compiler = makeMockCompiler({
        getEditsForFileRename: (oldPath: string) => {
          if (oldPath.endsWith(".vue")) {
            return Promise.reject(new Error("compiler exploded during compute"));
          }
          return Promise.resolve([]);
        },
      });

      await expect(moveDirectory(compiler, srcDir, destDir, makeScope(tmpRoot))).rejects.toThrow(
        "compiler exploded during compute",
      );

      expect(fs.existsSync(path.join(srcDir, "plain.ts"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "Component.vue"))).toBe(true);
      expect(fs.existsSync(destDir)).toBe(false);
    });
  });
});
