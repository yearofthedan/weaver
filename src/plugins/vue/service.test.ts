import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect } from "vitest";
import { FIXTURES, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import { TsMorphEngine } from "../../ts-engine/engine.js";
import { VolarEngine } from "./engine.js";
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

  describe("refreshFile", () => {
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
      service.refreshFile(file);

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
      service.refreshFile(file);

      const codesAfter = service.baseService.getSemanticDiagnostics(virtualPath).map((d) => d.code);
      expect(codesAfter.filter((code) => code === 2322).length).toBe(1);
      expect(codesAfter.length).toBe(codesBefore.length + 1);
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
      service.refreshFile(file);

      expect(service.fileContents.has(file)).toBe(false);
      expect(service.baseService.getProgram()?.getSourceFile(file)).toBeUndefined();
    });
  });

  describe("refreshWrittenFile", () => {
    test("keeps the cached service for a tracked file and reads it back from the new text", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const engine = new VolarEngine(new TsMorphEngine());
      const file = path.join(dir, "src/composables/useCounter.ts");
      await engine.getRenameLocations(file, engine.resolveOffset(file, 1, 17));

      const refreshed = "export function useCounter(): number {\n  return 1;\n}\n";
      fs.writeFileSync(file, refreshed);
      engine.refreshWrittenFile(file);

      // Only the retained service holds this text; a dropped one would fall back
      // to whichever content is on disk at the time of the read.
      fs.writeFileSync(file, "export const movedOn = true;\n");
      expect(engine.readFile(file)).toBe(refreshed);
    });

    test("drops the cached service for a path the service does not serve", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const engine = new VolarEngine(new TsMorphEngine());
      const tracked = path.join(dir, "src/composables/useCounter.ts");
      await engine.getRenameLocations(tracked, engine.resolveOffset(tracked, 1, 17));

      // Created after the service was built, so it is not among scriptFileNames.
      const late = path.join(dir, "src/Late.ts");
      fs.writeFileSync(late, "export const late: number = 1;\n");
      engine.refreshWrittenFile(late);

      // With the service gone from the cache, the engine has nowhere to hold this
      // and falls back to the file on disk.
      const held = "export const held = 1;\n";
      engine.notifyFileWritten(tracked, held);
      expect(engine.readFile(tracked)).not.toBe(held);
    });
  });
});
