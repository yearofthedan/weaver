import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TsProvider } from "../../../src/compilers/ts.js";
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

  it("projectProvider returns VolarProvider for a Vue project", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const { VolarProvider } = await import("../../../src/plugins/vue/compiler.js");

    const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"));
    const provider = await registry.projectProvider();
    expect(provider).toBeInstanceOf(VolarProvider);
  }, 10_000);

  it("projectProvider returns TsProvider for a non-Vue project", async () => {
    const dir = copyFixture("simple-ts");
    dirs.push(dir);

    const registry = makeRegistry(path.join(dir, "src/utils.ts"));
    const provider = await registry.projectProvider();
    expect(provider).toBeInstanceOf(TsProvider);
  }, 10_000);

  it("invalidateFile before provider is created does not throw", () => {
    expect(() => invalidateFile("/any/file.vue")).not.toThrow();
  });

  it("invalidateAll before provider is created does not throw", () => {
    expect(() => invalidateAll()).not.toThrow();
  });

  it("invalidateAll clears cached provider so next createProvider call rebuilds it", async () => {
    const dir = copyFixture("vue-project");
    dirs.push(dir);
    const { VolarProvider } = await import("../../../src/plugins/vue/compiler.js");

    const registry = makeRegistry(path.join(dir, "src/composables/useCounter.ts"));
    const first = await registry.projectProvider();
    invalidateAll();
    const second = await registry.projectProvider();

    expect(first).toBeInstanceOf(VolarProvider);
    expect(second).toBeInstanceOf(VolarProvider);
    expect(first).not.toBe(second);
  }, 15_000);
});
