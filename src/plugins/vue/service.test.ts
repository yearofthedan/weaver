import * as path from "node:path";
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
});
