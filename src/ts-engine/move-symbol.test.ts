import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES, readFile } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsMoveSymbol } from "./move-symbol.js";

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

function setupSimpleTs(): { dir: string; tsCompiler: TsMorphEngine; scope: WorkspaceScope } {
  const dir = copyFixture(FIXTURES.simpleTs.name);
  return { dir, tsCompiler: new TsMorphEngine(), scope: makeScope(dir) };
}

/**
 * Create a temp project with given files and a tsconfig. Returns the temp dir,
 * a fresh TsMorphEngine, and a WorkspaceScope rooted at the temp dir.
 */
function setupProject(files: Record<string, string>): {
  dir: string;
  tsCompiler: TsMorphEngine;
  scope: WorkspaceScope;
} {
  const dir = makeTmpDir("ts-movesym-");
  writeTsConfig(dir);
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }
  return { dir, tsCompiler: new TsMorphEngine(), scope: makeScope(dir) };
}

describe("tsMoveSymbol", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("symbol move to new file", () => {
    it("moves a named export to a new file and saves both files", async () => {
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      const srcPath = path.join(dir, "src/utils.ts");
      const dstPath = path.join(dir, "src/helpers.ts");

      await tsMoveSymbol(tsCompiler, srcPath, "greetUser", dstPath, scope);

      expect(fs.readFileSync(dstPath, "utf8")).toContain("export function greetUser");
      expect(fs.readFileSync(srcPath, "utf8")).not.toContain("greetUser");
      expect(scope.modified).toContain(srcPath);
      expect(scope.modified).toContain(dstPath);
    });

    it("updates the import in the importing file with .js extension", async () => {
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);

      await tsMoveSymbol(
        tsCompiler,
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
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      const srcPath = path.join(dir, "src/utils.ts");
      const dstPath = path.join(dir, "src/helpers.ts");

      await tsMoveSymbol(tsCompiler, srcPath, "greetUser", dstPath, scope);

      expect(scope.modified).toContain(srcPath);
      expect(scope.modified).toContain(dstPath);
    });
  });

  describe("symbol move to existing file", () => {
    it("moves a function to an existing file, preserving existing content", async () => {
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await tsMoveSymbol(
        tsCompiler,
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
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await tsMoveSymbol(
        tsCompiler,
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
      const {
        dir,
        tsCompiler,
        scope: _unusedScope,
      } = setupProject({
        "src/utils.ts": "export function add(a: number, b: number): number { return a + b; }\n",
        "lib/consumer.ts": 'import { add } from "../src/utils";\nexport const r = add(1, 2);\n',
      });
      dirs.push(dir);
      const scope = makeScope(path.join(dir, "src"));
      const p = new TsMorphEngine();

      await tsMoveSymbol(
        p,
        path.join(dir, "src/utils.ts"),
        "add",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      expect(scope.skipped.some((f) => f.includes("consumer.ts"))).toBe(true);
      expect(scope.modified.some((f) => f.includes("consumer.ts"))).toBe(false);
      expect(fs.readFileSync(path.join(dir, "lib/consumer.ts"), "utf8")).toContain("../src/utils");
    });

    it("skipped includes dirty source file outside the workspace root", async () => {
      const { dir, tsCompiler: _unusedCompiler } = setupProject({
        "lib/utils.ts": "export function add(a: number, b: number): number { return a + b; }\n",
      });
      dirs.push(dir);
      const scope = makeScope(path.join(dir, "src"));
      const p = new TsMorphEngine();

      await tsMoveSymbol(
        p,
        path.join(dir, "lib/utils.ts"),
        "add",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      expect(scope.skipped.some((f) => f.includes("lib/utils.ts"))).toBe(true);
      expect(scope.modified.some((f) => f.includes("src/helpers.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(dir, "lib/utils.ts"), "utf8")).toContain("add");
    });
  });

  describe("directory creation", () => {
    it("creates the destination directory when it does not exist", async () => {
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      const dstPath = path.join(dir, "src/nested/deep/helpers.ts");

      await tsMoveSymbol(tsCompiler, path.join(dir, "src/utils.ts"), "greetUser", dstPath, scope);

      expect(fs.existsSync(dstPath)).toBe(true);
      expect(fs.readFileSync(dstPath, "utf8")).toContain("greetUser");
    });
  });

  describe("const variable move", () => {
    it("moves an exported const variable (VariableDeclaration to VariableStatement traversal)", async () => {
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.appendFileSync(path.join(dir, "src/utils.ts"), "\nexport const VERSION = '1.0.0';\n");
      fs.writeFileSync(
        path.join(dir, "src/consumer.ts"),
        'import { VERSION } from "./utils";\nexport const v = VERSION;\n',
      );
      await tsMoveSymbol(
        tsCompiler,
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
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'import { greetUser } from "./utils";\nexport function helper(): void { greetUser("x"); }\n',
      );
      await tsMoveSymbol(
        tsCompiler,
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
      const { dir, tsCompiler, scope } = setupSimpleTs();
      dirs.push(dir);
      const extraPath = path.join(dir, "src/unrelated.ts");
      fs.writeFileSync(extraPath, "export const UNRELATED = 42;\n");

      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      expect(scope.modified).not.toContain(extraPath);
    });
  });

  describe("source self-import after move", () => {
    it("adds an import back to source when remaining code references the moved symbol", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/a.ts":
          [
            "export function Foo(): string { return 'foo'; }",
            "export function Bar(): string { return Foo(); }",
          ].join("\n") + "\n",
        "src/dest.ts": "",
      });
      dirs.push(dir);
      const srcPath = path.join(dir, "src/a.ts");
      const dstPath = path.join(dir, "src/dest.ts");

      await tsMoveSymbol(tsCompiler, srcPath, "Foo", dstPath, scope);

      const srcContent = fs.readFileSync(srcPath, "utf8");
      expect(srcContent).toContain("import { Foo }");
      expect(srcContent).toContain('"./dest.js"');
      expect(srcContent).toContain("export function Bar");
      expect(srcContent).not.toContain("export function Foo");
      expect(scope.modified).toContain(srcPath);
    });

    it("does not add a self-import when no remaining code references the moved symbol", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/a.ts":
          "export function Foo(): string { return 'foo'; }\nexport function Bar(): string { return 'bar'; }\n",
        "src/dest.ts": "",
      });
      dirs.push(dir);
      const srcPath = path.join(dir, "src/a.ts");
      const dstPath = path.join(dir, "src/dest.ts");

      await tsMoveSymbol(tsCompiler, srcPath, "Foo", dstPath, scope);

      const srcContent = fs.readFileSync(srcPath, "utf8");
      expect(srcContent).not.toContain("import { Foo }");
      expect(srcContent).not.toContain('"./dest.js"');
    });
  });

  describe("transitive import carry", () => {
    it("carries a named import the moved declaration depends on to the destination", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/types.ts": "export type Bar = { value: string };\n",
        "src/source.ts":
          'import { Bar } from "./types";\nexport function Foo(b: Bar): string { return b.value; }\n',
        "src/dest.ts": "",
      });
      dirs.push(dir);

      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "src/dest.ts"),
        scope,
      );

      const destContent = fs.readFileSync(path.join(dir, "src/dest.ts"), "utf8");
      expect(destContent).toContain("import { Bar }");
      expect(destContent).toContain('"./types.js"');
      expect(destContent).toContain("export function Foo");
    });

    it("adjusts the import path relative to the destination directory", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/types.ts": "export type Bar = { value: string };\n",
        "src/source.ts":
          'import { Bar } from "./types";\nexport function Foo(b: Bar): string { return b.value; }\n',
        "lib/dest.ts": "",
      });
      dirs.push(dir);

      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "lib/dest.ts"),
        scope,
      );

      const destContent = fs.readFileSync(path.join(dir, "lib/dest.ts"), "utf8");
      expect(destContent).toContain("import { Bar }");
      expect(destContent).toContain('"../src/types.js"');
    });

    it("does not duplicate a transitive import already present in destination", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/types.ts": "export type Bar = { value: string };\n",
        "src/source.ts":
          'import { Bar } from "./types";\nexport function Foo(b: Bar): string { return b.value; }\n',
        "src/dest.ts": 'import { Bar } from "./types";\nexport function existing(): void {}\n',
      });
      dirs.push(dir);

      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "src/dest.ts"),
        scope,
      );

      const destContent = fs.readFileSync(path.join(dir, "src/dest.ts"), "utf8");
      const importMatches = destContent.match(/import \{ Bar \}/g) ?? [];
      expect(importMatches).toHaveLength(1);
      expect(destContent).toContain("export function Foo");
    });

    it("does not carry imports for names defined locally in the source file", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/source.ts":
          [
            "type LocalType = { value: string };",
            "export function Foo(b: LocalType): string { return b.value; }",
          ].join("\n") + "\n",
        "src/dest.ts": "",
      });
      dirs.push(dir);

      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "src/dest.ts"),
        scope,
      );

      const destContent = fs.readFileSync(path.join(dir, "src/dest.ts"), "utf8");
      expect(destContent).not.toContain("import {");
      expect(destContent).toContain("export function Foo");
    });
  });

  describe("non-exported conflict detection", () => {
    it("throws SYMBOL_EXISTS when destination has a non-exported declaration with the same name", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/source.ts": "export function Foo(): void {}\n",
        "src/dest.ts": "function Foo(): void {}\nexport function other(): void {}\n",
      });
      dirs.push(dir);

      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/source.ts"),
          "Foo",
          path.join(dir, "src/dest.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    it("replaces the non-exported declaration when force is true", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/source.ts": "export function Foo(): string { return 'new'; }\n",
        "src/dest.ts":
          "function Foo(): string { return 'old'; }\nexport function other(): void {}\n",
      });
      dirs.push(dir);

      await tsMoveSymbol(
        tsCompiler,
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "src/dest.ts"),
        scope,
        { force: true },
      );

      const destContent = fs.readFileSync(path.join(dir, "src/dest.ts"), "utf8");
      expect(destContent).toContain("export function Foo");
      expect(destContent).toContain("return 'new'");
      expect(destContent).not.toContain("return 'old'");
      const fooMatches = destContent.match(/function Foo/g) ?? [];
      expect(fooMatches).toHaveLength(1);
    });

    it("detects non-exported const variable conflicts", async () => {
      const { dir, tsCompiler, scope } = setupProject({
        "src/source.ts": "export const Foo = 'new';\n",
        "src/dest.ts": "const Foo = 'old';\nexport const other = 1;\n",
      });
      dirs.push(dir);

      await expect(
        tsMoveSymbol(
          tsCompiler,
          path.join(dir, "src/source.ts"),
          "Foo",
          path.join(dir, "src/dest.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });
  });
});
