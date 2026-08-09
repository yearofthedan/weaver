import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, fixtureTest as test } from "../../__testHelpers__/helpers.js";
import {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "../../daemon/language-plugin-registry.js";
import { TsMorphEngine } from "../../ts-engine/engine.js";
import { VolarEngine } from "./engine.js";
import { createVueLanguagePlugin } from "./plugin.js";

describe("Vue LanguagePlugin integration", () => {
  beforeEach(() => {
    clearLanguagePlugins();
    registerLanguagePlugin(createVueLanguagePlugin());
  });

  describe("Vue project detection", () => {
    test("projectEngine returns VolarEngine for a Vue project", async ({ seedNamedFixture }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"), dir);
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(VolarEngine);
    }, 10_000);

    test("invalidateAll clears cached engine so next createEngine call rebuilds it", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.vueProject.name);
      const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"), dir);
      const first = await registry.projectEngine();
      invalidateAll();
      const second = await registry.projectEngine();

      expect(first).toBeInstanceOf(VolarEngine);
      expect(second).toBeInstanceOf(VolarEngine);
      expect(first).not.toBe(second);
    }, 15_000);
  });

  describe("non-Vue project fallback", () => {
    test("projectEngine returns TsMorphEngine for a non-Vue project", async ({
      seedNamedFixture,
    }) => {
      const dir = await seedNamedFixture(FIXTURES.simpleTs.name);
      const registry = makeRegistry(path.join(dir, "src/utils.ts"), dir);
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(TsMorphEngine);
    }, 10_000);
  });

  it("invalidateFile before compiler is created does not throw", () => {
    expect(() => invalidateFile("/any/file.vue")).not.toThrow();
  });

  it("invalidateAll before compiler is created does not throw", () => {
    expect(() => invalidateAll()).not.toThrow();
  });
});
