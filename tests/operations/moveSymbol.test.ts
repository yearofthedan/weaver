import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceScope } from "../../src/domain/workspace-scope.js";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { VolarProvider } from "../../src/plugins/vue/provider.js";
import { NodeFileSystem } from "../../src/ports/node-filesystem.js";
import { TsProvider } from "../../src/providers/ts.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";
import {
  makeTmpDir,
  moveGreetUser,
  moveWithTs,
  setupConflictScenario,
  setupMultiImporter,
  setupSimpleTs,
  writeTsConfig,
} from "./moveSymbol-helpers.js";

describe("moveSymbol action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("with TsProvider (TS project)", () => {
    it("moves a function to a new file", async () => {
      const { result, dir } = await moveGreetUser(dirs);
      expect(result.symbolName).toBe("greetUser");
      expect(result.sourceFile).toBe(`${dir}/src/utils.ts`);
      expect(result.destFile).toBe(`${dir}/src/helpers.ts`);
      expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    });

    it("moves a function to an existing file", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await moveWithTs(
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );
      const destContent = readFile(dir, "src/helpers.ts");
      expect(destContent).toContain("helper");
      expect(destContent).toContain("greetUser");
    });

    it("updates the import in the importing file with .js extension", async () => {
      const { dir } = await moveGreetUser(dirs);
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain('"./helpers.js"');
      expect(mainContent).not.toContain('"./utils"');
    });

    it("merges with an existing dest import when importer already imports from dest", async () => {
      const { dir, tsProvider } = setupMultiImporter();
      dirs.push(dir);
      const dstPath = `${dir}/src/shared.ts`;
      fs.writeFileSync(dstPath, "export const PI = 3.14;\n");
      const featureAPath = path.join(dir, "src/featureA.ts");
      fs.writeFileSync(
        featureAPath,
        `import { PI } from "./shared";\n${fs.readFileSync(featureAPath, "utf8")}`,
      );
      await moveWithTs(tsProvider, `${dir}/src/utils.ts`, "add", dstPath, dir);
      const importMatches = readFile(dir, "src/featureA.ts").match(
        /import\s*\{[^}]+\}\s*from\s*["']\.\/shared["']/g,
      );
      expect(importMatches).toHaveLength(1);
      expect(importMatches?.[0]).toContain("PI");
      expect(importMatches?.[0]).toContain("add");
    });

    it("throws SYMBOL_NOT_FOUND for an unknown symbol", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      await expect(
        moveWithTs(tsProvider, `${dir}/src/utils.ts`, "doesNotExist", `${dir}/src/helpers.ts`, dir),
      ).rejects.toMatchObject({ code: "SYMBOL_NOT_FOUND" });
    });

    it("throws FILE_NOT_FOUND for a missing source file", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      await expect(
        moveWithTs(
          tsProvider,
          `${dir}/src/doesNotExist.ts`,
          "greetUser",
          `${dir}/src/helpers.ts`,
          dir,
        ),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    it("throws NOT_SUPPORTED for a symbol re-exported via 'export { }'", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/reexport.ts"),
        "const localFn = (): number => 42;\nexport { localFn };\n",
      );
      await expect(
        moveWithTs(tsProvider, `${dir}/src/reexport.ts`, "localFn", `${dir}/src/helpers.ts`, dir),
      ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    });

    it("creates the destination directory when it does not exist", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      const dstPath = path.join(dir, "src/nested/deep/helpers.ts");
      await moveWithTs(tsProvider, `${dir}/src/utils.ts`, "greetUser", dstPath, dir);
      expect(fs.existsSync(dstPath)).toBe(true);
      expect(fs.readFileSync(dstPath, "utf8")).toContain("greetUser");
    });

    it("filesModified includes both the source file and the destination file", async () => {
      const { result, dir } = await moveGreetUser(dirs);
      expect(result.filesModified).toContain(`${dir}/src/utils.ts`);
      expect(result.filesModified).toContain(`${dir}/src/helpers.ts`);
    });

    it("updates all importers when multiple files import the moved symbol", async () => {
      const { dir, tsProvider } = setupMultiImporter();
      dirs.push(dir);
      const result = await moveWithTs(
        tsProvider,
        `${dir}/src/utils.ts`,
        "add",
        `${dir}/src/helpers.ts`,
        dir,
      );
      const featureA = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
      const featureB = fs.readFileSync(path.join(dir, "src/featureB.ts"), "utf8");
      expect(featureA).toContain('"./helpers.js"');
      expect(featureB).toContain('"./helpers.js"');
      expect(result.filesModified).toContain(`${dir}/src/featureA.ts`);
      expect(result.filesModified).toContain(`${dir}/src/featureB.ts`);
    });

    it("removes only the moved specifier when an importer has multiple named imports from the source", async () => {
      const { dir, tsProvider } = setupMultiImporter();
      dirs.push(dir);
      fs.appendFileSync(
        path.join(dir, "src/utils.ts"),
        "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
      );
      fs.writeFileSync(
        path.join(dir, "src/featureA.ts"),
        'import { add, multiply } from "./utils";\nexport const result = add(1, 2) + multiply(3, 4);\n',
      );
      await moveWithTs(tsProvider, `${dir}/src/utils.ts`, "add", `${dir}/src/helpers.ts`, dir);
      const content = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
      expect(content).not.toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\/utils/);
      expect(content).toMatch(/import\s*\{[^}]*multiply[^}]*\}\s*from\s*["']\.\/utils/);
      expect(content).toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\/helpers\.js/);
    });

    it("moves an exported const variable (exercises VariableDeclaration → VariableStatement traversal)", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      fs.appendFileSync(path.join(dir, "src/utils.ts"), "\nexport const VERSION = '1.0.0';\n");
      fs.writeFileSync(
        path.join(dir, "src/consumer.ts"),
        'import { VERSION } from "./utils";\nexport const v = VERSION;\n',
      );
      const result = await moveWithTs(
        tsProvider,
        `${dir}/src/utils.ts`,
        "VERSION",
        `${dir}/src/constants.ts`,
        dir,
      );
      expect(readFile(dir, "src/constants.ts")).toContain("export const VERSION");
      expect(readFile(dir, "src/utils.ts")).not.toContain("VERSION");
      expect(readFile(dir, "src/consumer.ts")).toContain('"./constants.js"');
      expect(result.filesModified).toContain(path.join(dir, "src/consumer.ts"));
    });

    it("appends to a non-empty destination file with a blank-line separator", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      await moveWithTs(
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );
      const content = fs.readFileSync(path.join(dir, "src/helpers.ts"), "utf8");
      expect(content).toContain("helper");
      expect(content).toContain("greetUser");
      expect(content).toMatch(/helper[\s\S]*\n\nexport function greetUser/);
    });

    it("merges moved symbol into an existing dest import when importer has multiple named imports from source", async () => {
      const { dir, tsProvider } = setupMultiImporter();
      dirs.push(dir);
      fs.appendFileSync(
        path.join(dir, "src/utils.ts"),
        "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
      );
      fs.writeFileSync(path.join(dir, "src/helpers.ts"), "export const PI = 3.14;\n");
      fs.writeFileSync(
        path.join(dir, "src/featureA.ts"),
        'import { add, multiply } from "./utils";\nimport { PI } from "./helpers";\nexport const r = add(1, 2) + multiply(3, 4) + PI;\n',
      );
      await moveWithTs(tsProvider, `${dir}/src/utils.ts`, "add", `${dir}/src/helpers.ts`, dir);
      const content = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
      const helperImports = content.match(/import\s*\{[^}]+\}\s*from\s*["']\.\/helpers/g);
      expect(helperImports).toHaveLength(1);
      expect(helperImports?.[0]).toContain("PI");
      expect(helperImports?.[0]).toContain("add");
      expect(content).toMatch(/import\s*\{[^}]*multiply[^}]*\}\s*from\s*["']\.\/utils/);
    });

    it("does not modify files that import other symbols from source but not the moved symbol", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      fs.appendFileSync(
        path.join(dir, "src/utils.ts"),
        "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
      );
      fs.writeFileSync(
        path.join(dir, "src/feature.ts"),
        'import { multiply } from "./utils";\nexport const r = multiply(2, 3);\n',
      );
      await moveWithTs(
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );
      const featureContent = readFile(dir, "src/feature.ts");
      expect(featureContent).not.toContain("helpers");
      expect(featureContent).toContain('"./utils"');
    });

    it("skips updating imports in the dest file when it already imports the symbol from source", async () => {
      const { dir, tsProvider } = setupSimpleTs();
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'import { greetUser } from "./utils";\nexport function helper(): void { greetUser("x"); }\n',
      );
      const result = await moveWithTs(
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );
      expect(readFile(dir, "src/helpers.ts")).toContain("export function greetUser");
      expect(readFile(dir, "src/helpers.ts")).not.toContain('"./helpers.js"');
      expect(result.filesSkipped).toHaveLength(0);
    });

    it("filesSkipped includes dirty source file that is outside the workspace root", async () => {
      const tmpDir = makeTmpDir("ns-movesymbol-dirtysrc-");
      dirs.push(tmpDir);
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
      writeTsConfig(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "lib/utils.ts"),
        "export function add(a: number, b: number): number { return a + b; }\n",
      );
      const result = await moveWithTs(
        new TsProvider(),
        path.join(tmpDir, "lib/utils.ts"),
        "add",
        path.join(tmpDir, "src/helpers.ts"),
        path.join(tmpDir, "src"),
      );
      expect(result.filesSkipped.some((f) => f.includes("lib/utils.ts"))).toBe(true);
      expect(result.filesModified.some((f) => f.includes("src/helpers.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "lib/utils.ts"), "utf8")).toContain("add");
    });

    it("filesSkipped includes importers outside the workspace boundary", async () => {
      const tmpDir = makeTmpDir("ns-movesymbol-boundary-");
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
        'import { add } from "../src/utils";\nexport const result = add(1, 2);\n',
      );
      const result = await moveWithTs(
        new TsProvider(),
        path.join(tmpDir, "src/utils.ts"),
        "add",
        path.join(tmpDir, "src/helpers.ts"),
        path.join(tmpDir, "src"),
      );
      expect(result.filesSkipped.some((f) => f.includes("consumer.ts"))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "lib/consumer.ts"), "utf8")).toContain(
        "../src/utils",
      );
    });
  });

  describe("out-of-project importers", () => {
    it("rewrites a test file outside tsconfig.include that imports the moved symbol", async () => {
      // simple-ts has tsconfig.include = ["src/**/*.ts"], so tests/ is excluded.
      // tests/utils.test.ts imports greetUser from "../src/utils".
      // After moving greetUser to src/helpers.ts, the test file must be updated.
      const { result, dir } = await moveGreetUser(dirs);
      const testContent = fs.readFileSync(path.join(dir, "tests/utils.test.ts"), "utf8");
      // Import specifier must point at helpers.js (runtime extension)
      expect(testContent).toContain("../src/helpers.js");
      expect(testContent).not.toContain("../src/utils");
      // The test file must appear in filesModified
      expect(result.filesModified).toContain(path.join(dir, "tests/utils.test.ts"));
    });
  });

  describe("force flag — source replaces dest declaration, removes from source, rewrites importers", () => {
    let dir: string;
    let tsProvider: TsProvider;

    beforeEach(() => {
      ({ dir } = setupSimpleTs());
      dirs.push(dir);
      tsProvider = setupConflictScenario(dir);
    });

    it("source declaration replaces dest declaration when force is true and conflict exists", async () => {
      fs.writeFileSync(
        path.join(dir, "src/c.ts"),
        'import { FOO } from "./a";\nexport const x = FOO;\n',
      );
      const result = await moveWithTs(
        tsProvider,
        `${dir}/src/a.ts`,
        "FOO",
        `${dir}/src/b.ts`,
        dir,
        {
          force: true,
        },
      );
      expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).not.toContain("FOO");
      const bContent = fs.readFileSync(path.join(dir, "src/b.ts"), "utf8");
      expect(bContent).toBe("export const FOO = 1;\n");
      expect(bContent).not.toContain("FOO = 42");
      expect(fs.readFileSync(path.join(dir, "src/c.ts"), "utf8")).toContain('"./b.js"');
      expect(result.filesModified).toContain(`${dir}/src/a.ts`);
      expect(result.filesModified).toContain(`${dir}/src/b.ts`);
      expect(result.filesModified).toContain(`${dir}/src/c.ts`);
    });

    it("dest file is included in filesModified when force replaces the existing declaration", async () => {
      const result = await moveWithTs(
        tsProvider,
        `${dir}/src/a.ts`,
        "FOO",
        `${dir}/src/b.ts`,
        dir,
        {
          force: true,
        },
      );
      expect(result.filesModified).toContain(`${dir}/src/b.ts`);
      expect(fs.readFileSync(path.join(dir, "src/b.ts"), "utf8")).toContain("FOO = 1");
    });

    it("force false with conflict returns SYMBOL_EXISTS error — same as omitted", async () => {
      await expect(
        moveWithTs(tsProvider, `${dir}/src/a.ts`, "FOO", `${dir}/src/b.ts`, dir, { force: false }),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    it("source const replaces a function declaration of the same name in dest when force is true", async () => {
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export function FOO(): void {}\n");
      await moveWithTs(new TsProvider(), `${dir}/src/a.ts`, "FOO", `${dir}/src/b.ts`, dir, {
        force: true,
      });
      const bContent = fs.readFileSync(path.join(dir, "src/b.ts"), "utf8");
      expect(bContent).toContain("export const FOO = 1");
      expect(bContent).not.toContain("function FOO");
    });
  });

  describe("conflict detection when destination already exports the symbol", () => {
    let dir: string;

    beforeEach(() => {
      ({ dir } = setupSimpleTs());
      dirs.push(dir);
      fs.writeFileSync(path.join(dir, "src/b.ts"), "export const FOO = 42;\n");
      fs.writeFileSync(path.join(dir, "src/a.ts"), "export const FOO = 1;\n");
    });

    it("throws SYMBOL_EXISTS with a message naming the symbol and dest file", async () => {
      await expect(
        moveWithTs(new TsProvider(), `${dir}/src/a.ts`, "FOO", `${dir}/src/b.ts`, dir),
      ).rejects.toMatchObject({
        code: "SYMBOL_EXISTS",
        message: expect.stringMatching(/FOO/),
      });
    });

    it.each([
      ["a function", "export function FOO(): void {}"],
      ["a class", "export class FOO {}"],
    ])("throws SYMBOL_EXISTS when dest exports %s with the same name", async (_label, decl) => {
      fs.writeFileSync(path.join(dir, "src/b.ts"), `${decl}\n`);
      await expect(
        moveWithTs(new TsProvider(), `${dir}/src/a.ts`, "FOO", `${dir}/src/b.ts`, dir),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
    });

    it.each([
      ["source", path.join("src", "a.ts"), "export const FOO = 1;\n"],
      ["destination", path.join("src", "b.ts"), "export const FOO = 42;\n"],
    ] as const)("leaves the %s file unmodified when SYMBOL_EXISTS is thrown", async (_label, relPath, expectedContent) => {
      fs.writeFileSync(path.join(dir, relPath), expectedContent);
      await expect(
        moveWithTs(new TsProvider(), `${dir}/src/a.ts`, "FOO", `${dir}/src/b.ts`, dir),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
      expect(fs.readFileSync(path.join(dir, relPath), "utf8")).toBe(expectedContent);
    });

    it("does not rewrite importers when SYMBOL_EXISTS is thrown", async () => {
      const importerContent = 'import { FOO } from "./a";\nexport const x = FOO;\n';
      fs.writeFileSync(path.join(dir, "src/importer.ts"), importerContent);
      await expect(
        moveWithTs(new TsProvider(), `${dir}/src/a.ts`, "FOO", `${dir}/src/b.ts`, dir),
      ).rejects.toMatchObject({ code: "SYMBOL_EXISTS" });
      expect(fs.readFileSync(path.join(dir, "src/importer.ts"), "utf8")).toBe(importerContent);
    });

    it("proceeds when dest has a non-exported same-name declaration", async () => {
      fs.writeFileSync(path.join(dir, "src/b.ts"), "const FOO = 42;\n");
      const result = await moveWithTs(
        new TsProvider(),
        `${dir}/src/a.ts`,
        "FOO",
        `${dir}/src/b.ts`,
        dir,
      );
      expect(result.symbolName).toBe("FOO");
      expect(result.destFile).toBe(`${dir}/src/b.ts`);
      expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).not.toContain("FOO");
      const bContent = fs.readFileSync(path.join(dir, "src/b.ts"), "utf8");
      expect(bContent).toContain("export const FOO = 1");
      expect(bContent).toContain("const FOO = 42");
    });
  });

  describe("with VolarProvider (Vue project)", () => {
    it("moves a composable and updates .vue SFC imports", async () => {
      const dir = copyFixture("vue-project");
      dirs.push(dir);
      const tsProvider = new TsProvider();
      const volarProvider = new VolarProvider();
      const srcPath = `${dir}/src/composables/useCounter.ts`;
      const dstPath = `${dir}/src/shared.ts`;
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      const result = await moveSymbol(
        tsProvider,
        volarProvider,
        srcPath,
        "useCounter",
        dstPath,
        scope,
      );
      expect(result.symbolName).toBe("useCounter");
      expect(readFile(dir, "src/shared.ts")).toContain("useCounter");
      expect(readFile(dir, "src/composables/useCounter.ts")).not.toContain("useCounter");
      // main.ts (TS importer) updated by ts-morph AST surgery
      expect(readFile(dir, "src/main.ts")).toContain('"./shared.js"');
      expect(readFile(dir, "src/main.ts")).not.toContain("composables/useCounter");
      // App.vue (SFC importer) updated by VolarProvider.afterSymbolMove
      expect(readFile(dir, "src/App.vue")).toContain("./shared.js");
      expect(readFile(dir, "src/App.vue")).not.toContain("composables/useCounter");
      expect(result.filesModified).toContain(dstPath);
    }, 30_000);
  });
});
