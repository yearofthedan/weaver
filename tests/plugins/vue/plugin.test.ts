import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TsMorphCompiler } from "../../../src/compilers/ts.js";
import {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "../../../src/daemon/language-plugin-registry.js";
import { createVueLanguagePlugin } from "../../../src/plugins/vue/plugin.js";
import { cleanup, copyFixture } from "../../helpers.js";

describe("Vue LanguagePlugin integration", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    clearLanguagePlugins();
    registerLanguagePlugin(createVueLanguagePlugin());
  });

  afterEach(() => dirs.splice(0).forEach(cleanup));

  it("projectCompiler returns VolarCompiler for a Vue project", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const { VolarCompiler } = await import("../../../src/plugins/vue/compiler.js");

    const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"));
    const compiler = await registry.projectCompiler();
    expect(compiler).toBeInstanceOf(VolarCompiler);
  }, 10_000);

  it("projectCompiler returns TsMorphCompiler for a non-Vue project", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const compiler = await registry.projectCompiler();
    expect(compiler).toBeInstanceOf(TsMorphCompiler);
  }, 10_000);

  it("invalidateFile before compiler is created does not throw", () => {
    expect(() => invalidateFile("/any/file.vue")).not.toThrow();
  });

  it("invalidateAll before compiler is created does not throw", () => {
    expect(() => invalidateAll()).not.toThrow();
  });

  it("invalidateAll clears cached compiler so next createCompiler call rebuilds it", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const { VolarCompiler } = await import("../../../src/plugins/vue/compiler.js");

    const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"));
    const first = await registry.projectCompiler();
    invalidateAll();
    const second = await registry.projectCompiler();

    expect(first).toBeInstanceOf(VolarCompiler);
    expect(second).toBeInstanceOf(VolarCompiler);
    expect(first).not.toBe(second);
  }, 15_000);
});
