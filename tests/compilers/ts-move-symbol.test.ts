import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../src/compilers/ts.js";
import { tsMoveSymbol } from "../../src/compilers/ts-move-symbol.js";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeTsConfig(dir: string, include: string[] = ["**/*.ts"]): void {
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include }),
  );
}

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

function setupSimpleTs(): { dir: string; tsProvider: TsProvider; scope: WorkspaceScope } {
  const dir = copyFixture("simple-ts");
  return { dir, tsProvider: new TsProvider(), scope: makeScope(dir) };
}

describe("tsMoveSymbol", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("symbol move to new file", () => {
    it("moves a named export to a new file and saves both files", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      const srcPath = path.join(dir, "src/utils.ts");
      const dstPath = path.join(dir, "src/helpers.ts");

      await tsMoveSymbol(tsProvider, srcPath, "greetUser", dstPath, scope);

      expect(fs.readFileSync(dstPath, "utf8")).toContain("export function greetUser");
      expect(fs.readFileSync(srcPath, "utf8")).not.toContain("greetUser");
      expect(scope.modified).toContain(srcPath);
      expect(scope.modified).toContain(dstPath);
    });

    it("updates the import in the importing file with .js extension", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);

      await tsMoveSymbol(
        tsProvider,
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain('"./helpers.js"');
      expect(mainContent).not.toContain('"./utils"');
    });

    it("filesModified includes both source and destination files", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      const srcPath = path.join(dir, "src/utils.ts");
      const dstPath = path.join(dir, "src/helpers.ts");

      await tsMoveSymbol(tsProvider, srcPath, "greetUser", dstPath, scope);

      expect(scope.modified).toContain(srcPath);
      expect(scope.modified).toContain(dstPath);
    });
  });

  describe("symbol move to existing file", () => {
    it("moves a function to an existing file, preserving existing content", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await tsMoveSymbol(
        tsProvider,
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );
      const destContent = readFile(dir, "src/helpers.ts");
      expect(destContent).toContain("helper");
      expect(destContent).toContain("greetUser");
    });

    it("appends to a non-empty destination file with a blank-line separator", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await tsMoveSymbol(
        tsProvider,
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );
      const content = fs.readFileSync(path.join(dir, "src/helpers.ts"), "utf8");
      expect(content).toMatch(/helper[\s\S]*\n\nexport function greetUser/);
      expect(content.startsWith("export function helper")).toBe(true);
    });
  });

  describe("boundary skipping", () => {
    it("records importer outside the workspace boundary as skipped, not modified", async () => {
      const tmpDir = makeTmpDir("ts-movesym-boundary-");
      dirs.push(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
      writeTsConfig(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "src/utils.ts"),
        "export function add(a: number, b: number): number { return a + b; }\n",
      );
      fs.writeFileSync(
        path.join(tmpDir, "lib/consumer.ts"),
        'import { add } from "../src/utils";\nexport const r = add(1, 2);\n',
      );
      const scope = makeScope(path.join(tmpDir, "src"));
      const p = new TsProvider();

      await tsMoveSymbol(
        p,
        path.join(tmpDir, "src/utils.ts"),
        "add",
        path.join(tmpDir, "src/helpers.ts"),
        scope,
      );

      expect(scope.skipped.some((f) => f.includes("consumer.ts"))).toBe(true);
      expect(scope.modified.some((f) => f.includes("consumer.ts"))).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, "lib/consumer.ts"), "utf8")).toContain(
        "../src/utils",
      );
    });

    it("skipped includes dirty source file outside the workspace root", async () => {
      const tmpDir = makeTmpDir("ts-movesym-dirtysrc-");
      dirs.push(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
      writeTsConfig(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "lib/utils.ts"),
        "export function add(a: number, b: number): number { return a + b; }\n",
      );
      const scope = makeScope(path.join(tmpDir, "src"));
      const p = new TsProvider();

      await tsMoveSymbol(
        p,
        path.join(tmpDir, "lib/utils.ts"),
        "add",
        path.join(tmpDir, "src/helpers.ts"),
        scope,
      );

      expect(scope.skipped.some((f) => f.includes("lib/utils.ts"))).toBe(true);
      expect(scope.modified.some((f) => f.includes("src/helpers.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "lib/utils.ts"), "utf8")).toContain("add");
    });
  });

  describe("directory creation", () => {
    it("creates the destination directory when it does not exist", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      const dstPath = path.join(dir, "src/nested/deep/helpers.ts");

      await tsMoveSymbol(tsProvider, path.join(dir, "src/utils.ts"), "greetUser", dstPath, scope);

      expect(fs.existsSync(dstPath)).toBe(true);
      expect(fs.readFileSync(dstPath, "utf8")).toContain("greetUser");
    });
  });

  describe("const variable move", () => {
    it("moves an exported const variable (VariableDeclaration to VariableStatement traversal)", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.appendFileSync(path.join(dir, "src/utils.ts"), "\nexport const VERSION = '1.0.0';\n");
      fs.writeFileSync(
        path.join(dir, "src/consumer.ts"),
        'import { VERSION } from "./utils";\nexport const v = VERSION;\n',
      );
      await tsMoveSymbol(
        tsProvider,
        path.join(dir, "src/utils.ts"),
        "VERSION",
        path.join(dir, "src/constants.ts"),
        scope,
      );
      expect(readFile(dir, "src/constants.ts")).toContain("export const VERSION");
      expect(readFile(dir, "src/utils.ts")).not.toContain("VERSION");
      expect(readFile(dir, "src/consumer.ts")).toContain('"./constants.js"');
      expect(scope.modified).toContain(path.join(dir, "src/consumer.ts"));
    });
  });

  describe("dest file self-import removal", () => {
    it("does not add a self-import in dest file when dest already had a self-referencing import from source", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'import { greetUser } from "./utils";\nexport function helper(): void { greetUser("x"); }\n',
      );
      await tsMoveSymbol(
        tsProvider,
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );
      const helperContent = readFile(dir, "src/helpers.ts");
      expect(helperContent).not.toContain('"./helpers.js"');
      expect(helperContent).toContain("export function greetUser");
    });
  });

  describe("does not add unrelated saved files to modified", () => {
    it("only records files actually changed by the move", async () => {
      const { dir, tsProvider, scope } = setupSimpleTs();
      dirs.push(dir);
      const extraPath = path.join(dir, "src/unrelated.ts");
      fs.writeFileSync(extraPath, "export const UNRELATED = 42;\n");

      await tsMoveSymbol(
        tsProvider,
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      expect(scope.modified).not.toContain(extraPath);
    });
  });
});
