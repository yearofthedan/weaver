import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fileExists, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { makeMockCompiler } from "../ts-engine/__testHelpers__/mock-compiler.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { moveDirectory } from "./moveDirectory.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveDirectory", () => {
  describe("basic directory move", () => {
    test.override({ fixtureName: FIXTURES.moveDirTs.name });

    test("moves directory files and rewrites external imports", async ({ dir }) => {
      const compiler = new TsMorphEngine();

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

    test("includes moved files in filesModified", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      const result = await moveDirectory(
        compiler,
        `${dir}/src/utils`,
        `${dir}/src/lib/helpers`,
        makeScope(dir),
      );

      expect(result.filesModified).toContain(`${dir}/src/lib/helpers/a.ts`);
      expect(result.filesModified).toContain(`${dir}/src/lib/helpers/b.ts`);
    });

    test("removes the old directory tree after a successful move", async ({ dir }) => {
      const compiler = new TsMorphEngine();
      const oldPath = `${dir}/src/utils`;

      await moveDirectory(compiler, oldPath, `${dir}/src/lib/helpers`, makeScope(dir));

      expect(fs.existsSync(oldPath)).toBe(false);
    });
  });

  describe("non-source files", () => {
    test.override({ fixtureName: FIXTURES.moveDirTs.name });

    test("moves non-source files (json, css) via plain filesystem copy", async ({ dir }) => {
      const compiler = new TsMorphEngine();

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

    test("creates destination directory when moving non-source files into a new directory", async ({
      dir,
    }) => {
      const compiler = new TsMorphEngine();

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
    test.override({ fixtureName: FIXTURES.moveDirTs.name });

    test("excludes SKIP_DIRS (node_modules) contents from the filesMoved result", async ({
      dir,
    }) => {
      const compiler = new TsMorphEngine();

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
    test.override({ fixtureName: FIXTURES.moveDirTs.name });

    test("throws MOVE_INTO_SELF when oldPath and newPath are the same directory", async ({
      dir,
    }) => {
      const compiler = new TsMorphEngine();

      await expect(
        moveDirectory(compiler, `${dir}/src/utils`, `${dir}/src/utils`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "MOVE_INTO_SELF" });
    });

    test("skips symlinks in directory enumeration", async ({ dir }) => {
      const compiler = new TsMorphEngine();

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

  describe("Vue import specifiers", () => {
    test.override({ fixtureName: FIXTURES.moveDirVue.name });

    test("physically moves .vue files to the destination when the directory moves", async ({
      dir,
    }) => {
      const compiler = new TsMorphEngine();

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

    test("preserves .vue extension in moved file content — no .vue.ts artifact introduced", async ({
      dir,
    }) => {
      const compiler = new TsMorphEngine();

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

    test("preserves .vue extension in moved file content for moduleResolution bundler", async ({
      dir,
    }) => {
      // The fixture uses moduleResolution: bundler — verify no extension stripping occurs
      const compiler = new TsMorphEngine();

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

    test("preserves intra-directory .ts imports within the moved directory", async ({ dir }) => {
      const compiler = new TsMorphEngine();

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

    test("includes moved .vue files in filesMoved result", async ({ dir }) => {
      const compiler = new TsMorphEngine();

      const result = await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      // .vue files must appear in filesMoved even though the compiler doesn't track them
      expect(result.filesMoved).toContain(`${dir}/src/ui/widgets/Button.vue`);
    });

    test("does not introduce .vue.ts artifacts in any file after move", async ({ dir }) => {
      // ts-morph uses virtual .vue.ts stubs internally — these must never leak to disk
      const compiler = new TsMorphEngine();

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
    test.override({ fixtureName: FIXTURES.moveDirTs.name });

    test("returns empty arrays and no error for a directory with no files", async ({ dir }) => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "move-dir-empty-"));
      try {
        const emptyDir = path.join(tmpRoot, "source");
        fs.mkdirSync(emptyDir);
        const destDir = path.join(tmpRoot, "dest");
        const compiler = new TsMorphEngine();
        const scope = makeScope(tmpRoot);

        const result = await moveDirectory(compiler, emptyDir, destDir, scope);

        expect(result.filesMoved).toEqual([]);
        expect(result.filesModified).toEqual([]);
        expect(result.filesSkipped).toEqual([]);
        expect(result.oldPath).toBe(emptyDir);
        expect(result.newPath).toBe(destDir);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });

  describe("error cases", () => {
    test.override({ fixtureName: FIXTURES.moveDirTs.name });

    test("throws FILE_NOT_FOUND when source does not exist", async ({ dir }) => {
      await expect(
        moveDirectory(
          new TsMorphEngine(),
          `${dir}/src/nonexistent`,
          `${dir}/src/dest`,
          makeScope(dir),
        ),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("throws NOT_A_DIRECTORY when source is a file", async ({ dir }) => {
      await expect(
        moveDirectory(new TsMorphEngine(), `${dir}/src/app.ts`, `${dir}/src/dest`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "NOT_A_DIRECTORY" });
    });

    test("throws DESTINATION_EXISTS when destination is a non-empty directory", async ({ dir }) => {
      await expect(
        moveDirectory(new TsMorphEngine(), `${dir}/src/utils`, `${dir}/src`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    });

    test("throws MOVE_INTO_SELF when newPath is inside oldPath", async ({ dir }) => {
      await expect(
        moveDirectory(
          new TsMorphEngine(),
          `${dir}/src/utils`,
          `${dir}/src/utils/subdir`,
          makeScope(dir),
        ),
      ).rejects.toMatchObject({ code: "MOVE_INTO_SELF" });
    });

    test("leaves all files at original paths when compiler.moveDirectory fails", async ({
      dir: _dir,
    }) => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "move-dir-atomic-"));
      try {
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
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });
});
