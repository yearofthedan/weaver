import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  copyFixture,
  FIXTURES,
  fileExists,
  readFile,
} from "../__testHelpers__/helpers.js";
import { TsMorphCompiler } from "../compilers/ts.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { moveFile } from "./moveFile.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveFile action - TsMorphCompiler Integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a file and updates imports", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const compiler = new TsMorphCompiler();

    const oldPath = `${dir}/src/utils.ts`;
    const newPath = `${dir}/lib/utils.ts`;

    const result = await moveFile(compiler, oldPath, newPath, makeScope(dir));

    expect(result.oldPath).toBe(oldPath);
    expect(result.newPath).toBe(newPath);
    expect(fileExists(dir, "lib/utils.ts")).toBe(true);
    expect(fileExists(dir, "src/utils.ts")).toBe(false);

    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("../lib/utils");
  });

  it("creates destination directory if missing", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const compiler = new TsMorphCompiler();

    const oldPath = `${dir}/src/utils.ts`;
    const newPath = `${dir}/deep/nested/lib/utils.ts`;

    const result = await moveFile(compiler, oldPath, newPath, makeScope(dir));

    expect(fileExists(dir, "deep/nested/lib/utils.ts")).toBe(true);
    expect(result.filesModified).toContain(newPath);
  });

  it("updates imports on move-back with the same compiler instance", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const compiler = new TsMorphCompiler();

    await moveFile(compiler, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));
    expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

    await moveFile(compiler, `${dir}/lib/utils.ts`, `${dir}/src/utils.ts`, makeScope(dir));

    expect(fileExists(dir, "src/utils.ts")).toBe(true);
    expect(fileExists(dir, "lib/utils.ts")).toBe(false);
    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("./utils");
    expect(mainContent).not.toContain("../lib/utils");
  });

  it("updates imports in out-of-project files (e.g. tests/)", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const compiler = new TsMorphCompiler();

    await moveFile(compiler, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

    const testContent = readFile(dir, "tests/utils.test.ts");
    expect(testContent).toContain("../lib/utils");
    expect(testContent).not.toContain("../src/utils");
  });

  it("does not corrupt comments when updating imports in out-of-project files", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const compiler = new TsMorphCompiler();

    // This file has a specific structure (comment containing the same path as the import)
    // that would pollute the shared fixture with a special-case artefact
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

    await moveFile(compiler, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

    const content = readFile(dir, "tests/import-with-comment.ts");
    // Import specifier must be updated
    expect(content).toContain('"../lib/utils"');
    // Comment must NOT be rewritten
    expect(content).toContain("// TODO: migrate logic from ../src/utils to ../lib/utils");
  });

  it("throws FILE_NOT_FOUND for non-existent source", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const compiler = new TsMorphCompiler();

    await expect(
      moveFile(compiler, `${dir}/src/doesNotExist.ts`, `${dir}/lib/utils.ts`, makeScope(dir)),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  describe("stale project cache (file added after project load)", () => {
    it("rewrites import in a file created after the project was loaded", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Prime the project cache with an initial call so the project is loaded before the new file exists.
      await compiler.getEditsForFileRename(`${dir}/src/utils.ts`, `${dir}/src/utils2.ts`);

      // Add a new file that imports utils.ts after the project was loaded — it is not yet in
      // program.getSourceFiles() and would be missed by a stale cache.
      const newHelper = path.join(dir, "src", "newHelper.ts");
      fs.writeFileSync(newHelper, 'import { greetUser } from "./utils";\nexport { greetUser };\n');

      const result = await moveFile(
        compiler,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );

      const newHelperContent = fs.readFileSync(path.join(dir, "src", "newHelper.ts"), "utf8");
      expect(newHelperContent).toContain("../lib/utils");
      expect(newHelperContent).not.toContain('"./utils"');

      // filesModified must include all rewritten files
      expect(result.filesModified).toContain(path.join(dir, "src", "newHelper.ts"));
    });
  });

  describe("symlink path resolution", () => {
    it("rewrites imports when moveFile is called with a symlinked workspace path", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);

      // Create a symlink pointing to the real fixture dir
      const symlinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-symlink-"));
      dirs.push(symlinkDir);
      const symlink = path.join(symlinkDir, "project");
      fs.symlinkSync(dir, symlink, "dir");

      const compiler = new TsMorphCompiler();

      // Use symlink-based paths for the move
      const oldPath = `${symlink}/src/utils.ts`;
      const newPath = `${symlink}/lib/utils.ts`;

      const result = await moveFile(compiler, oldPath, newPath, makeScope(symlink));

      // Physical move happened
      expect(fs.existsSync(path.join(dir, "lib", "utils.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "src", "utils.ts"))).toBe(false);

      // Import in main.ts must be rewritten
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("../lib/utils");
      expect(mainContent).not.toContain('"./utils"');

      // filesModified must include the rewritten file
      expect(result.filesModified.some((f) => f.endsWith("src/main.ts"))).toBe(true);
    });
  });

  describe("unresolved .js extension imports with moduleResolution node", () => {
    it("rewrites import with .js extension when tsconfig uses moduleResolution node", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Update tsconfig to use moduleResolution: "node" (which prevents .js -> .ts resolution)
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "node" },
          include: ["src/**/*.ts"],
        }),
      );

      // Create a file that imports utils with .js extension (ESM-style)
      fs.writeFileSync(
        path.join(dir, "src", "consumer.ts"),
        'import { greetUser } from "./utils.js";\nexport { greetUser };\n',
      );

      const result = await moveFile(
        compiler,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );

      // The .js import must be rewritten to the new path with .js extension
      const consumerContent = fs.readFileSync(path.join(dir, "src", "consumer.ts"), "utf8");
      expect(consumerContent).toContain("../lib/utils.js");
      expect(consumerContent).not.toContain('"./utils.js"');

      // filesModified must include consumer.ts
      expect(result.filesModified).toContain(path.join(dir, "src", "consumer.ts"));
    });

    it("does not rewrite .js import when an actual .js file exists on disk", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Create a real utils.js file alongside utils.ts
      fs.writeFileSync(
        path.join(dir, "src", "utils.js"),
        // biome-ignore lint/suspicious/noTemplateCurlyInString: file content intentionally contains a template literal
        "// this is an actual JS file\nexport function greetUser(name) { return `Hello, ${name}`; }\n",
      );

      // Create a file that imports the real utils.js (not the .ts file)
      fs.writeFileSync(
        path.join(dir, "src", "jsConsumer.ts"),
        'import { greetUser } from "./utils.js";\nexport { greetUser };\n',
      );

      await moveFile(compiler, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

      // jsConsumer imports the real utils.js, not utils.ts — must NOT be rewritten
      const jsConsumerContent = fs.readFileSync(path.join(dir, "src", "jsConsumer.ts"), "utf8");
      expect(jsConsumerContent).toContain('"./utils.js"');
      expect(jsConsumerContent).not.toContain("../lib/utils.js");
    });

    it("does not rewrite imports of similarly-named files (substring false positives)", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Create a my-utils.ts file (not the moved file)
      fs.writeFileSync(
        path.join(dir, "src", "my-utils.ts"),
        "export function myHelper() { return 42; }\n",
      );

      // Create a file that imports my-utils
      fs.writeFileSync(
        path.join(dir, "src", "consumer.ts"),
        'import { myHelper } from "./my-utils";\nexport { myHelper };\n',
      );

      // Move utils.ts — must not affect ./my-utils import
      await moveFile(compiler, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

      const consumerContent = fs.readFileSync(path.join(dir, "src", "consumer.ts"), "utf8");
      expect(consumerContent).toContain('"./my-utils"');
      expect(consumerContent).not.toContain("../lib/my-utils");
    });
  });

  describe("moved out-of-project file own imports", () => {
    it("rewrites relative imports inside a moved out-of-project test file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const oldPath = `${dir}/tests/utils.test.ts`;
      const newPath = `${dir}/tests/unit/utils.test.ts`;

      const result = await moveFile(compiler, oldPath, newPath, makeScope(dir));

      const movedContent = fs.readFileSync(newPath, "utf8");
      expect(movedContent).toContain('"../../src/utils"');
      expect(movedContent).not.toContain('"../src/utils"');
      expect(result.filesModified).toContain(newPath);
    });

    it("does not rewrite bare module specifiers inside the moved file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Add a test file with a bare module specifier alongside a relative one
      const extraTest = path.join(dir, "tests", "mixed.test.ts");
      fs.writeFileSync(
        extraTest,
        [
          'import { describe } from "vitest";',
          'import { greetUser } from "../src/utils";',
          "",
        ].join("\n"),
      );

      const result = await moveFile(
        compiler,
        extraTest,
        path.join(dir, "tests", "unit", "mixed.test.ts"),
        makeScope(dir),
      );

      const movedContent = fs.readFileSync(
        path.join(dir, "tests", "unit", "mixed.test.ts"),
        "utf8",
      );
      expect(movedContent).toContain('"vitest"');
      expect(movedContent).toContain('"../../src/utils"');
      expect(result.filesModified).toContain(path.join(dir, "tests", "unit", "mixed.test.ts"));
    });

    it("preserves .js extension when rewriting relative imports in a moved file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const extraTest = path.join(dir, "tests", "js-ext.test.ts");
      fs.writeFileSync(extraTest, 'import { greetUser } from "../src/utils.js";\n');

      await moveFile(
        compiler,
        extraTest,
        path.join(dir, "tests", "unit", "js-ext.test.ts"),
        makeScope(dir),
      );

      const movedContent = fs.readFileSync(
        path.join(dir, "tests", "unit", "js-ext.test.ts"),
        "utf8",
      );
      expect(movedContent).toContain('"../../src/utils.js"');
      expect(movedContent).not.toContain('"../src/utils.js"');
    });

    it("is a no-op when moved to the same directory depth (same-dir rename)", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const extraTest = path.join(dir, "tests", "renamed.test.ts");
      fs.writeFileSync(extraTest, 'import { greetUser } from "../src/utils";\n');

      await moveFile(compiler, extraTest, path.join(dir, "tests", "other.test.ts"), makeScope(dir));

      const movedContent = fs.readFileSync(path.join(dir, "tests", "other.test.ts"), "utf8");
      expect(movedContent).toContain('"../src/utils"');
    });
  });

  describe("sequential moves (project graph survives across calls)", () => {
    it("sequential moves of out-of-project files both return ok and rewrites import to correct path", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Create two out-of-project files (outside tsconfig include: ["src/**/*.ts"])
      // helper.ts exports something; consumer.test.ts imports "./helper"
      const helperPath = path.join(dir, "tests", "helper.ts");
      const consumerPath = path.join(dir, "tests", "consumer.test.ts");
      fs.writeFileSync(helperPath, "export function help() { return 42; }\n");
      fs.writeFileSync(consumerPath, 'import { help } from "./helper";\nconsole.log(help());\n');

      // Move helper.ts to a different directory (lib/helper.ts)
      const helperNewPath = path.join(dir, "lib", "helper.ts");
      const moveA = await moveFile(compiler, helperPath, helperNewPath, makeScope(dir));
      expect(moveA.filesModified).toContain(helperNewPath);

      // Move consumer.test.ts to a subdirectory
      const consumerNewPath = path.join(dir, "tests", "unit", "consumer.test.ts");
      const moveB = await moveFile(compiler, consumerPath, consumerNewPath, makeScope(dir));
      expect(moveB.filesModified).toContain(consumerNewPath);

      // consumer.test.ts originally imported "./helper" (same dir).
      // After first move: helper is now at lib/helper.ts, consumer is still at tests/consumer.test.ts
      //   so consumer's import should have been rewritten to "../../lib/helper"
      // After second move: consumer moved to tests/unit/consumer.test.ts
      //   relative to tests/unit/, lib/helper.ts is at "../../lib/helper"
      const movedConsumerContent = fs.readFileSync(consumerNewPath, "utf8");
      expect(movedConsumerContent).toContain("../../lib/helper");
      expect(movedConsumerContent).not.toContain('"./helper"');
    });

    it("does not throw ENOENT when moving a file that imports a previously-moved file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Set up: helper.ts (out of tsconfig include) is imported by consumer.ts (also out of include).
      // We'll move helper.ts first (raw FS rename — simulating a previous moveFile call that
      // physically relocated the file). Then move consumer.ts via the full moveFile pipeline.
      // consumer.ts still has its import pointing to the old helper path.
      // With invalidateProject in getEditsForFileRename, the fresh project rebuild triggers an
      // ENOENT when the TS language service tries to open the old path.
      const helperOldPath = path.join(dir, "tests", "helper.ts");
      const helperNewPath = path.join(dir, "lib", "helper.ts");
      const consumerPath = path.join(dir, "tests", "consumer.ts");

      fs.writeFileSync(helperOldPath, "export function help() { return 42; }\n");
      fs.writeFileSync(consumerPath, 'import { help } from "./helper";\nconsole.log(help());\n');

      // Prime the compiler's project cache via an initial call so it knows about both files.
      await compiler.getEditsForFileRename(helperOldPath, helperNewPath);

      // Physically move helper.ts without using moveFile (simulates consumer.ts not yet rewritten).
      fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
      fs.renameSync(helperOldPath, helperNewPath);

      // Now try to call getEditsForFileRename for consumer.ts.
      // consumer.ts still imports "./helper" (old path, now gone).
      // With invalidateProject, a fresh project rebuild causes the TS language service to
      // open "./helper" which no longer exists → ENOENT.
      // With incremental graph update, the cached project already knows helper is gone from
      // tests/ so the language service resolves without hitting the old path.
      await expect(
        compiler.getEditsForFileRename(consumerPath, path.join(dir, "lib", "consumer.ts")),
      ).resolves.not.toThrow();
    });

    it("second moveFile call succeeds and rewrites import to new path of moved dependency", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Move file A (utils.ts → lib/utils.ts). main.ts (imports utils.ts) gets rewritten.
      const moveA = await moveFile(
        compiler,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );
      expect(moveA.filesModified).toContain(`${dir}/lib/utils.ts`);
      // main.ts import must be rewritten by first move
      expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

      // Move file B (main.ts → dist/main.ts).
      const moveB = await moveFile(
        compiler,
        `${dir}/src/main.ts`,
        `${dir}/dist/main.ts`,
        makeScope(dir),
      );
      expect(moveB.filesModified).toContain(`${dir}/dist/main.ts`);

      // Moved main.ts import must reference lib/utils relative to dist/
      const movedMainContent = fs.readFileSync(`${dir}/dist/main.ts`, "utf8");
      expect(movedMainContent).toContain("../lib/utils");
      expect(movedMainContent).not.toContain("../src/utils");
    });

    it("fallback scan rewrites out-of-project importer on the second move after project graph update", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // Create an out-of-project file that imports src/main.ts
      const scriptPath = path.join(dir, "scripts", "run.ts");
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(
        scriptPath,
        'import { greetUser } from "../src/main";\nconsole.log(greetUser("world"));\n',
      );

      // First move: utils.ts → lib/utils.ts (updates project graph incrementally)
      const moveA = await moveFile(
        compiler,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );
      expect(moveA.filesModified).toContain(`${dir}/lib/utils.ts`);

      // Second move: main.ts → dist/main.ts (fallback scan must rewrite scripts/run.ts)
      const moveB = await moveFile(
        compiler,
        `${dir}/src/main.ts`,
        `${dir}/dist/main.ts`,
        makeScope(dir),
      );

      // scripts/run.ts (out-of-project) must have its import updated by the fallback scan
      const scriptContent = fs.readFileSync(scriptPath, "utf8");
      expect(scriptContent).toContain("../dist/main");
      expect(scriptContent).not.toContain("../src/main");
      // The moved file must appear in filesModified
      expect(moveB.filesModified).toContain(`${dir}/dist/main.ts`);
      // The out-of-project file must also appear in filesModified (fallback scan ran)
      expect(moveB.filesModified).toContain(scriptPath);
    });
  });

  describe("sequential moves in git-tracked directories", () => {
    it("does not throw ENOENT when git ls-files returns a file deleted by a prior move", async () => {
      // Regression: walkFiles uses `git ls-files --cached` in git repos, which
      // returns files that are tracked even after deletion from disk. Without the
      // fs.existsSync filter in walkFiles, rewriteImportersOfMovedFile tries to
      // read the deleted file and throws ENOENT.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-git-move-"));
      dirs.push(dir);

      // Set up project with two out-of-project files: helper imports nothing,
      // consumer imports helper. Both are outside tsconfig include.
      fs.mkdirSync(path.join(dir, "src"));
      fs.mkdirSync(path.join(dir, "tests", "helpers"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
      );
      fs.writeFileSync(
        path.join(dir, "src", "utils.ts"),
        "export function greet() { return 'hi'; }\n",
      );
      fs.writeFileSync(
        path.join(dir, "tests", "helpers", "mock.ts"),
        "export function makeMock() { return {}; }\n",
      );
      fs.writeFileSync(
        path.join(dir, "tests", "consumer.test.ts"),
        'import { makeMock } from "./helpers/mock";\nconsole.log(makeMock());\n',
      );

      // Initialize git and commit — critical: git ls-files --cached returns committed files
      execSync("git init && git add . && git commit -m init", { cwd: dir, stdio: "pipe" });

      const compiler = new TsMorphCompiler();

      // Move 1: helper → src/helpers/mock.ts (physically deletes tests/helpers/mock.ts)
      const move1 = await moveFile(
        compiler,
        path.join(dir, "tests", "helpers", "mock.ts"),
        path.join(dir, "src", "helpers", "mock.ts"),
        makeScope(dir),
      );
      expect(move1.filesModified).toContain(path.join(dir, "src", "helpers", "mock.ts"));

      // Move 2: consumer.test.ts → src/consumer.test.ts
      // Without the walkFiles fix, this throws ENOENT because git ls-files still
      // returns tests/helpers/mock.ts (deleted from disk but in git index).
      const move2 = await moveFile(
        compiler,
        path.join(dir, "tests", "consumer.test.ts"),
        path.join(dir, "src", "consumer.test.ts"),
        makeScope(dir),
      );
      expect(move2.filesModified).toContain(path.join(dir, "src", "consumer.test.ts"));

      // Verify the moved consumer's import was rewritten to the new helper location
      const content = fs.readFileSync(path.join(dir, "src", "consumer.test.ts"), "utf8");
      expect(content).toContain("./helpers/mock");
      expect(content).not.toContain('"../tests/helpers/mock"');
    });
  });

  describe("filesModified completeness", () => {
    it("includes all rewritten files including those updated by fallback scan", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      // out-of-project test file already references utils
      const result = await moveFile(
        compiler,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );

      // Both main.ts (in-project) and tests/utils.test.ts (out-of-project) must be in filesModified
      expect(result.filesModified).toContain(`${dir}/src/main.ts`);
      expect(result.filesModified).toContain(`${dir}/tests/utils.test.ts`);
      // The moved file itself must be in filesModified
      expect(result.filesModified).toContain(`${dir}/lib/utils.ts`);
    });

    it("does not include the same file twice", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const compiler = new TsMorphCompiler();

      const result = await moveFile(
        compiler,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );

      const uniqueFiles = new Set(result.filesModified);
      expect(result.filesModified.length).toBe(uniqueFiles.size);
    });
  });
});
