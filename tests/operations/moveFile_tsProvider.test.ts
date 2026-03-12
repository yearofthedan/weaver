import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/compilers/ts.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveFile } from "../../src/operations/moveFile.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { cleanup, copyFixture, fileExists, readFile } from "../helpers.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveFile action - TS Provider Integration", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("moves a file and updates imports", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const provider = new TsProvider();

    const oldPath = `${dir}/src/utils.ts`;
    const newPath = `${dir}/lib/utils.ts`;

    const result = await moveFile(provider, oldPath, newPath, makeScope(dir));

    expect(result.oldPath).toBe(oldPath);
    expect(result.newPath).toBe(newPath);
    expect(fileExists(dir, "lib/utils.ts")).toBe(true);
    expect(fileExists(dir, "src/utils.ts")).toBe(false);

    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("../lib/utils");
  });

  it("creates destination directory if missing", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const provider = new TsProvider();

    const oldPath = `${dir}/src/utils.ts`;
    const newPath = `${dir}/deep/nested/lib/utils.ts`;

    const result = await moveFile(provider, oldPath, newPath, makeScope(dir));

    expect(fileExists(dir, "deep/nested/lib/utils.ts")).toBe(true);
    expect(result.filesModified).toContain(newPath);
  });

  it("updates imports on move-back with the same provider instance", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const provider = new TsProvider();

    await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));
    expect(readFile(dir, "src/main.ts")).toContain("../lib/utils");

    await moveFile(provider, `${dir}/lib/utils.ts`, `${dir}/src/utils.ts`, makeScope(dir));

    expect(fileExists(dir, "src/utils.ts")).toBe(true);
    expect(fileExists(dir, "lib/utils.ts")).toBe(false);
    const mainContent = readFile(dir, "src/main.ts");
    expect(mainContent).toContain("./utils");
    expect(mainContent).not.toContain("../lib/utils");
  });

  it("updates imports in out-of-project files (e.g. tests/)", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const provider = new TsProvider();

    await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

    const testContent = readFile(dir, "tests/utils.test.ts");
    expect(testContent).toContain("../lib/utils");
    expect(testContent).not.toContain("../src/utils");
  });

  it("does not corrupt comments when updating imports in out-of-project files", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const provider = new TsProvider();

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

    await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

    const content = readFile(dir, "tests/import-with-comment.ts");
    // Import specifier must be updated
    expect(content).toContain('"../lib/utils"');
    // Comment must NOT be rewritten
    expect(content).toContain("// TODO: migrate logic from ../src/utils to ../lib/utils");
  });

  it("throws FILE_NOT_FOUND for non-existent source", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);
    const provider = new TsProvider();

    await expect(
      moveFile(provider, `${dir}/src/doesNotExist.ts`, `${dir}/lib/utils.ts`, makeScope(dir)),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  describe("stale project cache (file added after project load)", () => {
    it("rewrites import in a file created after the project was loaded", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      // Prime the project cache with an initial call so the project is loaded before the new file exists.
      await provider.getEditsForFileRename(`${dir}/src/utils.ts`, `${dir}/src/utils2.ts`);

      // Add a new file that imports utils.ts after the project was loaded — it is not yet in
      // program.getSourceFiles() and would be missed by a stale cache.
      const newHelper = path.join(dir, "src", "newHelper.ts");
      fs.writeFileSync(newHelper, 'import { greetUser } from "./utils";\nexport { greetUser };\n');

      const result = await moveFile(
        provider,
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
      const dir = copyFixture("simple-ts");
      dirs.push(dir);

      // Create a symlink pointing to the real fixture dir
      const symlinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-symlink-"));
      dirs.push(symlinkDir);
      const symlink = path.join(symlinkDir, "project");
      fs.symlinkSync(dir, symlink, "dir");

      const provider = new TsProvider();

      // Use symlink-based paths for the move
      const oldPath = `${symlink}/src/utils.ts`;
      const newPath = `${symlink}/lib/utils.ts`;

      const result = await moveFile(provider, oldPath, newPath, makeScope(symlink));

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
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

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
        provider,
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
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

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

      await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

      // jsConsumer imports the real utils.js, not utils.ts — must NOT be rewritten
      const jsConsumerContent = fs.readFileSync(path.join(dir, "src", "jsConsumer.ts"), "utf8");
      expect(jsConsumerContent).toContain('"./utils.js"');
      expect(jsConsumerContent).not.toContain("../lib/utils.js");
    });

    it("does not rewrite imports of similarly-named files (substring false positives)", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

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
      await moveFile(provider, `${dir}/src/utils.ts`, `${dir}/lib/utils.ts`, makeScope(dir));

      const consumerContent = fs.readFileSync(path.join(dir, "src", "consumer.ts"), "utf8");
      expect(consumerContent).toContain('"./my-utils"');
      expect(consumerContent).not.toContain("../lib/my-utils");
    });
  });

  describe("filesModified completeness", () => {
    it("includes all rewritten files including those updated by fallback scan", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      // out-of-project test file already references utils
      const result = await moveFile(
        provider,
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
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const provider = new TsProvider();

      const result = await moveFile(
        provider,
        `${dir}/src/utils.ts`,
        `${dir}/lib/utils.ts`,
        makeScope(dir),
      );

      const uniqueFiles = new Set(result.filesModified);
      expect(result.filesModified.length).toBe(uniqueFiles.size);
    });
  });
});
