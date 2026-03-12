import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TsMorphCompiler } from "../../src/compilers/ts.js";
import {
  clearLanguagePlugins,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  registerLanguagePlugin,
} from "../../src/daemon/language-plugin-registry.js";
import type { Compiler, LanguagePlugin } from "../../src/types.js";

const PROJECT_FILE = path.resolve("src/types.ts");

function stubCompiler(tag = "stub"): Compiler {
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
  } as Compiler & { _tag: string };
}

describe("LanguagePluginRegistry", () => {
  beforeEach(() => {
    clearLanguagePlugins();
  });

  describe("plugin resolution via makeRegistry", () => {
    it("falls back to TsMorphCompiler when no plugins are registered", async () => {
      const registry = makeRegistry(PROJECT_FILE);
      const compiler = await registry.projectCompiler();
      expect(compiler).toBeInstanceOf(TsMorphCompiler);
    });

    it("falls back to TsMorphCompiler when file has no tsconfig", async () => {
      registerLanguagePlugin({
        id: "never-consulted",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler("should-not-appear"),
      });
      // Path with no tsconfig — plugins are never consulted
      const registry = makeRegistry("/tmp/no-tsconfig/file.ts");
      const compiler = await registry.projectCompiler();
      expect(compiler).toBeInstanceOf(TsMorphCompiler);
    });

    it("falls back to TsMorphCompiler when no plugin matches the project", async () => {
      registerLanguagePlugin({
        id: "never-matches",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler("never"),
      });

      const registry = makeRegistry(PROJECT_FILE);
      const compiler = await registry.projectCompiler();
      expect(compiler).toBeInstanceOf(TsMorphCompiler);
    });

    it("uses the first matching plugin's compiler", async () => {
      const pluginA: LanguagePlugin = {
        id: "plugin-a",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler("a"),
      };
      const pluginB: LanguagePlugin = {
        id: "plugin-b",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler("b"),
      };
      registerLanguagePlugin(pluginA);
      registerLanguagePlugin(pluginB);

      const registry = makeRegistry(PROJECT_FILE);
      const compiler = (await registry.projectCompiler()) as Compiler & { _tag: string };
      expect(compiler._tag).toBe("a");
    });

    it("skips non-matching plugins and uses the first match", async () => {
      const noMatch: LanguagePlugin = {
        id: "no-match",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler("no"),
      };
      const match: LanguagePlugin = {
        id: "matches",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler("yes"),
      };
      registerLanguagePlugin(noMatch);
      registerLanguagePlugin(match);

      const registry = makeRegistry(PROJECT_FILE);
      const compiler = (await registry.projectCompiler()) as Compiler & { _tag: string };
      expect(compiler._tag).toBe("yes");
    });

    it("tsCompiler always returns TsMorphCompiler regardless of registered plugins", async () => {
      registerLanguagePlugin({
        id: "claims-all",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler("not-ts"),
      });

      const registry = makeRegistry(PROJECT_FILE);
      const tsCompiler = await registry.tsCompiler();
      expect(tsCompiler).toBeInstanceOf(TsMorphCompiler);
    });

    it("caches the compiler from createCompiler — does not call it twice for the same plugin", async () => {
      const factory = vi.fn(async () => stubCompiler("cached"));
      registerLanguagePlugin({
        id: "caching-test",
        supportsProject: () => true,
        createCompiler: factory,
      });

      const r1 = makeRegistry(PROJECT_FILE);
      await r1.projectCompiler();
      const r2 = makeRegistry(PROJECT_FILE);
      await r2.projectCompiler();

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
        createCompiler: async () => stubCompiler(),
        invalidateFile: invalidateA,
      });
      registerLanguagePlugin({
        id: "plugin-b",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler(),
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
        createCompiler: async () => stubCompiler(),
        invalidateAll: invalidateAllA,
      });
      registerLanguagePlugin({
        id: "plugin-b",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler(),
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
        createCompiler: async () => stubCompiler(),
        invalidateFile: () => {
          throw new Error("plugin-a exploded");
        },
      });
      registerLanguagePlugin({
        id: "plugin-ok",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler(),
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
        createCompiler: async () => stubCompiler(),
        invalidateAll: () => {
          throw new Error("plugin-a exploded");
        },
      });
      registerLanguagePlugin({
        id: "plugin-ok",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler(),
        invalidateAll: invalidateAllB,
      });

      invalidateAll();

      expect(invalidateAllB).toHaveBeenCalled();
    });

    it("invalidateFile is a no-op for plugins that don't declare it", () => {
      registerLanguagePlugin({
        id: "no-invalidate",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler(),
        // no invalidateFile
      });

      expect(() => invalidateFile("/some/file.ts")).not.toThrow();
    });

    it("invalidateAll is a no-op for plugins that don't declare it", () => {
      registerLanguagePlugin({
        id: "no-invalidate",
        supportsProject: () => true,
        createCompiler: async () => stubCompiler(),
        // no invalidateAll
      });

      expect(() => invalidateAll()).not.toThrow();
    });

    it("built-in TS compiler invalidation still works alongside plugin invalidation", () => {
      const pluginInvalidate = vi.fn();
      registerLanguagePlugin({
        id: "test-plugin",
        supportsProject: () => false,
        createCompiler: async () => stubCompiler(),
        invalidateFile: pluginInvalidate,
      });

      // Should not throw — TS compiler invalidation + plugin invalidation both run
      expect(() => invalidateFile("/some/file.ts")).not.toThrow();
      expect(pluginInvalidate).toHaveBeenCalledWith("/some/file.ts");
    });
  });
});
