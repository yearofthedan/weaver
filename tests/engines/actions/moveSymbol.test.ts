import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveSymbol } from "../../../src/operations/moveSymbol.js";
import { TsProvider } from "../../../src/providers/ts.js";
import { VolarProvider } from "../../../src/providers/volar.js";
import { cleanup, copyFixture, readFile } from "../../helpers.js";

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
