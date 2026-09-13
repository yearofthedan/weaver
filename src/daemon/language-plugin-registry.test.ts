import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTest as test } from "../__testHelpers__/helpers.js";
import { WorkspaceScope } from "../domain/workspace-scope.js";
import { NodeFileSystem } from "../ports/node-filesystem.js";
import { TsMorphEngine } from "../ts-engine/engine.js";
import type { Engine, LanguagePlugin } from "../ts-engine/types.js";
import {
  clearLanguagePlugins,
  evictAllDiagnosticParses,
  invalidateAll,
  invalidateFile,
  makeRegistry,
  refreshProjectFile,
  registerLanguagePlugin,
} from "./language-plugin-registry.js";

const PROJECT_FILE = path.resolve("src/types.ts");
const WORKSPACE_ROOT = path.resolve(".");

function stubCompiler(tag = "stub"): Engine {
  return {
    resolveOffset: () => 0,
    getReferencesAtPosition: async () => null,
    getDefinitionAtPosition: async () => null,
    getFileReferences: async () => null,
    readFile: () => "",
    rename: async () => ({
      filesModified: [],
      filesSkipped: [],
      symbolName: "",
      newName: "",
      locationCount: 0,
      nameMatches: [],
    }),
    moveFile: async () => ({ oldPath: "", newPath: "" }),
    moveSymbol: async () => undefined,
    setExport: async () => ({ filesModified: [], filesSkipped: [], symbolName: "" }),
    moveDirectory: async () => ({ filesMoved: [] }),
    deleteFile: async () => ({ importRefsRemoved: 0 }),
    getTypeErrors: async () => ({
      diagnostics: [],
      errorCount: 0,
      truncated: false,
    }),
    extractFunction: async () => ({
      filesModified: [],
      filesSkipped: [],
      functionName: "",
      parameterCount: 0,
    }),
    refreshFile: () => {},
    handlesFileExtension: () => false,
    _tag: tag,
  } as Engine & { _tag: string };
}

describe("LanguagePluginRegistry", () => {
  beforeEach(() => {
    clearLanguagePlugins();
  });

  describe("plugin resolution via makeRegistry", () => {
    it("falls back to TsMorphEngine when no plugins are registered", async () => {
      const registry = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
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
      const registry = makeRegistry("/tmp/no-tsconfig/file.ts", "/tmp/no-tsconfig");
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(TsMorphEngine);
    });

    it("falls back to TsMorphEngine when filePath is undefined and workspaceRoot has no tsconfig", async () => {
      registerLanguagePlugin({
        id: "never-consulted-no-file",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler("should-not-appear"),
      });
      // No file at all — resolution falls back to workspaceRoot, which has no tsconfig either
      const registry = makeRegistry(undefined, "/tmp/no-tsconfig-workspace");
      const compiler = await registry.projectEngine();
      expect(compiler).toBeInstanceOf(TsMorphEngine);
    });

    it("falls back to TsMorphEngine when no plugin matches the project", async () => {
      registerLanguagePlugin({
        id: "never-matches",
        supportsProject: () => false,
        createEngine: async (_tsEngine) => stubCompiler("never"),
      });

      const registry = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
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

      const registry = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
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

      const registry = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
      const compiler = (await registry.projectEngine()) as Engine & { _tag: string };
      expect(compiler._tag).toBe("yes");
    });

    it("caches the engine from createEngine — does not call it twice for the same plugin", async () => {
      const factory = vi.fn(async (_tsEngine: TsMorphEngine) => stubCompiler("cached"));
      registerLanguagePlugin({
        id: "caching-test",
        supportsProject: () => true,
        createEngine: factory,
      });

      const r1 = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
      await r1.projectEngine();
      const r2 = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
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

      const registry = makeRegistry(PROJECT_FILE, WORKSPACE_ROOT);
      await registry.projectEngine();

      expect(receivedEngine).toBeInstanceOf(TsMorphEngine);
    });

    it("answers two registries for the same project from one engine", async () => {
      // One engine per daemon: the drain, the watcher and idle eviction all reach the
      // singleton, so a second engine would leave every read reloading the project.
      const first = await makeRegistry(PROJECT_FILE, WORKSPACE_ROOT).projectEngine();
      const second = await makeRegistry(PROJECT_FILE, WORKSPACE_ROOT).projectEngine();

      expect(second).toBe(first);
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

  describe("evictAllDiagnosticParses", () => {
    it("does nothing when no engine has been loaded", () => {
      expect(() => evictAllDiagnosticParses()).not.toThrow();
    });

    it("does not clear plugin compiler caches", async () => {
      const factory = vi.fn(async (_tsEngine: TsMorphEngine) => stubCompiler("plugin"));
      registerLanguagePlugin({
        id: "eviction-scope-test",
        supportsProject: () => true,
        createEngine: factory,
      });

      await makeRegistry(PROJECT_FILE, WORKSPACE_ROOT).projectEngine();

      evictAllDiagnosticParses();

      await makeRegistry(PROJECT_FILE, WORKSPACE_ROOT).projectEngine();

      expect(factory).toHaveBeenCalledTimes(1);
    });

    test("makes the loaded engine's next diagnostic check read from disk", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
          },
          include: ["src"],
        }),
        "src/a.ts": "export const value: number = 1;\n",
      });
      const file = path.join(dir, "src/a.ts");
      const engine = await makeRegistry(file, dir).projectEngine();
      const scope = new WorkspaceScope(dir, new NodeFileSystem());

      expect((await engine.getTypeErrors(file, scope)).errorCount).toBe(0);

      fs.writeFileSync(file, 'export const value: number = "not a number";\n');
      evictAllDiagnosticParses();

      expect((await engine.getTypeErrors(file, scope)).errorCount).toBe(1);
    });
  });

  describe("clearLanguagePlugins", () => {
    it("drops the cached plugin engine, so the next resolution builds a new one", async () => {
      const factory = vi.fn(async (_tsEngine: TsMorphEngine) => stubCompiler("plugin"));
      const plugin: LanguagePlugin = {
        id: "clear-test",
        supportsProject: () => true,
        createEngine: factory,
      };

      registerLanguagePlugin(plugin);
      await makeRegistry(PROJECT_FILE, WORKSPACE_ROOT).projectEngine();

      clearLanguagePlugins();
      registerLanguagePlugin(plugin);
      await makeRegistry(PROJECT_FILE, WORKSPACE_ROOT).projectEngine();

      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  describe("refreshProjectFile", () => {
    it("does nothing when no engine has been loaded", () => {
      expect(() => refreshProjectFile("/some/file.ts")).not.toThrow();
    });

    it("does not reach plugin engines, which would rebuild Vue's whole service", () => {
      const pluginInvalidate = vi.fn();
      registerLanguagePlugin({
        id: "not-refreshed",
        supportsProject: () => true,
        createEngine: async (_tsEngine) => stubCompiler(),
        invalidateFile: pluginInvalidate,
      });

      refreshProjectFile("/some/file.ts");

      expect(pluginInvalidate).not.toHaveBeenCalled();
    });
    test("keeps the diagnostic program the post-write check built", async ({
      seedInlineFixture,
    }) => {
      const dir = await seedInlineFixture({
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
        "src/a.ts": "export const value: number = 1;\n",
      });
      const file = path.join(dir, "src/a.ts");
      const engine = await makeRegistry(file, dir).projectEngine();
      const scope = new WorkspaceScope(dir, new NodeFileSystem());
      expect((await engine.getTypeErrors(file, scope)).errorCount).toBe(0);

      fs.writeFileSync(file, 'export const value: number = "not a number";\n');
      refreshProjectFile(file);

      // Still the program built from the text on disk: evicting it here would make the next
      // check rebuild a program the write had no reason to invalidate.
      expect((await engine.getTypeErrors(file, scope)).errorCount).toBe(0);
    });
  });
});
