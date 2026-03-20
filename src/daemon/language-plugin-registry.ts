import { createVueLanguagePlugin } from "../plugins/vue/plugin.js";
import type { Engine, EngineRegistry, LanguagePlugin } from "../ts-engine/types.js";
import { findTsConfigForFile } from "../utils/ts-project.js";

const languagePlugins: LanguagePlugin[] = [];
const pluginCompilers = new Map<string, Engine>();

let tsMorphCompilerSingleton: import("../ts-engine/engine.js").TsMorphEngine | undefined;

async function getTsMorphEngine(): Promise<import("../ts-engine/engine.js").TsMorphEngine> {
  if (!tsMorphCompilerSingleton) {
    const { TsMorphEngine } = await import("../ts-engine/engine.js");
    tsMorphCompilerSingleton = new TsMorphEngine();
  }
  return tsMorphCompilerSingleton;
}

async function getPluginCompiler(plugin: LanguagePlugin): Promise<Engine> {
  let compiler = pluginCompilers.get(plugin.id);
  if (!compiler) {
    compiler = await plugin.createCompiler();
    pluginCompilers.set(plugin.id, compiler);
  }
  return compiler;
}

export function registerLanguagePlugin(plugin: LanguagePlugin): void {
  languagePlugins.push(plugin);
}

/** Clear all registered plugins and cached compilers. Exported for testing only. */
export function clearLanguagePlugins(): void {
  languagePlugins.length = 0;
  pluginCompilers.clear();
}

/**
 * Create a `CompilerRegistry` scoped to the project containing `filePath`.
 * `projectCompiler` iterates registered language plugins; first match wins,
 * with TsMorphEngine as the default fallback.
 * `tsCompiler` always returns TsMorphEngine for AST-level operations (e.g. moveSymbol).
 */
export function makeRegistry(filePath: string): EngineRegistry {
  return {
    async projectCompiler(): Promise<Engine> {
      const tsConfigPath = findTsConfigForFile(filePath);
      if (tsConfigPath) {
        for (const plugin of languagePlugins) {
          if (plugin.supportsProject(tsConfigPath)) {
            return getPluginCompiler(plugin);
          }
        }
      }
      return getTsMorphEngine();
    },
    async tsCompiler() {
      return getTsMorphEngine();
    },
  };
}

/**
 * Refresh a single file in whichever compiler(s) are loaded.
 * Called by the watcher on `change` events — cheaper than full rebuild.
 * Errors in individual plugins are caught so one failure doesn't block others.
 */
export function invalidateFile(filePath: string): void {
  tsMorphCompilerSingleton?.refreshFile(filePath);
  for (const plugin of languagePlugins) {
    try {
      plugin.invalidateFile?.(filePath);
    } catch {
      // Isolation: continue to other plugins even if one throws
    }
  }
}

/**
 * Drop all loaded compilers so they rebuild lazily on the next request.
 * Called by the watcher on `add` and `unlink` events — structural changes
 * that require the full project graph to be refreshed.
 * Errors in individual plugins are caught so one failure doesn't block others.
 */
export function invalidateAll(): void {
  tsMorphCompilerSingleton = undefined;
  pluginCompilers.clear();
  for (const plugin of languagePlugins) {
    try {
      plugin.invalidateAll?.();
    } catch {
      // Isolation: continue to other plugins even if one throws
    }
  }
}

// Register built-in plugins
registerLanguagePlugin(createVueLanguagePlugin());
