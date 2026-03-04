import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "../../src/daemon/language-plugin-registry.js";
import { createVueLanguagePlugin } from "../../src/daemon/vue-language-plugin.js";
import type { LanguagePlugin } from "../../src/types.js";
import { TsProvider } from "../../src/providers/ts.js";
import type { LanguageProvider } from "../../src/types.js";
import { cleanup, copyFixture } from "../helpers.js";

// Path within this project (has a tsconfig.json) — allows plugin resolution to run.
const PROJECT_FILE = path.resolve("src/types.ts");

function stubProvider(tag = "stub"): LanguageProvider {
  return {
    resolveOffset: () => 0,
    getRenameLocations: async () => null,
    getReferencesAtPosition: async () => null,
    getDefinitionAtPosition: async () => null,
    getEditsForFileRename: async () => [],
    readFile: () => "",
    notifyFileWritten: () => {},
    afterFileRename: async () => ({ modified: [], skipped: [] }),
    afterSymbolMove: async () => ({ modified: [], skipped: [] }),
    _tag: tag,
  } as LanguageProvider & { _tag: string };
}

describe("LanguagePluginRegistry", () => {
  beforeEach(() => {
    clearLanguagePlugins();
  });

  describe("plugin resolution via makeRegistry", () => {
    it("falls back to TsProvider when no plugins are registered", async () => {
      const registry = makeRegistry(PROJECT_FILE);
      const provider = await registry.projectProvider();
      expect(provider).toBeInstanceOf(TsProvider);
    });

    it("falls back to TsProvider when file has no tsconfig", async () => {
      registerLanguagePlugin({
        id: "never-consulted",
        supportsProject: () => true,
        createProvider: async () => stubProvider("should-not-appear"),
      });
      // Path with no tsconfig — plugins are never consulted
      const registry = makeRegistry("/tmp/no-tsconfig/file.ts");
      const provider = await registry.projectProvider();
      expect(provider).toBeInstanceOf(TsProvider);
    });

    it("falls back to TsProvider when no plugin matches the project", async () => {
      registerLanguagePlugin({
        id: "never-matches",
        supportsProject: () => false,
        createProvider: async () => stubProvider("never"),
      });

      const registry = makeRegistry(PROJECT_FILE);
      const provider = await registry.projectProvider();
      expect(provider).toBeInstanceOf(TsProvider);
    });

    it("uses the first matching plugin's provider", async () => {
      const pluginA: LanguagePlugin = {
        id: "plugin-a",
        supportsProject: () => true,
        createProvider: async () => stubProvider("a"),
      };
      const pluginB: LanguagePlugin = {
        id: "plugin-b",
        supportsProject: () => true,
        createProvider: async () => stubProvider("b"),
      };
      registerLanguagePlugin(pluginA);
      registerLanguagePlugin(pluginB);

      const registry = makeRegistry(PROJECT_FILE);
      const provider = (await registry.projectProvider()) as LanguageProvider & { _tag: string };
      expect(provider._tag).toBe("a");
    });

    it("skips non-matching plugins and uses the first match", async () => {
      const noMatch: LanguagePlugin = {
        id: "no-match",
        supportsProject: () => false,
        createProvider: async () => stubProvider("no"),
      };
      const match: LanguagePlugin = {
        id: "matches",
        supportsProject: () => true,
        createProvider: async () => stubProvider("yes"),
      };
      registerLanguagePlugin(noMatch);
      registerLanguagePlugin(match);

      const registry = makeRegistry(PROJECT_FILE);
      const provider = (await registry.projectProvider()) as LanguageProvider & { _tag: string };
      expect(provider._tag).toBe("yes");
    });

    it("tsProvider always returns TsProvider regardless of registered plugins", async () => {
      registerLanguagePlugin({
        id: "claims-all",
        supportsProject: () => true,
        createProvider: async () => stubProvider("not-ts"),
      });

      const registry = makeRegistry(PROJECT_FILE);
      const tsProvider = await registry.tsProvider();
      expect(tsProvider).toBeInstanceOf(TsProvider);
    });

    it("caches the provider from createProvider — does not call it twice for the same plugin", async () => {
      const factory = vi.fn(async () => stubProvider("cached"));
      registerLanguagePlugin({
        id: "caching-test",
        supportsProject: () => true,
        createProvider: factory,
      });

      const r1 = makeRegistry(PROJECT_FILE);
      await r1.projectProvider();
      const r2 = makeRegistry(PROJECT_FILE);
      await r2.projectProvider();

      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("invalidation fan-out", () => {
    it("invalidateFile calls invalidateFile on all registered plugins", () => {
      const invalidateA = vi.fn();
      const invalidateB = vi.fn();

      registerLanguagePlugin({
        id: "plugin-a",
        supportsProject: () => true,
        createProvider: async () => stubProvider(),
        invalidateFile: invalidateA,
      });
      registerLanguagePlugin({
        id: "plugin-b",
        supportsProject: () => false,
        createProvider: async () => stubProvider(),
        invalidateFile: invalidateB,
      });

      invalidateFile("/some/file.ts");

      expect(invalidateA).toHaveBeenCalledWith("/some/file.ts");
      expect(invalidateB).toHaveBeenCalledWith("/some/file.ts");
    });

    it("invalidateAll calls invalidateAll on all registered plugins", () => {
      const invalidateAllA = vi.fn();
      const invalidateAllB = vi.fn();

      registerLanguagePlugin({
        id: "plugin-a",
        supportsProject: () => true,
        createProvider: async () => stubProvider(),
        invalidateAll: invalidateAllA,
      });
      registerLanguagePlugin({
        id: "plugin-b",
        supportsProject: () => false,
        createProvider: async () => stubProvider(),
        invalidateAll: invalidateAllB,
      });

      invalidateAll();

      expect(invalidateAllA).toHaveBeenCalled();
      expect(invalidateAllB).toHaveBeenCalled();
    });

    it("invalidateFile continues to other plugins when one throws", () => {
      const invalidateB = vi.fn();

      registerLanguagePlugin({
        id: "plugin-throws",
        supportsProject: () => true,
        createProvider: async () => stubProvider(),
        invalidateFile: () => {
          throw new Error("plugin-a exploded");
        },
      });
      registerLanguagePlugin({
        id: "plugin-ok",
        supportsProject: () => false,
        createProvider: async () => stubProvider(),
        invalidateFile: invalidateB,
      });

      invalidateFile("/some/file.ts");

      expect(invalidateB).toHaveBeenCalledWith("/some/file.ts");
    });

    it("invalidateAll continues to other plugins when one throws", () => {
      const invalidateAllB = vi.fn();

      registerLanguagePlugin({
        id: "plugin-throws",
        supportsProject: () => true,
        createProvider: async () => stubProvider(),
        invalidateAll: () => {
          throw new Error("plugin-a exploded");
        },
      });
      registerLanguagePlugin({
        id: "plugin-ok",
        supportsProject: () => false,
        createProvider: async () => stubProvider(),
        invalidateAll: invalidateAllB,
      });

      invalidateAll();

      expect(invalidateAllB).toHaveBeenCalled();
    });

    it("invalidateFile is a no-op for plugins that don't declare it", () => {
      registerLanguagePlugin({
        id: "no-invalidate",
        supportsProject: () => true,
        createProvider: async () => stubProvider(),
        // no invalidateFile
      });

      expect(() => invalidateFile("/some/file.ts")).not.toThrow();
    });

    it("invalidateAll is a no-op for plugins that don't declare it", () => {
      registerLanguagePlugin({
        id: "no-invalidate",
        supportsProject: () => true,
        createProvider: async () => stubProvider(),
        // no invalidateAll
      });

      expect(() => invalidateAll()).not.toThrow();
    });

    it("built-in TS provider invalidation still works alongside plugin invalidation", () => {
      const pluginInvalidate = vi.fn();
      registerLanguagePlugin({
        id: "test-plugin",
        supportsProject: () => false,
        createProvider: async () => stubProvider(),
        invalidateFile: pluginInvalidate,
      });

      // Should not throw — TS provider invalidation + plugin invalidation both run
      expect(() => invalidateFile("/some/file.ts")).not.toThrow();
      expect(pluginInvalidate).toHaveBeenCalledWith("/some/file.ts");
    });
  });
});

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
    const { VolarProvider } = await import("../../src/providers/volar.js");

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
});
