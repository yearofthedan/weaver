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
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsMoveFile } from "./move-file.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("tsMoveFile - TsMorphEngine integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a file and updates imports", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const engine = new TsMorphEngine();

    const oldPath = `${dir}/src/utils.ts`;
    const newPath = `${dir}/lib/utils.ts`;

    const result = await tsMoveFile(engine, oldPath, newPath, makeScope(dir));

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
    const engine = new TsMorphEngine();

    const oldPath = `${dir}/src/utils.ts`;
    const newPath = `${dir}/deep/nested/lib/utils.ts`;
    const scope = makeScope(dir);

    await tsMoveFile(engine, oldPath, newPath, scope);

    expect(fileExists(dir, "deep/nested/lib/utils.ts")).toBe(true);
    expect(scope.modified).toContain(newPath);
  });

  it("updates imports on move-back with the same engine instance", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const engine = new TsMorphEngine();

    await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));
    expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

    await tsMoveFile(engine, `${dir}/lib/utils.ts`, `${dir}/src/utils.ts`, makeScope(dir));

    expect(fileExists(dir, "src/utils.ts")).toBe(true);
    expect(fileExists(dir, "lib/utils.ts")).toBe(false);
    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("./utils");
    expect(mainContent).not.toContain("../lib/utils");
  });

  it("updates imports in out-of-project files (e.g. tests/)", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const engine = new TsMorphEngine();

    await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

    const testContent = readFile(dir, "tests/utils.test.ts");
    expect(testContent).toContain("../lib/utils");
    expect(testContent).not.toContain("../src/utils");
  });

  it("does not corrupt comments when updating imports in out-of-project files", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);
    const engine = new TsMorphEngine();

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

    await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

    const content = readFile(dir, "tests/import-with-comment.ts");
    // Import specifier must be updated
    expect(content).toContain('"../lib/utils"');
    // Comment must NOT be rewritten
    expect(content).toContain("// TODO: migrate logic from ../src/utils to ../lib/utils");
  });

  describe("stale project cache (file added after project load)", () => {
    it("rewrites import in a file created after the project was loaded", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      // Prime the project cache with an initial call so the project is loaded before the new file exists.
      await engine.getEditsForFileRename(`${dir}/src/utils.ts`, `${dir}/src/utils2.ts`);

      // Add a new file that imports utils.ts after the project was loaded
      const newHelper = path.join(dir, "src", "newHelper.ts");
      fs.writeFileSync(newHelper, 'import { greetUser } from "./utils";\nexport { greetUser };\n');

      const scope = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, scope);

      const newHelperContent = fs.readFileSync(path.join(dir, "src", "newHelper.ts"), "utf8");
      expect(newHelperContent).toContain("../lib/utils");
      expect(newHelperContent).not.toContain('"./utils"');

      expect(scope.modified).toContain(path.join(dir, "src", "newHelper.ts"));
    });
  });

  describe("symlink path resolution", () => {
    it("rewrites imports when tsMoveFile is called with a symlinked workspace path", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);

      // Create a symlink pointing to the real fixture dir
      const symlinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-symlink-"));
      dirs.push(symlinkDir);
      const symlink = path.join(symlinkDir, "project");
      fs.symlinkSync(dir, symlink, "dir");

      const engine = new TsMorphEngine();

      // Use symlink-based paths for the move
      const oldPath = `${symlink}/src/utils.ts`;
      const newPath = `${symlink}/lib/utils.ts`;
      const scope = makeScope(symlink);

      await tsMoveFile(engine, oldPath, newPath, scope);

      // Physical move happened
      expect(fs.existsSync(path.join(dir, "lib", "utils.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "src", "utils.ts"))).toBe(false);

      // Import in main.ts must be rewritten
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("../lib/utils");
      expect(mainContent).not.toContain('"./utils"');

      // scope.modified must include the rewritten file
      expect(scope.modified.some((f) => f.endsWith("src/main.ts"))).toBe(true);
    });
  });

  describe("unresolved .js extension imports with moduleResolution node", () => {
    it("rewrites import with .js extension when tsconfig uses moduleResolution node", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      fs.writeFileSync(
        path.join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "node" },
          include: ["src/**/*.ts"],
        }),
      );

      fs.writeFileSync(
        path.join(dir, "src", "consumer.ts"),
        'import { greetUser } from "./utils.js";\nexport { greetUser };\n',
      );

      const scope = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, scope);

      const consumerContent = fs.readFileSync(path.join(dir, "src", "consumer.ts"), "utf8");
      expect(consumerContent).toContain("../lib/utils.js");
      expect(consumerContent).not.toContain('"./utils.js"');

      expect(scope.modified).toContain(path.join(dir, "src", "consumer.ts"));
    });

    it("does not rewrite .js import when an actual .js file exists on disk", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      // Create a real utils.js file alongside utils.ts
      fs.writeFileSync(
        path.join(dir, "src", "utils.js"),
        // biome-ignore lint/suspicious/noTemplateCurlyInString: file content intentionally contains a template literal
        "// this is an actual JS file\nexport function greetUser(name) { return `Hello, ${name}`; }\n",
      );

      fs.writeFileSync(
        path.join(dir, "src", "jsConsumer.ts"),
        'import { greetUser } from "./utils.js";\nexport { greetUser };\n',
      );

      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

      // jsConsumer imports the real utils.js, not utils.ts — must NOT be rewritten
      const jsConsumerContent = fs.readFileSync(path.join(dir, "src", "jsConsumer.ts"), "utf8");
      expect(jsConsumerContent).toContain('"./utils.js"');
      expect(jsConsumerContent).not.toContain("../lib/utils.js");
    });

    it("does not rewrite imports of similarly-named files (substring false positives)", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      fs.writeFileSync(
        path.join(dir, "src", "my-utils.ts"),
        "export function myHelper() { return 42; }\n",
      );

      fs.writeFileSync(
        path.join(dir, "src", "consumer.ts"),
        'import { myHelper } from "./my-utils";\nexport { myHelper };\n',
      );

      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

      const consumerContent = fs.readFileSync(path.join(dir, "src", "consumer.ts"), "utf8");
      expect(consumerContent).toContain('"./my-utils"');
      expect(consumerContent).not.toContain("../lib/my-utils");
    });
  });

  describe("moved out-of-project file own imports", () => {
    it("rewrites relative imports inside a moved out-of-project test file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const oldPath = `${dir}/tests/utils.test.ts`;
      const newPath = `${dir}/tests/unit/utils.test.ts`;
      const scope = makeScope(dir);

      await tsMoveFile(engine, oldPath, newPath, scope);

      const movedContent = fs.readFileSync(newPath, "utf8");
      expect(movedContent).toContain('"../../src/utils"');
      expect(movedContent).not.toContain('"../src/utils"');
      expect(scope.modified).toContain(newPath);
    });

    it("does not rewrite bare module specifiers inside the moved file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const extraTest = path.join(dir, "tests", "mixed.test.ts");
      fs.writeFileSync(
        extraTest,
        [
          'import { describe } from "vitest";',
          'import { greetUser } from "../src/utils";',
          "",
        ].join("\n"),
      );

      const scope = makeScope(dir);
      await tsMoveFile(engine, extraTest, path.join(dir, "tests", "unit", "mixed.test.ts"), scope);

      const movedContent = fs.readFileSync(
        path.join(dir, "tests", "unit", "mixed.test.ts"),
        "utf8",
      );
      expect(movedContent).toContain('"vitest"');
      expect(movedContent).toContain('"../../src/utils"');
      expect(scope.modified).toContain(path.join(dir, "tests", "unit", "mixed.test.ts"));
    });

    it("preserves .js extension when rewriting relative imports in a moved file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const extraTest = path.join(dir, "tests", "js-ext.test.ts");
      fs.writeFileSync(extraTest, 'import { greetUser } from "../src/utils.js";\n');

      await tsMoveFile(
        engine,
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
      const engine = new TsMorphEngine();

      const extraTest = path.join(dir, "tests", "renamed.test.ts");
      fs.writeFileSync(extraTest, 'import { greetUser } from "../src/utils";\n');

      await tsMoveFile(engine, extraTest, path.join(dir, "tests", "other.test.ts"), makeScope(dir));

      const movedContent = fs.readFileSync(path.join(dir, "tests", "other.test.ts"), "utf8");
      expect(movedContent).toContain('"../src/utils"');
    });
  });

  describe("sequential moves (project graph survives across calls)", () => {
    it("sequential moves of out-of-project files both return ok and rewrites import to correct path", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const helperPath = path.join(dir, "tests", "helper.ts");
      const consumerPath = path.join(dir, "tests", "consumer.test.ts");
      fs.writeFileSync(helperPath, "export function help() { return 42; }\n");
      fs.writeFileSync(consumerPath, 'import { help } from "./helper";\nconsole.log(help());\n');

      const helperNewPath = path.join(dir, "lib", "helper.ts");
      const scopeA = makeScope(dir);
      await tsMoveFile(engine, helperPath, helperNewPath, scopeA);
      expect(scopeA.modified).toContain(helperNewPath);

      const consumerNewPath = path.join(dir, "tests", "unit", "consumer.test.ts");
      const scopeB = makeScope(dir);
      await tsMoveFile(engine, consumerPath, consumerNewPath, scopeB);
      expect(scopeB.modified).toContain(consumerNewPath);

      const movedConsumerContent = fs.readFileSync(consumerNewPath, "utf8");
      expect(movedConsumerContent).toContain("../../lib/helper");
      expect(movedConsumerContent).not.toContain('"./helper"');
    });

    it("does not throw ENOENT when moving a file that imports a previously-moved file", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const helperOldPath = path.join(dir, "tests", "helper.ts");
      const helperNewPath = path.join(dir, "lib", "helper.ts");
      const consumerPath = path.join(dir, "tests", "consumer.ts");

      fs.writeFileSync(helperOldPath, "export function help() { return 42; }\n");
      fs.writeFileSync(consumerPath, 'import { help } from "./helper";\nconsole.log(help());\n');

      await engine.getEditsForFileRename(helperOldPath, helperNewPath);

      fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
      fs.renameSync(helperOldPath, helperNewPath);

      await expect(
        engine.getEditsForFileRename(consumerPath, path.join(dir, "lib", "consumer.ts")),
      ).resolves.not.toThrow();
    });

    it("second tsMoveFile call succeeds and rewrites import to new path of moved dependency", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const scopeA = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, scopeA);
      expect(scopeA.modified).toContain(`${dir}/lib/utils.ts`);
      expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

      const scopeB = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/main.ts`, `${dir}/dist/main.ts`, scopeB);
      expect(scopeB.modified).toContain(`${dir}/dist/main.ts`);

      const movedMainContent = fs.readFileSync(`${dir}/dist/main.ts`, "utf8");
      expect(movedMainContent).toContain("../lib/utils");
      expect(movedMainContent).not.toContain("../src/utils");
    });

    it("fallback scan rewrites out-of-project importer on the second move after project graph update", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const scriptPath = path.join(dir, "scripts", "run.ts");
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(
        scriptPath,
        'import { greetUser } from "../src/main";\nconsole.log(greetUser("world"));\n',
      );

      const scopeA = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, scopeA);
      expect(scopeA.modified).toContain(`${dir}/lib/utils.ts`);

      const scopeB = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/main.ts`, `${dir}/dist/main.ts`, scopeB);

      const scriptContent = fs.readFileSync(scriptPath, "utf8");
      expect(scriptContent).toContain("../dist/main");
      expect(scriptContent).not.toContain("../src/main");
      expect(scopeB.modified).toContain(`${dir}/dist/main.ts`);
      expect(scopeB.modified).toContain(scriptPath);
    });
  });

  describe("sequential moves in git-tracked directories", () => {
    it("does not throw ENOENT when git ls-files returns a file deleted by a prior move", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-git-move-"));
      dirs.push(dir);

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

      const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
      execSync("git init", { cwd: dir, env: gitEnv, stdio: "pipe" });
      execSync("git config user.email test@test.com", { cwd: dir, env: gitEnv, stdio: "pipe" });
      execSync("git config user.name Test", { cwd: dir, env: gitEnv, stdio: "pipe" });
      execSync("git add .", { cwd: dir, env: gitEnv, stdio: "pipe" });
      execSync("git commit -m init", { cwd: dir, env: gitEnv, stdio: "pipe" });

      const engine = new TsMorphEngine();

      const scope1 = makeScope(dir);
      await tsMoveFile(
        engine,
        path.join(dir, "tests", "helpers", "mock.ts"),
        path.join(dir, "src", "helpers", "mock.ts"),
        scope1,
      );
      expect(scope1.modified).toContain(path.join(dir, "src", "helpers", "mock.ts"));

      const scope2 = makeScope(dir);
      await tsMoveFile(
        engine,
        path.join(dir, "tests", "consumer.test.ts"),
        path.join(dir, "src", "consumer.test.ts"),
        scope2,
      );
      expect(scope2.modified).toContain(path.join(dir, "src", "consumer.test.ts"));

      const content = fs.readFileSync(path.join(dir, "src", "consumer.test.ts"), "utf8");
      expect(content).toContain("./helpers/mock");
      expect(content).not.toContain('"../tests/helpers/mock"');
    });
  });

  describe("filesModified completeness", () => {
    it("includes all rewritten files including those updated by fallback scan", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const scope = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, scope);

      expect(scope.modified).toContain(`${dir}/src/main.ts`);
      expect(scope.modified).toContain(`${dir}/tests/utils.test.ts`);
      expect(scope.modified).toContain(`${dir}/lib/utils.ts`);
    });

    it("does not include the same file twice", async () => {
      const dir = copyFixture(FIXTURES.simpleTs.name);
      dirs.push(dir);
      const engine = new TsMorphEngine();

      const scope = makeScope(dir);
      await tsMoveFile(engine, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, scope);

      const uniqueFiles = new Set(scope.modified);
      expect(scope.modified.length).toBe(uniqueFiles.size);
    });
  });
});
