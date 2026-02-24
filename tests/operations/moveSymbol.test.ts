import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveSymbol } from "../../src/operations/moveSymbol.js";
import { TsProvider } from "../../src/providers/ts.js";
import { VolarProvider } from "../../src/providers/volar.js";
import { cleanup, copyFixture, readFile } from "../helpers.js";

describe("moveSymbol action", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(cleanup));

  describe("with TsProvider (TS project)", () => {
    it("moves a function to a new file", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      const srcPath = `${dir}/src/utils.ts`;
      const dstPath = `${dir}/src/helpers.ts`;

      const result = await moveSymbol(tsProvider, tsProvider, srcPath, "greetUser", dstPath, dir);

      expect(result.symbolName).toBe("greetUser");
      expect(result.sourceFile).toBe(srcPath);
      expect(result.destFile).toBe(dstPath);
      expect(readFile(dir, "src/helpers.ts")).toContain("greetUser");
      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    });

    it("moves a function to an existing file", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      const tsProvider = new TsProvider();

      await moveSymbol(
        tsProvider,
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
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );

      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain('"./helpers.js"');
      expect(mainContent).not.toContain('"./utils"');
      expect(mainContent).not.toContain('"./helpers"');
    });

    it("merges with an existing dest import when importer already imports from dest", async () => {
      const dir = copyFixture("multi-importer");
      dirs.push(dir);
      const dstPath = `${dir}/src/shared.ts`;
      fs.writeFileSync(dstPath, "export const PI = 3.14;\n");
      const featureAPath = path.join(dir, "src/featureA.ts");
      const originalA = fs.readFileSync(featureAPath, "utf8");
      fs.writeFileSync(featureAPath, `import { PI } from "./shared";\n${originalA}`);

      const tsProvider = new TsProvider();
      await moveSymbol(tsProvider, tsProvider, `${dir}/src/utils.ts`, "add", dstPath, dir);

      const featureAContent = readFile(dir, "src/featureA.ts");
      const importMatches = featureAContent.match(
        /import\s*\{[^}]+\}\s*from\s*["']\.\/shared["']/g,
      );
      expect(importMatches).toHaveLength(1);
      expect(importMatches?.[0]).toContain("PI");
      expect(importMatches?.[0]).toContain("add");
    });

    it("symbol is absent from source file after move", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );

      expect(readFile(dir, "src/utils.ts")).not.toContain("greetUser");
    });

    it("throws SYMBOL_NOT_FOUND for an unknown symbol", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      try {
        await moveSymbol(
          tsProvider,
          tsProvider,
          `${dir}/src/utils.ts`,
          "doesNotExist",
          `${dir}/src/helpers.ts`,
          dir,
        );
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("SYMBOL_NOT_FOUND");
      }
    });

    it("throws FILE_NOT_FOUND for a missing source file", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      try {
        await moveSymbol(
          tsProvider,
          tsProvider,
          `${dir}/src/doesNotExist.ts`,
          "greetUser",
          `${dir}/src/helpers.ts`,
          dir,
        );
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("FILE_NOT_FOUND");
      }
    });

    it("throws NOT_SUPPORTED for a symbol re-exported via 'export { }'", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      // localFn is declared without 'export'; re-exported via export { }.
      // declarationText is "const localFn = (): number => 42;" — no 'export' prefix.
      fs.writeFileSync(
        path.join(dir, "src/reexport.ts"),
        "const localFn = (): number => 42;\nexport { localFn };\n",
      );
      const tsProvider = new TsProvider();

      try {
        await moveSymbol(
          tsProvider,
          tsProvider,
          `${dir}/src/reexport.ts`,
          "localFn",
          `${dir}/src/helpers.ts`,
          dir,
        );
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as { code?: string }).code).toBe("NOT_SUPPORTED");
      }
    });

    it("creates the destination directory when it does not exist", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();
      const dstPath = path.join(dir, "src/nested/deep/helpers.ts");

      await moveSymbol(tsProvider, tsProvider, `${dir}/src/utils.ts`, "greetUser", dstPath, dir);

      expect(fs.existsSync(dstPath)).toBe(true);
      expect(fs.readFileSync(dstPath, "utf8")).toContain("greetUser");
    });

    it("filesModified includes both the source file and the destination file", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      const result = await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );

      expect(result.filesModified).toContain(`${dir}/src/utils.ts`);
      expect(result.filesModified).toContain(`${dir}/src/helpers.ts`);
    });

    it("updates all importers when multiple files import the moved symbol", async () => {
      const dir = copyFixture("multi-importer");
      dirs.push(dir);
      const tsProvider = new TsProvider();

      const result = await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "add",
        `${dir}/src/helpers.ts`,
        dir,
      );

      // Both importers get updated
      const featureA = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
      const featureB = fs.readFileSync(path.join(dir, "src/featureB.ts"), "utf8");
      expect(featureA).not.toContain('"./utils"');
      expect(featureA).toContain('"./helpers.js"');
      expect(featureB).not.toContain('"./utils"');
      expect(featureB).toContain('"./helpers.js"');
      expect(result.filesModified).toContain(`${dir}/src/featureA.ts`);
      expect(result.filesModified).toContain(`${dir}/src/featureB.ts`);
    });

    it("removes only the moved specifier when an importer has multiple named imports from the source", async () => {
      const dir = copyFixture("multi-importer");
      dirs.push(dir);
      // Give utils.ts a second export so featureA can import two symbols from it
      fs.appendFileSync(
        path.join(dir, "src/utils.ts"),
        "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
      );
      fs.writeFileSync(
        path.join(dir, "src/featureA.ts"),
        'import { add, multiply } from "./utils";\nexport const result = add(1, 2) + multiply(3, 4);\n',
      );
      const tsProvider = new TsProvider();

      await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "add",
        `${dir}/src/helpers.ts`,
        dir,
      );

      const content = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
      // 'add' removed from utils import; new helpers import added
      expect(content).not.toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\/utils/);
      expect(content).toMatch(/import\s*\{[^}]*multiply[^}]*\}\s*from\s*["']\.\/utils/);
      expect(content).toMatch(/import\s*\{[^}]*add[^}]*\}\s*from\s*["']\.\/helpers\.js/);
    });

    it("appends to a non-empty destination file with a blank-line separator", async () => {
      const dir = copyFixture("simple-ts");
      dirs.push(dir);
      fs.writeFileSync(
        path.join(dir, "src/helpers.ts"),
        'export function helper(): string { return "hi"; }\n',
      );
      const tsProvider = new TsProvider();

      await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "greetUser",
        `${dir}/src/helpers.ts`,
        dir,
      );

      const content = fs.readFileSync(path.join(dir, "src/helpers.ts"), "utf8");
      expect(content).toContain("helper");
      expect(content).toContain("greetUser");
      // Exactly two newlines between existing content and appended declaration
      expect(content).toMatch(/helper[\s\S]*\n\nexport function greetUser/);
    });

    it("merges moved symbol into an existing dest import when importer has multiple named imports from source", async () => {
      const dir = copyFixture("multi-importer");
      dirs.push(dir);
      // Give utils.ts a second export
      fs.appendFileSync(
        path.join(dir, "src/utils.ts"),
        "\nexport function multiply(a: number, b: number): number { return a * b; }\n",
      );
      // helpers.ts already exists with its own export
      fs.writeFileSync(path.join(dir, "src/helpers.ts"), "export const PI = 3.14;\n");
      // featureA imports two symbols from utils AND already imports from helpers
      fs.writeFileSync(
        path.join(dir, "src/featureA.ts"),
        'import { add, multiply } from "./utils";\nimport { PI } from "./helpers";\nexport const r = add(1, 2) + multiply(3, 4) + PI;\n',
      );
      const tsProvider = new TsProvider();

      await moveSymbol(
        tsProvider,
        tsProvider,
        `${dir}/src/utils.ts`,
        "add",
        `${dir}/src/helpers.ts`,
        dir,
      );

      const content = fs.readFileSync(path.join(dir, "src/featureA.ts"), "utf8");
      // A single import from helpers containing both PI and add (merged, not duplicated)
      const helperImports = content.match(/import\s*\{[^}]+\}\s*from\s*["']\.\/helpers/g);
      expect(helperImports).toHaveLength(1);
      expect(helperImports?.[0]).toContain("PI");
      expect(helperImports?.[0]).toContain("add");
      // multiply stays in the utils import
      expect(content).toMatch(/import\s*\{[^}]*multiply[^}]*\}\s*from\s*["']\.\/utils/);
    });

    it("filesSkipped includes importers outside the workspace boundary", async () => {
      // Exercises the `!isWithinWorkspace(filePath, workspace)` branch in the importer loop.
      // The ts-morph project includes both src/ and lib/ but the workspace is only src/.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ns-movesymbol-boundary-"));
      dirs.push(tmpDir);

      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });

      // tsconfig includes all TS files so lib/consumer.ts is in the project
      fs.writeFileSync(
        path.join(tmpDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts"] }),
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/utils.ts"),
        "export function add(a: number, b: number): number { return a + b; }\n",
      );
      // Importer is in the project (tsconfig includes **/*.ts) but OUTSIDE workspace (src/)
      fs.writeFileSync(
        path.join(tmpDir, "lib/consumer.ts"),
        'import { add } from "../src/utils";\nexport const result = add(1, 2);\n',
      );

      const tsProvider = new TsProvider();
      const result = await moveSymbol(
        tsProvider,
        tsProvider,
        path.join(tmpDir, "src/utils.ts"),
        "add",
        path.join(tmpDir, "src/helpers.ts"),
        path.join(tmpDir, "src"), // workspace = src/ only; lib/ is out-of-bounds
      );

      expect(result.filesSkipped.some((f) => f.includes("consumer.ts"))).toBe(true);
      // The out-of-workspace importer must not be rewritten on disk
      const consumerContent = fs.readFileSync(path.join(tmpDir, "lib/consumer.ts"), "utf8");
      expect(consumerContent).toContain("../src/utils");
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

      const result = await moveSymbol(
        tsProvider,
        volarProvider,
        srcPath,
        "useCounter",
        dstPath,
        dir,
      );

      expect(result.symbolName).toBe("useCounter");
      expect(result.sourceFile).toBe(srcPath);
      expect(result.destFile).toBe(dstPath);

      // Symbol moved to dest
      expect(readFile(dir, "src/shared.ts")).toContain("useCounter");
      expect(readFile(dir, "src/composables/useCounter.ts")).not.toContain("useCounter");

      // main.ts (TS importer) updated by ts-morph AST surgery
      const mainContent = readFile(dir, "src/main.ts");
      expect(mainContent).toContain('"./shared.js"');
      expect(mainContent).not.toContain("composables/useCounter");

      // App.vue (SFC importer) updated by VolarProvider.afterSymbolMove
      const vueContent = readFile(dir, "src/App.vue");
      expect(vueContent).toContain("./shared.js");
      expect(vueContent).not.toContain("composables/useCounter");

      expect(result.filesModified).toContain(dstPath);
    }, 30_000);
  });
});
