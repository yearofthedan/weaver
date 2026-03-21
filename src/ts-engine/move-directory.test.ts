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
import { TsMorphEngine } from "./engine.js";
import { tsMoveDirectory } from "./move-directory.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("tsMoveDirectory", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("source file handling", () => {
    it("physically moves source files and rewrites external imports", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const result = await tsMoveDirectory(
        engine,
        `${dir}/src/utils`,
        `${dir}/src/lib/helpers`,
        makeScope(dir),
      );

      expect(fileExists(dir, "src/lib/helpers/a.ts")).toBe(true);
      expect(fileExists(dir, "src/lib/helpers/b.ts")).toBe(true);
      expect(fileExists(dir, "src/utils/a.ts")).toBe(false);
      expect(fileExists(dir, "src/utils/b.ts")).toBe(false);

      const appContent = readFile(dir, "src/app.ts");
      expect(appContent).toContain("./lib/helpers/a");
      expect(appContent).toContain("./lib/helpers/b");
      expect(appContent).not.toContain("./utils/a");
      expect(appContent).not.toContain("./utils/b");

      expect(result.filesMoved).toContain(`${dir}/src/lib/helpers/a.ts`);
      expect(result.filesMoved).toContain(`${dir}/src/lib/helpers/b.ts`);
    });

    it("records all moved source files as modified in scope", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      await tsMoveDirectory(engine, `${dir}/src/utils`, `${dir}/src/lib/helpers`, makeScope(dir));

      const scope = makeScope(dir);
      const result = await tsMoveDirectory(
        new TsMorphEngine(),
        `${dir}/src/lib/helpers`,
        `${dir}/src/lib/utils2`,
        scope,
      );

      expect(scope.modified).toContain(`${dir}/src/lib/utils2/a.ts`);
      expect(scope.modified).toContain(`${dir}/src/lib/utils2/b.ts`);
      expect(result.filesMoved).toContain(`${dir}/src/lib/utils2/a.ts`);
    });

    it("preserves intra-directory imports unchanged after move", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      await tsMoveDirectory(engine, `${dir}/src/utils`, `${dir}/src/lib`, makeScope(dir));

      // b.ts imports ./a (intra-directory) — must remain ./a after the move
      const bContent = readFile(dir, "src/lib/b.ts");
      expect(bContent).toContain('"./a"');
      expect(bContent).not.toContain("utils");
    });
  });

  describe("non-source file handling", () => {
    it("includes non-source files in filesMoved via atomic OS rename", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);

      fs.writeFileSync(path.join(dir, "src/utils/config.json"), '{"key": "value"}');
      fs.writeFileSync(path.join(dir, "src/utils/styles.css"), ".foo { color: red; }");

      const engine = new TsMorphEngine();
      const result = await tsMoveDirectory(
        engine,
        `${dir}/src/utils`,
        `${dir}/src/lib`,
        makeScope(dir),
      );

      expect(fileExists(dir, "src/lib/config.json")).toBe(true);
      expect(fileExists(dir, "src/lib/styles.css")).toBe(true);
      expect(result.filesMoved).toContain(`${dir}/src/lib/config.json`);
      expect(result.filesMoved).toContain(`${dir}/src/lib/styles.css`);
    });

    it("moves non-source-only directories with no source files", async () => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "ts-move-dir-assets-"));
      dirs.push(tmpRoot);

      const assetsDir = path.join(tmpRoot, "assets");
      fs.mkdirSync(assetsDir);
      fs.writeFileSync(path.join(assetsDir, "logo.svg"), "<svg/>");
      fs.writeFileSync(path.join(assetsDir, "style.css"), "body { margin: 0; }");

      const engine = new TsMorphEngine();
      const result = await tsMoveDirectory(
        engine,
        assetsDir,
        path.join(tmpRoot, "public"),
        makeScope(tmpRoot),
      );

      expect(fs.existsSync(path.join(tmpRoot, "public/logo.svg"))).toBe(true);
      expect(fs.existsSync(path.join(tmpRoot, "public/style.css"))).toBe(true);
      expect(result.filesMoved).toContain(path.join(tmpRoot, "public/logo.svg"));
      expect(result.filesMoved).toContain(path.join(tmpRoot, "public/style.css"));
    });
  });

  describe("empty directory", () => {
    it("returns empty filesMoved for a directory with no files", async () => {
      const tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "ts-move-dir-empty-"));
      dirs.push(tmpRoot);

      const emptyDir = path.join(tmpRoot, "source");
      fs.mkdirSync(emptyDir);
      const engine = new TsMorphEngine();

      const result = await tsMoveDirectory(
        engine,
        emptyDir,
        path.join(tmpRoot, "dest"),
        makeScope(tmpRoot),
      );

      expect(result.filesMoved).toEqual([]);
    });
  });

  describe("SKIP_DIRS exclusion", () => {
    it("does not include node_modules contents in filesMoved", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);

      const fakeNodeModules = path.join(dir, "src/utils/node_modules");
      fs.mkdirSync(fakeNodeModules);
      fs.writeFileSync(path.join(fakeNodeModules, "dep.ts"), "export const x = 1;");

      const engine = new TsMorphEngine();
      const result = await tsMoveDirectory(
        engine,
        `${dir}/src/utils`,
        `${dir}/src/lib`,
        makeScope(dir),
      );

      const movedBasenames = result.filesMoved.map((f) => path.basename(f));
      expect(movedBasenames).not.toContain("dep.ts");
      expect(movedBasenames).toContain("a.ts");
      expect(movedBasenames).toContain("b.ts");
    });
  });
});
