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

describe("TsMorphEngine.moveDirectory", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("scope records modified files", () => {
    it("records moved and externally-modified files in scope", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);
      const compiler = new TsMorphEngine();
      const scope = makeScope(dir);

      await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope);

      // External importer rewritten by compiler
      expect(scope.modified).toContain(`${dir}/src/app.ts`);
      // Moved files also recorded
      expect(scope.modified).toContain(`${dir}/src/lib/a.ts`);
      expect(scope.modified).toContain(`${dir}/src/lib/b.ts`);
    });

    it("does not record unchanged files unrelated to the move", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);
      const compiler = new TsMorphEngine();
      const scope = makeScope(dir);

      await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope);

      // unrelated.ts has no imports from utils/ so it should not be in scope
      expect(scope.modified).not.toContain(`${dir}/src/unrelated.ts`);
    });
  });

  describe("empty directory", () => {
    it("does not record any files in scope when directory has no source files", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);

      const emptyDir = `${dir}/src/empty-utils`;
      fs.mkdirSync(emptyDir, { recursive: true });

      const compiler = new TsMorphEngine();
      const scope = makeScope(dir);

      await compiler.moveDirectory(emptyDir, `${dir}/src/empty-lib`, scope);

      expect(scope.modified).toHaveLength(0);
    });
  });

  describe("project cache invalidation", () => {
    it("subsequent moveDirectory calls on the same compiler instance work correctly", async () => {
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);
      const compiler = new TsMorphEngine();

      // First move: utils -> lib
      const scope1 = makeScope(dir);
      const result1 = await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope1);
      expect(result1.filesMoved).toContain(`${dir}/src/lib/a.ts`);

      // Second move on the same compiler: lib/nested -> lib/sub
      // This verifies the project cache was invalidated after the first move
      const scope2 = makeScope(dir);
      const result2 = await compiler.moveDirectory(
        `${dir}/src/lib/nested`,
        `${dir}/src/lib/sub`,
        scope2,
      );
      expect(result2.filesMoved).toContain(`${dir}/src/lib/sub/c.ts`);
      expect(result2.filesMoved).not.toContain(`${dir}/src/lib/nested/c.ts`);
    });
  });

  describe("ESM .js extension preservation", () => {
    it("preserves .js extensions in import specifiers after directory move", async () => {
      const dir = copyFixture(FIXTURES.moveDirTsEsm.name);
      dirs.push(dir);
      const compiler = new TsMorphEngine();
      const scope = makeScope(dir);

      await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope);

      // External importer: .js extensions must be preserved
      const appContent = readFile(dir, "src/app.ts");
      expect(appContent).toContain("./lib/a.js");
      expect(appContent).toContain("./lib/b.js");
      expect(appContent).not.toContain("./utils/");

      // Internal import within moved directory: b.ts imports from a.ts with .js extension
      // Since both files moved together, the relative path stays the same
      const bContent = readFile(dir, "src/lib/b.ts");
      expect(bContent).toContain("./a.js");
      expect(bContent).not.toContain("./utils/");
    });
  });

  describe("sub-project boundary", () => {
    it("does not rewrite internal imports when moved directory has its own tsconfig", async () => {
      const dir = copyFixture(FIXTURES.moveDirSubproject.name);
      dirs.push(dir);
      const compiler = new TsMorphEngine();
      const scope = makeScope(dir);

      await compiler.moveDirectory(`${dir}/src/pkg`, `${dir}/src/library`, scope);

      const indexContent = readFile(dir, "src/library/index.ts");
      expect(indexContent).toContain("./utils");
      expect(indexContent).not.toContain("pkg");

      const appContent = readFile(dir, "src/app.ts");
      expect(appContent).toContain("./library/index");
      expect(appContent).not.toContain("./pkg/");
    });
  });

  describe("files excluded from tsconfig project", () => {
    it("includes TS files on disk in the moved directory even when excluded from tsconfig", async () => {
      // Copy the fixture and update tsconfig to exclude utils/ — simulating
      // files that exist on disk but are not in the ts-morph project
      const dir = copyFixture(FIXTURES.moveDirTs.name);
      dirs.push(dir);

      // Rewrite tsconfig to only include app.ts — utils/*.ts are excluded
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["src/app.ts"] }),
      );

      // Add a nested file to the excluded utils directory for SKIP_DIRS coverage
      const nmDir = path.join(dir, "src/utils/node_modules");
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, "skip.ts"), "export const x = 1;\n");

      const compiler = new TsMorphEngine();
      const scope = makeScope(dir);

      const result = await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope);

      // enumerateSourceFiles should have added the excluded files to the project
      expect(result.filesMoved).toContain(`${dir}/src/lib/a.ts`);
      expect(result.filesMoved).toContain(`${dir}/src/lib/b.ts`);
      expect(result.filesMoved).toContain(`${dir}/src/lib/nested/c.ts`);
      // node_modules is skipped by SKIP_DIRS
      expect(result.filesMoved).not.toContain(`${dir}/src/lib/node_modules/skip.ts`);
      // External importer should be rewritten even though utils/ was excluded from tsconfig
      const appContent = readFile(dir, "src/app.ts");
      expect(appContent).toContain("./lib/a");
      expect(appContent).not.toContain("./utils/a");
    });
  });
});
