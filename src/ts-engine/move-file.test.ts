import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsMoveFile } from "./move-file.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

function makeGitRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "tests", "helpers"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
  );
  fs.writeFileSync(path.join(dir, "src", "utils.ts"), "export function greet() { return 'hi'; }\n");
  fs.writeFileSync(
    path.join(dir, "tests", "helpers", "mock.ts"),
    "export function makeMock() { return {}; }\n",
  );
  fs.writeFileSync(
    path.join(dir, "tests", "consumer.test.ts"),
    'import { makeMock } from "./helpers/mock";\nconsole.log(makeMock());\n',
  );

  const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  execSync("git init", { cwd: dir, env: gitEnv, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, env: gitEnv, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, env: gitEnv, stdio: "pipe" });
  execSync("git add .", { cwd: dir, env: gitEnv, stdio: "pipe" });
  execSync("git commit -m init", { cwd: dir, env: gitEnv, stdio: "pipe" });
}

describe("tsMoveFile - TsMorphEngine integration", () => {
  describe("stale project cache (file added after project load)", () => {
    test("rewrites import in a file created after the project was loaded", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const engine = new TsMorphEngine();
      await engine.getEditsForFileRename(`${dir}/src/utils.ts`, `${dir}/src/utils2.ts`);

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
    test("rewrites imports when tsMoveFile is called with a symlinked workspace path", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const symlinkDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-symlink-"));
      const symlink = path.join(symlinkDir, "project");
      fs.symlinkSync(dir, symlink, "dir");

      const oldPath = `${symlink}/src/utils.ts`;
      const newPath = `${symlink}/lib/utils.ts`;
      const scope = makeScope(symlink);

      await tsMoveFile(new TsMorphEngine(), oldPath, newPath, scope);

      // onCleanup only handles `dir`; remove the symlink container manually
      fs.rmSync(symlinkDir, { recursive: true, force: true });

      expect(fs.existsSync(path.join(dir, "lib", "utils.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "src", "utils.ts"))).toBe(false);

      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain("../lib/utils");
      expect(mainContent).not.toContain('"./utils"');

      expect(scope.modified.some((f) => f.endsWith("src/main.ts"))).toBe(true);
    });
  });

  describe("sequential moves (project graph survives across calls)", () => {
    test("does not throw ENOENT when moving a file that imports a previously-moved file", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const helperOldPath = path.join(dir, "tests", "helper.ts");
      const helperNewPath = path.join(dir, "lib", "helper.ts");
      const consumerPath = path.join(dir, "tests", "consumer.ts");

      fs.writeFileSync(helperOldPath, "export function help() { return 42; }\n");
      fs.writeFileSync(consumerPath, 'import { help } from "./helper";\nconsole.log(help());\n');

      const engine = new TsMorphEngine();
      await engine.getEditsForFileRename(helperOldPath, helperNewPath);

      fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
      fs.renameSync(helperOldPath, helperNewPath);

      await expect(
        engine.getEditsForFileRename(consumerPath, path.join(dir, "lib", "consumer.ts")),
      ).resolves.not.toThrow();
    });
  });

  describe("sequential moves in git-tracked directories", () => {
    test("does not throw ENOENT when git ls-files returns a file deleted by a prior move", async ({
      dir,
    }) => {
      makeGitRepo(dir);
      const gitEngine = new TsMorphEngine();

      const scope1 = makeScope(dir);
      await tsMoveFile(
        gitEngine,
        path.join(dir, "tests", "helpers", "mock.ts"),
        path.join(dir, "src", "helpers", "mock.ts"),
        scope1,
      );
      expect(scope1.modified).toContain(path.join(dir, "src", "helpers", "mock.ts"));

      const scope2 = makeScope(dir);
      await tsMoveFile(
        gitEngine,
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
});
