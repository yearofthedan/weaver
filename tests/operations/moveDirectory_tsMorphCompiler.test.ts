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

    it("excludes SKIP_DIRS (node_modules) contents from the filesMoved result", async () => {
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

      // node_modules contents are not tracked in filesMoved (not source files)
      const movedBasenames = result.filesMoved.map((f) => path.basename(f));
      expect(movedBasenames).not.toContain("dep.ts");
      // The entire directory was atomically moved — node_modules physically moved with it
      expect(fileExists(dir, "src/lib/node_modules/dep.ts")).toBe(true);
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

    it("preserves intra-directory imports when files import each other after a deep move", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib/deep/nested`,
        makeScope(dir),
      );

      // b.ts imports ./a — must stay ./a regardless of how deep the move goes
      const bContent = readFile(dir, "src/lib/deep/nested/b.ts");
      expect(bContent).toContain('"./a"');
      expect(bContent).not.toContain("utils");
    });
  });

  describe("Vue import specifiers", () => {
    it("physically moves .vue files to the destination when the directory moves", async () => {
      const dir = copyFixture("move-dir-vue");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      // .vue files must be physically present at the new path
      expect(fileExists(dir, "src/ui/widgets/Button.vue")).toBe(true);
      // Old location must be gone
      expect(fileExists(dir, "src/components/Button.vue")).toBe(false);
    });

    it("preserves .vue extension in moved file content — no .vue.ts artifact introduced", async () => {
      const dir = copyFixture("move-dir-vue");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      // The moved Button.vue must not have been corrupted by ts-morph's virtual .vue.ts mapping
      const buttonContent = readFile(dir, "src/ui/widgets/Button.vue");
      expect(buttonContent).not.toContain(".vue.ts");
      // Script content must be intact (defineProps is present in the original)
      expect(buttonContent).toContain("defineProps");
    });

    it("preserves .vue extension in moved file content for moduleResolution bundler", async () => {
      // The fixture uses moduleResolution: bundler — verify no extension stripping occurs
      const dir = copyFixture("move-dir-vue");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      const buttonContent = readFile(dir, "src/ui/widgets/Button.vue");
      // The .vue extension must not be stripped from file contents
      expect(buttonContent).not.toContain(".vue.ts");
      expect(buttonContent).toContain("<template>");
    });

    it("preserves intra-directory .ts imports within the moved directory", async () => {
      const dir = copyFixture("move-dir-vue");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      // Button.vue's import of ./utils should stay ./utils (both files moved together)
      const buttonContent = readFile(dir, "src/ui/widgets/Button.vue");
      expect(buttonContent).toContain("./utils");
      expect(buttonContent).not.toContain("components");
    });

    it("includes moved .vue files in filesMoved result", async () => {
      const dir = copyFixture("move-dir-vue");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const result = await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      // .vue files must appear in filesMoved even though the compiler doesn't track them
      expect(result.filesMoved).toContain(`${dir}/src/ui/widgets/Button.vue`);
    });

    it("does not introduce .vue.ts artifacts in any file after move", async () => {
      // ts-morph uses virtual .vue.ts stubs internally — these must never leak to disk
      const dir = copyFixture("move-dir-vue");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      // No .vue.ts file should exist anywhere in the fixture
      expect(fileExists(dir, "src/ui/widgets/Button.vue.ts")).toBe(false);
      expect(fileExists(dir, "src/components/Button.vue.ts")).toBe(false);
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

    it("leaves all files at original paths when compiler.moveDirectory fails", async () => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "move-dir-atomic-"));
      dirs.push(tmpRoot);

      const srcDir = path.join(tmpRoot, "src");
      const destDir = path.join(tmpRoot, "dest");
      fs.mkdirSync(srcDir);
      fs.writeFileSync(path.join(srcDir, "plain.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(srcDir, "Component.vue"), "<template><div/></template>");

      const compiler = makeMockCompiler({
        moveDirectory: () => Promise.reject(new Error("compiler exploded")),
      });

      await expect(moveDirectory(compiler, srcDir, destDir, makeScope(tmpRoot))).rejects.toThrow(
        "compiler exploded",
      );

      expect(fs.existsSync(path.join(srcDir, "plain.ts"))).toBe(true);
      expect(fs.existsSync(path.join(srcDir, "Component.vue"))).toBe(true);
      expect(fs.existsSync(destDir)).toBe(false);
    });
  });
});
