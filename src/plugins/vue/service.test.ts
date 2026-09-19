import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect } from "vitest";
import { fixtureTest as test } from "../../__testHelpers__/helpers.js";
import { buildVolarService } from "./service.js";

describe("buildVolarService", () => {
  describe("scriptFileNames", () => {
    test("covers tsconfig files, always-included .vue files, and the workspace walk", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
        "src/main.ts": "export const x = 1;\n",
        "src/App.vue": "<template><div /></template>\n",
        // Outside tsconfig.include — reachable only through the workspace walk.
        "tests/outside.ts": "export const y = 2;\n",
      });

      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);

      expect(service.scriptFileNames).toContain(path.join(dir, "src/main.ts"));
      expect(service.scriptFileNames).toContain(`${path.join(dir, "src/App.vue")}.ts`);
      expect(service.scriptFileNames).toContain(path.join(dir, "tests/outside.ts"));
    });

    test("names the virtual .vue.ts path, never the real .vue path", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
        "src/App.vue": "<template><div /></template>\n",
      });

      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);

      expect(service.scriptFileNames).not.toContain(path.join(dir, "src/App.vue"));
    });
  });

  describe("rereadFile", () => {
    test("re-reads a tracked .ts file so the language service answers from the new text", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts"],
        }),
        "src/main.ts": "export const count: number = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "src/main.ts");
      expect(service.baseService.getSemanticDiagnostics(file)).toEqual([]);

      fs.writeFileSync(file, 'export const count: number = "not a number";\n');
      service.rereadFile(file);

      const diagnostics = service.baseService.getSemanticDiagnostics(file);
      expect(diagnostics.length).toBe(1);
    });

    test("re-registers a .vue file's virtual TypeScript so the SFC's new text is checked", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
        "src/App.vue": [
          '<script setup lang="ts">',
          "const count: number = 1;",
          "</script>",
          "<template><div>{{ count }}</div></template>",
          "",
        ].join("\n"),
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "src/App.vue");
      const virtualPath = `${file}.ts`;
      const codesBefore = service.baseService
        .getSemanticDiagnostics(virtualPath)
        .map((d) => d.code);
      expect(codesBefore).not.toContain(2322);

      fs.writeFileSync(
        file,
        [
          '<script setup lang="ts">',
          'const count: number = "not a number";',
          "</script>",
          "<template><div>{{ count }}</div></template>",
          "",
        ].join("\n"),
      );
      service.rereadFile(file);

      const codesAfter = service.baseService.getSemanticDiagnostics(virtualPath).map((d) => d.code);
      expect(codesAfter.filter((code) => code === 2322).length).toBe(1);
      expect(codesAfter.length).toBe(codesBefore.length + 1);
    });

    test("re-reads a file again after it changes a second time", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts"],
        }),
        "src/main.ts": "export const count: number = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "src/main.ts");

      fs.writeFileSync(file, "export const count: number = 2;\n");
      service.rereadFile(file);
      expect(service.baseService.getSemanticDiagnostics(file)).toEqual([]);

      fs.writeFileSync(file, 'export const count: number = "not a number";\n');
      service.rereadFile(file);
      expect(service.baseService.getSemanticDiagnostics(file)).toHaveLength(1);
    });

    test("stops serving a deleted .vue file's virtual TypeScript", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts", "src/**/*.vue"],
        }),
        "src/App.vue": '<script setup lang="ts">\nconst n: number = 1;\n</script>\n',
        "src/uses.ts": 'import App from "./App.vue";\nexport const app = App;\n',
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "src/App.vue");
      const virtualPath = `${file}.ts`;
      expect(service.baseService.getProgram()?.getSourceFile(virtualPath)).toBeDefined();

      fs.unlinkSync(file);
      service.rereadFile(file);

      expect(service.language.scripts.get(file)).toBeUndefined();
      expect(service.baseService.getProgram()?.getSourceFile(virtualPath)).toBeUndefined();
    });

    test("stops serving a path that can no longer be read", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts"],
        }),
        "src/main.ts": "export const count: number = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "src/main.ts");
      expect(service.fileContents.has(file)).toBe(true);
      expect(service.baseService.getProgram()?.getSourceFile(file)).toBeDefined();

      fs.unlinkSync(file);
      service.rereadFile(file);

      expect(service.fileContents.has(file)).toBe(false);
      expect(service.baseService.getProgram()?.getSourceFile(file)).toBeUndefined();
    });

    test("keeps the parsed source file when the text on disk matches the text held", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { strict: true, moduleResolution: "bundler" },
          include: ["src/**/*.ts"],
        }),
        "src/main.ts": "export const count: number = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "src/main.ts");
      fs.writeFileSync(file, "export const count: number = 2;\n");
      service.rereadFile(file);
      const parsed = service.baseService.getProgram()?.getSourceFile(file);
      expect(parsed).toBeDefined();

      service.rereadFile(file);

      expect(service.baseService.getProgram()?.getSourceFile(file)).toBe(parsed);
    });
  });

  describe("addScriptFile", () => {
    const TSCONFIG = JSON.stringify({
      compilerOptions: { strict: true, moduleResolution: "bundler" },
      include: ["src/**/*.ts", "src/**/*.vue"],
    });

    test("brings a .ts path the tsconfig and the workspace walk both missed into the program", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": "export const x = 1;\n",
        "dist/gen.ts": "export const count: number = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "dist/gen.ts");
      expect(service.baseService.getProgram()?.getSourceFile(file)).toBeUndefined();

      service.addScriptFile(file);

      expect(service.baseService.getProgram()?.getSourceFile(file)).toBeDefined();
    });

    test("brings a .vue path in under its virtual name", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": "export const x = 1;\n",
        "dist/Gen.vue": '<script setup lang="ts">\nconst count: number = 1;\n</script>\n',
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "dist/Gen.vue");
      const virtualPath = `${file}.ts`;
      expect(service.baseService.getProgram()?.getSourceFile(virtualPath)).toBeUndefined();

      service.addScriptFile(file);

      expect(service.baseService.getProgram()?.getSourceFile(virtualPath)).toBeDefined();
    });

    test("grows the served list, holding the built set at its construction-time contents", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": "export const x = 1;\n",
        "dist/Gen.vue": '<script setup lang="ts">\nconst count: number = 1;\n</script>\n',
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "dist/Gen.vue");
      const virtualPath = `${file}.ts`;

      service.addScriptFile(file);

      expect(service.scriptFileNames).toContain(virtualPath);
      expect(service.builtFileNames.has(virtualPath)).toBe(false);
    });

    test("leaves an already-added path alone on a second call", async ({ seedInlineFixture }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": "export const x = 1;\n",
        "dist/gen.ts": "export const count: number = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const file = path.join(dir, "dist/gen.ts");
      service.addScriptFile(file);
      const program = service.baseService.getProgram();

      service.addScriptFile(file);

      expect(service.scriptFileNames.filter((name) => name === file)).toHaveLength(1);
      expect(service.baseService.getProgram()).toBe(program);
    });

    test("leaves the program unchanged when the path cannot be read", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": "export const x = 1;\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const missing = path.join(dir, "dist/missing.ts");
      const program = service.baseService.getProgram();

      service.addScriptFile(missing);

      expect(service.scriptFileNames).not.toContain(missing);
      expect(service.baseService.getProgram()).toBe(program);
    });
  });

  describe("registration from resolution", () => {
    const TSCONFIG = JSON.stringify({
      compilerOptions: { strict: true, moduleResolution: "bundler", jsx: "preserve" },
      include: ["src/**/*"],
    });

    test("registers an SFC the compiler resolves to without widening the served list", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": 'import B from "../dist/Broken.vue";\nexport const b = B;\n',
        "dist/Broken.vue":
          '<script setup lang="ts">\nconst x: number = "not a number";\n</script>\n',
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const virtualPath = `${path.join(dir, "dist/Broken.vue")}.ts`;

      expect(service.baseService.getProgram()?.getSourceFile(virtualPath)).toBeDefined();
      expect(service.scriptFileNames).not.toContain(virtualPath);
      expect(service.builtFileNames.has(virtualPath)).toBe(false);
      expect(
        service.baseService
          .getSemanticDiagnostics(path.join(dir, "src/main.ts"))
          .filter((d) => d.category === ts.DiagnosticCategory.Error),
      ).toEqual([]);
    });

    test("leaves a virtual name a real file occupies to that file", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": TSCONFIG,
        "src/main.ts": 'import Foo from "../dist/Foo.vue";\nexport const foo = Foo;\n',
        "dist/Foo.vue": '<script setup lang="ts">\nconst x: number = "not a number";\n</script>\n',
        "dist/Foo.vue.ts": "const n: number = 1;\nn.toUpperCase();\n",
      });
      const service = await buildVolarService(path.join(dir, "tsconfig.json"), undefined, dir);
      const realPath = path.join(dir, "dist/Foo.vue.ts");

      // A real file at the virtual name keeps its own text, so its own error is the one that
      // comes back.
      expect(
        service.baseService
          .getSemanticDiagnostics(realPath)
          .filter((d) => d.category === ts.DiagnosticCategory.Error)
          .map((d) => d.code),
      ).toEqual([2339]);
    });
  });
});
