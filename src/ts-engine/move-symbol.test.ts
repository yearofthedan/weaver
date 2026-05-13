import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fileExists, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "./engine.js";
import { tsMoveSymbol } from "./move-symbol.js";

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] });

function makeScope(root: string): WorkspaceScope {
  return new WorkspaceScope(root, new NodeFileSystem());
}

describe("tsMoveSymbol", () => {
  describe("symbol move to new file", () => {
    test("moves a named export to a new file and saves both files", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const tsCompiler = new TsMorphEngine();
      const scope = makeScope(dir);
      const srcPath = path.join(dir, "src/utils.ts");
      const dstPath = path.join(dir, "src/helpers.ts");

      await tsMoveSymbol(tsCompiler, srcPath, "greetUser", dstPath, scope);

      expect(readFile(dir, "src/helpers.ts")).toContain("export function greetUser");
      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
      expect(scope.modified).toContain(srcPath);
      expect(scope.modified).toContain(dstPath);
    });

    test("updates the import in the importing file with .js extension", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        makeScope(dir),
      );

      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain('"./helpers.js"');
      expect(mainContent).not.toContain('"./utils"');
    });
  });

  describe("symbol move to existing file", () => {
    test("moves a function to an existing file, preserving existing content", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        makeScope(dir),
      );
      const destContent = readFile(dir, "src/helpers.ts");
      expect(destContent).toContain("helper");
      expect(destContent).toContain("greetUser");
    });

    test("appends to a non-empty destination file with a blank-line separator", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        makeScope(dir),
      );
      const content = readFile(dir, "src/helpers.ts");
      expect(content).toMatch(/helper[\s\S]*\n\nexport function greetUser/);
      expect(content.startsWith("export function helper")).toBe(true);
    });
  });

  describe("boundary skipping", () => {
    test("records importer outside the workspace boundary as skipped, not modified", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/utils.ts": "export function add(a: number, b: number): number { return a + b; }\n",
        "lib/consumer.ts": 'import { add } from "../src/utils";\nexport const r = add(1, 2);\n',
      });
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
      expect(readFile(dir, "lib/consumer.ts")).toContain("../src/utils");
    });

    test("skipped includes dirty source file outside the workspace root", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "lib/utils.ts": "export function add(a: number, b: number): number { return a + b; }\n",
      });
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
      expect(readFile(dir, "lib/utils.ts")).toContain("add");
    });
  });

  describe("directory creation", () => {
    test("creates the destination directory when it does not exist", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const dstPath = path.join(dir, "src/nested/deep/helpers.ts");

      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/utils.ts"),
        "greetUser",
        dstPath,
        makeScope(dir),
      );

      expect(fileExists(dir, "src/nested/deep/helpers.ts")).toBe(true);
      expect(readFile(dir, "src/nested/deep/helpers.ts")).toContain("greetUser");
    });
  });

  describe("const variable move", () => {
    test("moves an exported const variable (VariableDeclaration to VariableStatement traversal)", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const scope = makeScope(dir);
      fs.appendFileSync(path.join(dir, "src/utils.ts"), "\nexport const VERSION = '1.0.0';\n");
      fs.writeFileSync(
        path.join(dir, "src/consumer.ts"),
        'import { VERSION } from "./utils";\nexport const v = VERSION;\n',
      );
      await tsMoveSymbol(
        new TsMorphEngine(),
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
    test("does not add a self-import in dest file when dest already had a self-referencing import from source", async ({
      dir,
      seedNamedFixture,
    }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const scope = makeScope(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'import { greetUser } from "./utils";\nexport function helper(): void { greetUser("x"); }\n',
      );
      await tsMoveSymbol(
        new TsMorphEngine(),
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
    test("only records files actually changed by the move", async ({ dir, seedNamedFixture }) => {
      await seedNamedFixture(FIXTURES.simpleTs.name);
      const scope = makeScope(dir);
      const extraPath = path.join(dir, "src/unrelated.ts");
      fs.writeFileSync(extraPath, "export const UNRELATED = 42;\n");

      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/utils.ts"),
        "greetUser",
        path.join(dir, "src/helpers.ts"),
        scope,
      );

      expect(scope.modified).not.toContain(extraPath);
    });
  });

  describe("source self-import after move", () => {
    test("adds an import back to source when remaining code references the moved symbol", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/a.ts":
          "export function Foo(): string { return 'foo'; }\nexport function Bar(): string { return Foo(); }\n",
        "src/dest.ts": "",
      });
      const srcPath = path.join(dir, "src/a.ts");
      const dstPath = path.join(dir, "src/dest.ts");
      const scope = makeScope(dir);

      await tsMoveSymbol(new TsMorphEngine(), srcPath, "Foo", dstPath, scope);

      const srcContent = readFile(dir, "src/a.ts");
      expect(srcContent).toContain("import { Foo }");
      expect(srcContent).toContain('"./dest.js"');
      expect(srcContent).toContain("export function Bar");
      expect(srcContent).not.toContain("export function Foo");
      expect(scope.modified).toContain(srcPath);
    });
  });

  describe("transitive import carry", () => {
    test("carries a named import the moved declaration depends on to the destination", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/types.ts": "export type Bar = { value: string };\n",
        "src/source.ts":
          'import { Bar } from "./types";\nexport function Foo(b: Bar): string { return b.value; }\n',
        "src/dest.ts": "",
      });
      const scope = makeScope(dir);

      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "src/dest.ts"),
        scope,
      );

      const destContent = readFile(dir, "src/dest.ts");
      expect(destContent).toContain("import { Bar }");
      expect(destContent).toContain('"./types.js"');
      expect(destContent).toContain("export function Foo");
    });
  });

  describe("non-exported conflict detection", () => {
    test("throws SYMBOL_EXISTS when destination has a non-exported declaration with the same name", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/source.ts": "export function Foo(): void {}\n",
        "src/dest.ts": "function Foo(): void {}\nexport function other(): void {}\n",
      });
      const scope = makeScope(dir);

      await expect(
        tsMoveSymbol(
          new TsMorphEngine(),
          path.join(dir, "src/source.ts"),
          "Foo",
          path.join(dir, "src/dest.ts"),
          scope,
        ),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    test("replaces the non-exported declaration when force is true", async ({
      dir,
      seedInlineFixture,
    }) => {
      await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/source.ts": "export function Foo(): string { return 'new'; }\n",
        "src/dest.ts":
          "function Foo(): string { return 'old'; }\nexport function other(): void {}\n",
      });
      const scope = makeScope(dir);

      await tsMoveSymbol(
        new TsMorphEngine(),
        path.join(dir, "src/source.ts"),
        "Foo",
        path.join(dir, "src/dest.ts"),
        scope,
        { force: true },
      );

      const destContent = readFile(dir, "src/dest.ts");
      expect(destContent).toContain("export function Foo");
      expect(destContent).toContain("return 'new'");
      expect(destContent).not.toContain("return 'old'");
      const fooMatches = destContent.match(/function Foo/g) ?? [];
      expect(fooMatches).toHaveLength(1);
    });
  });
});
