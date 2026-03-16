import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, readFile } from "../../src/__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("TsMorphCompiler.moveDirectory", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("scope records modified files", () => {
    it("records moved and externally-modified files in scope", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();
      const scope = makeScope(dir);

      await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope);

      // External importer rewritten by compiler
      expect(scope.modified).toContain(`${dir}/src/app.ts`);
      // Moved files also recorded
      expect(scope.modified).toContain(`${dir}/src/lib/a.ts`);
      expect(scope.modified).toContain(`${dir}/src/lib/b.ts`);
    });

    it("does not record unchanged files unrelated to the move", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();
      const scope = makeScope(dir);

      await compiler.moveDirectory(`${dir}/src/utils`, `${dir}/src/lib`, scope);

      // unrelated.ts has no imports from utils/ so it should not be in scope
      expect(scope.modified).not.toContain(`${dir}/src/unrelated.ts`);
    });
  });

  describe("empty directory", () => {
    it("does not record any files in scope when directory has no source files", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);

      const emptyDir = `${dir}/src/empty-utils`;
      fs.mkdirSync(emptyDir, { recursive: true });

      const compiler = new TsMorphCompiler();
      const scope = makeScope(dir);

      await compiler.moveDirectory(emptyDir, `${dir}/src/empty-lib`, scope);

      expect(scope.modified).toHaveLength(0);
    });
  });

  describe("project cache invalidation", () => {
    it("subsequent moveDirectory calls on the same compiler instance work correctly", async () => {
      const dir = copyFixture("move-dir-ts");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

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
      const dir = copyFixture("move-dir-ts-esm");
      dirs.push(dir);
      const compiler = new TsMorphCompiler();
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

  describe("files excluded from tsconfig project", () => {
    it("includes TS files on disk in the moved directory even when excluded from tsconfig", async () => {
      // Copy the fixture and update tsconfig to exclude utils/ — simulating
      // files that exist on disk but are not in the ts-morph project
      const dir = copyFixture("move-dir-ts");
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

      const compiler = new TsMorphCompiler();
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
