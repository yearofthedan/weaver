import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, copyFixture, FIXTURES } from "../../__testHelpers__/helpers.js";
import {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "../../daemon/language-plugin-registry.js";
import { TsMorphEngine } from "../../ts-engine/engine.js";
import { createVueLanguagePlugin } from "./plugin.js";

describe("Vue LanguagePlugin integration", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    clearLanguagePlugins();
    registerLanguagePlugin(createVueLanguagePlugin());
  });

  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("projectEngine returns VolarCompiler for a Vue project", async () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const { VolarCompiler } = await import("./compiler.js");

    const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"));
    const compiler = await registry.projectEngine();
    expect(compiler).toBeInstanceOf(VolarCompiler);
  }, 10_000);

  it("projectEngine returns TsMorphEngine for a non-Vue project", async () => {
    const dir = copyFixture(FIXTURES.simpleTs.name);
    dirs.push(dir);

    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const compiler = await registry.projectEngine();
    expect(compiler).toBeInstanceOf(TsMorphEngine);
  }, 10_000);

  it("invalidateFile before compiler is created does not throw", () => {
    expect(() => invalidateFile("/any/file.vue")).not.toThrow();
  });

  it("invalidateAll before compiler is created does not throw", () => {
    expect(() => invalidateAll()).not.toThrow();
  });

  it("invalidateAll clears cached engine so next createEngine call rebuilds it", async () => {
    const dir = copyFixture(FIXTURES.vueProject.name);
    dirs.push(dir);
    const { VolarCompiler } = await import("./compiler.js");

    const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"));
    const first = await registry.projectEngine();
    invalidateAll();
    const second = await registry.projectEngine();

    expect(first).toBeInstanceOf(VolarCompiler);
    expect(second).toBeInstanceOf(VolarCompiler);
    expect(first).not.toBe(second);
  }, 15_000);
});
