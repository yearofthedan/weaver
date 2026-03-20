import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TsMorphEngine } from "../ts-engine/engine.js";
import type { Engine, LanguagePlugin } from "../ts-engine/types.js";
import {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "./language-plugin-registry.js";

const PROJECT_FILE = path.resolve("src/types.ts");

function stubCompiler(tag = "stub"): Engine {
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
  } as Engine & { _tag: string };
}

describe("LanguagePluginRegistry", () => {
  beforeEach(() => {
    clearLanguagePlugins();
  });

  describe("plugin resolution via makeRegistry", () => {
    it("falls back to TsMorphEngine when no plugins are registered", async () => {
      const registry = makeRegistry(PROJECT_FILE);
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(TsMorphEngine);
    });

    it("falls back to TsMorphEngine when file has no tsconfig", async () => {
      registerLanguagePlugin({
        id: "never-consulted",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler("should-not-appear"),
      });
      // Path with no tsconfig — plugins are never consulted
      const registry = makeRegistry("/tmp/no-tsconfig/file.ts");
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(TsMorphEngine);
    });

    it("falls back to TsMorphEngine when no plugin matches the project", async () => {
      registerLanguagePlugin({
        id: "never-matches",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler("never"),
      });

      const registry = makeRegistry(PROJECT_FILE);
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(TsMorphEngine);
    });

    it("uses the first matching plugin's compiler", async () => {
      const pluginA: LanguagePlugin = {
        id: "plugin-a",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler("a"),
      };
      const pluginB: LanguagePlugin = {
        id: "plugin-b",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler("b"),
      };
      registerLanguagePlugin(pluginA);
      registerLanguagePlugin(pluginB);

      const registry = makeRegistry(PROJECT_FILE);
      const compiler = (await registry.projectEngine()) as Engine & { _tag: string };
      expect(compiler._tag).toBe("a");
    });

    it("skips non-matching plugins and uses the first match", async () => {
      const noMatch: LanguagePlugin = {
        id: "no-match",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler("no"),
      };
      const match: LanguagePlugin = {
        id: "matches",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler("yes"),
      };
      registerLanguagePlugin(noMatch);
      registerLanguagePlugin(match);

      const registry = makeRegistry(PROJECT_FILE);
      const compiler = (await registry.projectEngine()) as Engine & { _tag: string };
      expect(compiler._tag).toBe("yes");
    });

    it("tsEngine always returns TsMorphEngine regardless of registered plugins", async () => {
      registerLanguagePlugin({
        id: "claims-all",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler("not-ts"),
      });

      const registry = makeRegistry(PROJECT_FILE);
      const tsCompiler = await registry.tsEngine();
      expect(tsCompiler).toBeInstanceOf(TsMorphEngine);
    });

    it("caches the engine from createEngine — does not call it twice for the same plugin", async () => {
      const factory = vi.fn(async (_tsEngine: TsMorphEngine) => stubCompiler("cached"));
      registerLanguagePlugin({
        id: "caching-test",
        supportsProject: () => true,
        createEngine: factory,
      });

      const r1 = makeRegistry(PROJECT_FILE);
      await r1.projectEngine();
      const r2 = makeRegistry(PROJECT_FILE);
      await r2.projectEngine();

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("passes a TsMorphEngine instance to createEngine when activating a plugin", async () => {
      let receivedEngine: unknown;
      registerLanguagePlugin({
        id: "injection-test",
        supportsProject: () => true,
        createEngine: async (tsEngine) => {
          receivedEngine = tsEngine;
          return stubCompiler("injected");
        },
      });

      const registry = makeRegistry(PROJECT_FILE);
      await registry.projectEngine();

      expect(receivedEngine).toBeInstanceOf(TsMorphEngine);
    });
  });

  describe("invalidation fan-out", () => {
    it("invalidateFile calls invalidateFile on all registered plugins", () => {
      const invalidateA = vi.fn();
      const invalidateB = vi.fn();

      registerLanguagePlugin({
        id: "plugin-a",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateFile: invalidateA,
      });
      registerLanguagePlugin({
        id: "plugin-b",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler(),
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
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateAll: invalidateAllA,
      });
      registerLanguagePlugin({
        id: "plugin-b",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler(),
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
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateFile: () => {
          throw new Error("plugin-a exploded");
        },
      });
      registerLanguagePlugin({
        id: "plugin-ok",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler(),
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
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateAll: () => {
          throw new Error("plugin-a exploded");
        },
      });
      registerLanguagePlugin({
        id: "plugin-ok",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateAll: invalidateAllB,
      });

      invalidateAll();

      expect(invalidateAllB).toHaveBeenCalled();
    });

    it("invalidateFile is a no-op for plugins that don't declare it", () => {
      registerLanguagePlugin({
        id: "no-invalidate",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler(),
        // no invalidateFile
      });

      expect(() => invalidateFile("/some/file.ts")).not.toThrow();
    });

    it("invalidateAll is a no-op for plugins that don't declare it", () => {
      registerLanguagePlugin({
        id: "no-invalidate",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler(),
        // no invalidateAll
      });

      expect(() => invalidateAll()).not.toThrow();
    });

    it("built-in TS compiler invalidation still works alongside plugin invalidation", () => {
      const pluginInvalidate = vi.fn();
      registerLanguagePlugin({
        id: "test-plugin",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateFile: pluginInvalidate,
      });

      // Should not throw — TS compiler invalidation + plugin invalidation both run
      expect(() => invalidateFile("/some/file.ts")).not.toThrow();
      expect(pluginInvalidate).toHaveBeenCalledWith("/some/file.ts");
    });
  });
});
