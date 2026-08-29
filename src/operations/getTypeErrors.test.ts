import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { getTypeErrors } from "./getTypeErrors.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("getTypeErrors operation", () => {
  describe("single file mode (file param provided)", () => {
    test("returns type errors with correct shape for a file with errors", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      expect(result.errorCount).toBe(3);
      expect(result.diagnostics).toHaveLength(3);
      expect(result.truncated).toBe(false);

      for (const diag of result.diagnostics) {
        expect(diag.file).toBe(`${dir}/src/broken.ts`);
        expect(diag.line).toBeGreaterThan(0);
        expect(diag.col).toBeGreaterThan(0);
        expect(diag.code).toBeGreaterThan(0);
        expect(typeof diag.code).toBe("number");
        expect(diag.message.length).toBeGreaterThan(0);
      }
    });

    test("pins the exact error codes, positions and messages for broken.ts", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      const diags = result.diagnostics.slice().sort((a, b) => a.line - b.line);

      expect(diags[0]).toMatchObject({
        line: 6,
        col: 17,
        code: 2345,
        message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
      });
      expect(diags[1]).toMatchObject({
        line: 8,
        col: 7,
        code: 2322,
        message: "Type 'number' is not assignable to type 'string'.",
      });
      expect(diags[2]).toMatchObject({
        line: 10,
        col: 7,
        code: 2322,
        message: "Type 'number' is not assignable to type 'boolean'.",
      });
    });

    test("returns only the top-level message for chained diagnostics, not the full chain", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/chained-error.ts`, makeScope(dir));

      expect(result.diagnostics).toHaveLength(1);
      const { message } = result.diagnostics[0];

      expect(message).toContain("not assignable to type '(x: string) => number'");
      expect(message).not.toContain("Types of parameters");
      expect(message).not.toContain("Type 'string' is not assignable to type 'number'");
    });

    test("returns empty diagnostics for a clean file", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/clean.ts`, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    test("throws FILE_NOT_FOUND for a non-existent file", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      await expect(
        getTypeErrors(compiler, `${dir}/src/doesNotExist.ts`, makeScope(dir)),
      ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    });

    test("throws WORKSPACE_VIOLATION for a file outside the workspace", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      await expect(getTypeErrors(compiler, "/etc/hosts", makeScope(dir))).rejects.toMatchObject({
        code: "WORKSPACE_VIOLATION",
      });
    });

    test("errorCount equals diagnostics.length when not truncated", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/broken.ts`, makeScope(dir));

      expect(result.errorCount).toBe(result.diagnostics.length);
      expect(result.truncated).toBe(false);
    });

    test("caps at 100 and sets truncated=true when a single file has more than 100 errors", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/many-errors.ts`, makeScope(dir));

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.errorCount).toBe(105);
    });
  });

  describe("single file mode — exactly 100 errors", () => {
    test("is not truncated and errorCount equals 100 when a file has exactly 100 errors", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.ts100Errors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, `${dir}/src/exactly-100.ts`, makeScope(dir));

      expect(result.truncated).toBe(false);
      expect(result.errorCount).toBe(100);
      expect(result.diagnostics).toHaveLength(100);
    });
  });

  describe("project-wide mode (no file param)", () => {
    test("returns errors from all files in the project", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    test("caps at 100 and sets truncated=true; errorCount reflects the full total", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.truncated).toBe(true);
      expect(result.diagnostics).toHaveLength(100);
      expect(result.errorCount).toBeGreaterThan(100);
      expect(result.errorCount).toBeGreaterThan(result.diagnostics.length);
    });

    test("each diagnostic in project-wide results has the correct shape", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.tsErrors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      for (const diag of result.diagnostics) {
        expect(typeof diag.file).toBe("string");
        expect(diag.file.length).toBeGreaterThan(0);
        expect(diag.line).toBeGreaterThan(0);
        expect(diag.col).toBeGreaterThan(0);
        expect(typeof diag.code).toBe("number");
        expect(diag.code).toBeGreaterThan(0);
        expect(typeof diag.message).toBe("string");
        expect(diag.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe("project-wide mode — exactly 100 errors", () => {
    test("is not truncated and errorCount equals 100 when the project has exactly 100 errors", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.ts100Errors.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.truncated).toBe(false);
      expect(result.errorCount).toBe(100);
      expect(result.diagnostics).toHaveLength(100);
    });
  });

  describe("project-wide mode — clean project", () => {
    test("returns empty result for a project with no errors", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const compiler = new TsMorphEngine();

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe("project-wide mode — workspace holds a JS file the program excludes", () => {
    test("does not throw for a root .js config file when allowJs is unset", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true },
          include: ["src"],
        }),
        "src/main.ts": "export const value: number = 1;",
        "jest.config.js": "module.exports = { testEnvironment: 'node' };",
      });
      const compiler = new TsMorphEngine(dir);

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    test("does not throw for a .js file nested under src/ when allowJs is unset", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true },
          include: ["src"],
        }),
        "src/main.ts": "export const value: number = 1;",
        "src/legacy.js": "module.exports = { legacy: true };",
      });
      const compiler = new TsMorphEngine(dir);

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    test("does not throw for a .jsx file when allowJs is unset", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, jsx: "preserve" },
          include: ["src"],
        }),
        "src/main.ts": "export const value: number = 1;",
        "src/widget.jsx": "module.exports = function Widget() { return null; };",
      });
      const compiler = new TsMorphEngine(dir);

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    test("still reports type errors inside a .js file when allowJs and checkJs are enabled", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, allowJs: true, checkJs: true },
          include: ["src", "jest.config.js"],
        }),
        "src/main.ts": "export const value: number = 1;",
        "jest.config.js": "const bad = 5;\nbad.toUpperCase();\n",
      });
      const compiler = new TsMorphEngine(dir);

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.errorCount).toBe(1);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        file: `${dir}/jest.config.js`,
        code: 2339,
      });
    });

    test("does not throw for a workspace with no tsconfig at all", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "src/main.ts": "export const value = 1;",
        "jest.config.js": "module.exports = { testEnvironment: 'node' };",
      });
      const compiler = new TsMorphEngine(dir);

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    test("returns errorCount 0 for a workspace whose only file is excluded JS", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true },
        }),
        "jest.config.js": "module.exports = { testEnvironment: 'node' };",
      });
      const compiler = new TsMorphEngine(dir);

      const result = await getTypeErrors(compiler, undefined, makeScope(dir));

      expect(result.diagnostics).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe("Vue SFC support via VolarEngine", () => {
    function makeVolarEngine(dir: string): VolarEngine {
      return new VolarEngine(new TsMorphEngine(), dir);
    }

    describe("single .vue file with type errors", () => {
      test("returns diagnostics with the real .vue path (not the virtual .vue.ts path)", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);
        const vuePath = `${dir}/src/Broken.vue`;

        const result = await getTypeErrors(engine, vuePath, makeScope(dir));

        expect(result.errorCount).toBeGreaterThan(0);
        expect(result.diagnostics.length).toBeGreaterThan(0);

        for (const diag of result.diagnostics) {
          expect(diag.file).toBe(vuePath);
          expect(diag.file).not.toContain(".vue.ts");
        }
      });

      test("returns 1-based line and col in the real .vue source with correct error code", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);
        const vuePath = `${dir}/src/Broken.vue`;

        const result = await getTypeErrors(engine, vuePath, makeScope(dir));

        expect(result.errorCount).toBeGreaterThan(0);
        const diag = result.diagnostics[0];

        expect(diag.line).toBeGreaterThan(0);
        expect(diag.col).toBeGreaterThan(0);
        expect(diag.code).toBe(2322);
        expect(diag.message).toContain("not assignable to type 'number'");
      });

      test("pins exact position — error is at line 2 (the const x assignment) in Broken.vue", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);
        const vuePath = `${dir}/src/Broken.vue`;

        const result = await getTypeErrors(engine, vuePath, makeScope(dir));

        const ts2322 = result.diagnostics.filter((d) => d.code === 2322);
        expect(ts2322.length).toBeGreaterThan(0);
        expect(ts2322[0].line).toBe(2);
      });

      test("returns no virtual-only positions — all diagnostics map to the real .vue file", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);
        const vuePath = `${dir}/src/Broken.vue`;

        const result = await getTypeErrors(engine, vuePath, makeScope(dir));

        for (const diag of result.diagnostics) {
          expect(diag.file).not.toMatch(/\.vue\.ts$/);
        }
      });
    });

    describe("single .vue file with no errors", () => {
      test("returns empty diagnostics for a clean .vue file", async ({ seedNamedFixture }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);
        const vuePath = `${dir}/src/Clean.vue`;

        const result = await getTypeErrors(engine, vuePath, makeScope(dir));

        expect(result.diagnostics).toHaveLength(0);
        expect(result.errorCount).toBe(0);
        expect(result.truncated).toBe(false);
      });

      test("returns empty diagnostics for a template-only .vue file (no script block)", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);
        const vuePath = `${dir}/src/TemplateOnly.vue`;

        const result = await getTypeErrors(engine, vuePath, makeScope(dir));

        expect(result.diagnostics).toHaveLength(0);
        expect(result.errorCount).toBe(0);
        expect(result.truncated).toBe(false);
      });
    });

    describe("project-wide mode in a Vue project", () => {
      test("includes errors from .vue files in the combined results", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);

        const result = await getTypeErrors(engine, undefined, makeScope(dir));

        expect(result.errorCount).toBeGreaterThan(0);

        const vueDiags = result.diagnostics.filter((d) => d.file.endsWith(".vue"));
        expect(vueDiags.length).toBeGreaterThan(0);
      });

      test("includes errors from .ts files in the combined results", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);

        const result = await getTypeErrors(engine, undefined, makeScope(dir));

        const tsDiags = result.diagnostics.filter((d) => d.file.endsWith(".ts"));
        expect(tsDiags.length).toBeGreaterThan(0);
      });

      test(".vue diagnostics have the real .vue path, not the virtual .vue.ts path", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);

        const result = await getTypeErrors(engine, undefined, makeScope(dir));

        for (const diag of result.diagnostics) {
          expect(diag.file).not.toMatch(/\.vue\.ts$/);
        }
      });

      test("applies the 100-error cap across combined TS and Vue errors", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const engine = makeVolarEngine(dir);

        const result = await getTypeErrors(engine, undefined, makeScope(dir));

        expect(result.diagnostics.length).toBeLessThanOrEqual(100);
        expect(result.errorCount).toBeGreaterThanOrEqual(result.diagnostics.length);
        if (result.truncated) {
          expect(result.diagnostics).toHaveLength(100);
          expect(result.errorCount).toBeGreaterThan(100);
        } else {
          expect(result.errorCount).toBe(result.diagnostics.length);
        }
      });
    });

    describe("project-wide mode in a Vue project — workspace holds a JS file the program excludes", () => {
      test("does not throw for a root vite.config.js when allowJs is unset", async ({
        seedInlineFixture,
      }) => {
        const dir = await seedInlineFixture({
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              strict: true,
              target: "ESNext",
              module: "ESNext",
              moduleResolution: "bundler",
              jsx: "preserve",
            },
            include: ["src/**/*.ts", "src/**/*.vue"],
          }),
          "src/App.vue":
            "<script setup lang='ts'>\nconst greeting: string = 'hi';\n</script>\n<template>\n<div>{{ greeting }}</div>\n</template>\n",
          "vite.config.js": "module.exports = { plugins: [] };",
        });
        // Constructed with workspaceRoot, unlike makeVolarEngine — matches production wiring
        // (language-plugin-registry.ts always passes it), which is what makes addWorkspaceFiles
        // pick up vite.config.js and reach the bug this test guards against.
        const engine = new VolarEngine(new TsMorphEngine(dir), dir);

        const result = await getTypeErrors(engine, undefined, makeScope(dir));

        expect(result.errorCount).toBe(0);
        expect(result.diagnostics).toHaveLength(0);
        expect(result.truncated).toBe(false);
      });
    });

    describe(".ts file in a Vue project (regression guard)", () => {
      test("returns the same errors for a .ts file as TsMorphEngine would", async ({
        seedNamedFixture,
      }) => {
        const dir = await seedNamedFixture(FIXTURES.vueErrors.name);
        const volarEngine = makeVolarEngine(dir);
        const tsEngine = new TsMorphEngine();
        const tsFilePath = `${dir}/src/utils.ts`;
        const scope = makeScope(dir);

        const volarResult = await getTypeErrors(volarEngine, tsFilePath, scope);
        const tsResult = await getTypeErrors(tsEngine, tsFilePath, scope);

        expect(volarResult.errorCount).toBe(tsResult.errorCount);
        expect(volarResult.truncated).toBe(tsResult.truncated);
        expect(volarResult.diagnostics).toHaveLength(tsResult.diagnostics.length);
        const volarCodes = volarResult.diagnostics.map((d) => d.code).sort();
        const tsCodes = tsResult.diagnostics.map((d) => d.code).sort();
        expect(volarCodes).toEqual(tsCodes);
      });
    });
  });
});
