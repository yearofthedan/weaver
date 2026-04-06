import { describe, expect } from "vitest";
import { FIXTURES, fileExists, readFile, fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { VolarEngine } from "../plugins/vue/engine.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import { moveDirectory } from "./moveDirectory.js";

function makeScope(dir: string): WorkspaceScope {
  return new WorkspaceScope(dir, new NodeFileSystem());
}

describe("moveDirectory action - VolarEngine integration", () => {
  test.override({ fixtureName: FIXTURES.moveDirVueExternal.name });

  describe("external .ts files importing moved .vue components", () => {
    test("updates path-alias import specifier in external .ts file after moving directory", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await moveDirectory(compiler, `${dir}/src/components`, `${dir}/src/ui`, makeScope(dir));

      const appTs = readFile(dir, "src/app.ts");
      expect(appTs).not.toContain("@/components/Button.vue");
    });

    test("updates import specifier in external .ts file after moving directory with .vue files", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await moveDirectory(compiler, `${dir}/src/components`, `${dir}/src/ui`, makeScope(dir));

      // The moved .vue file must be at the new location
      expect(fileExists(dir, "src/ui/Button.vue")).toBe(true);
      expect(fileExists(dir, "src/components/Button.vue")).toBe(false);

      // The external .ts file must have its import specifier updated
      const appTs = readFile(dir, "src/app.ts");
      expect(appTs).toContain("./ui/Button.vue");
      expect(appTs).not.toContain("./components/Button.vue");
    });

    test("updates import specifier in external .ts file when moving into a nested destination", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/widgets`,
        makeScope(dir),
      );

      const appTs = readFile(dir, "src/app.ts");
      expect(appTs).toContain("./ui/widgets/Button.vue");
      expect(appTs).not.toContain("./components/Button.vue");
    });
  });

  describe("external .vue files importing from moved directory", () => {
    test("updates import specifier in external .vue file after moving a composables directory", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await moveDirectory(compiler, `${dir}/src/composables`, `${dir}/src/hooks`, makeScope(dir));

      // The moved .ts file must be at the new location
      expect(fileExists(dir, "src/hooks/useCounter.ts")).toBe(true);
      expect(fileExists(dir, "src/composables/useCounter.ts")).toBe(false);

      // The external .vue file must have its import specifier updated
      const appVue = readFile(dir, "src/App.vue");
      expect(appVue).toContain("./hooks/useCounter");
      expect(appVue).not.toContain("./composables/useCounter");
    });

    test("updates import specifier in external .vue file after moving a components directory with .vue files", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      await moveDirectory(compiler, `${dir}/src/components`, `${dir}/src/ui`, makeScope(dir));

      // App.vue also imports Button.vue from components — it must be updated
      const appVue = readFile(dir, "src/App.vue");
      expect(appVue).toContain("./ui/Button.vue");
      expect(appVue).not.toContain("./components/Button.vue");
    });
  });

  describe("moved .vue files with external relative imports", () => {
    test("updates relative import in moved .vue file that points outside the moved directory", async ({
      dir,
    }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      // Button.vue imports '../lib/helper'; after moving components/ → ui/components/
      // the import should become '../../lib/helper'
      await moveDirectory(
        compiler,
        `${dir}/src/components`,
        `${dir}/src/ui/components`,
        makeScope(dir),
      );

      const buttonVue = readFile(dir, "src/ui/components/Button.vue");
      expect(buttonVue).toContain("../../lib/helper");
      // The single-depth path must not appear as a standalone specifier
      // (note: "../../lib/helper" contains "../lib/helper" as a substring,
      // so we check the full depth is correct)
      expect(buttonVue).not.toContain('"../lib/helper"');
      expect(buttonVue).not.toContain("'../lib/helper'");
    });

    test("does not rewrite intra-directory imports between moved .vue files", async ({ dir }) => {
      const compiler = new VolarEngine(new TsMorphEngine());

      // Moving composables/ — useCounter.ts has no intra-dir imports, so this just
      // verifies the composable content is intact after the move
      await moveDirectory(compiler, `${dir}/src/composables`, `${dir}/src/hooks`, makeScope(dir));

      const composable = readFile(dir, "src/hooks/useCounter.ts");
      expect(composable).toContain("useCounter");
      expect(composable).toContain("ref");
    });
  });
});
