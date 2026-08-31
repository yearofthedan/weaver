import { createVueLanguagePlugin } from "../plugins/vue/plugin.js";
import type { Engine, EngineRegistry, LanguagePlugin } from "../ts-engine/types.js";
import { findTsConfig, findTsConfigForFile } from "../utils/ts-project.js";

const languagePlugins: LanguagePlugin[] = [];
const pluginCompilers = new Map<string, Engine>();

let tsMorphEngineSingleton: import("../ts-engine/engine.js").TsMorphEngine | undefined;

async function getTsMorphEngine(
  workspaceRoot: string,
): Promise<import("../ts-engine/engine.js").TsMorphEngine> {
  if (!tsMorphEngineSingleton) {
    const { TsMorphEngine } = await import("../ts-engine/engine.js");
    tsMorphEngineSingleton = new TsMorphEngine(workspaceRoot);
  }
  return tsMorphEngineSingleton;
}

async function getPluginEngine(plugin: LanguagePlugin, workspaceRoot: string): Promise<Engine> {
  let engine = pluginCompilers.get(plugin.id);
  if (!engine) {
    const tsEngine = await getTsMorphEngine(workspaceRoot);
    engine = await plugin.createEngine(tsEngine, workspaceRoot);
    pluginCompilers.set(plugin.id, engine);
  }
  return engine;
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
 * Create an `EngineRegistry` scoped to the project containing `filePath`.
 * `projectEngine` iterates registered language plugins; first match wins,
 * with TsMorphEngine as the default fallback.
 *
 * `filePath` may be `undefined` for operations with no specific target file (e.g. a
 * project-wide `getTypeErrors`). In that case the tsconfig lookup starts from
 * `workspaceRoot` itself via `findTsConfig` — `findTsConfigForFile` assumes its argument
 * is a file and strips a directory level, so passing it a directory (or the workspace root
 * standing in for "no file") searches one level too high and can miss the tsconfig.
 */
export function makeRegistry(filePath: string | undefined, workspaceRoot: string): EngineRegistry {
  return {
    async projectEngine(): Promise<Engine> {
      const tsConfigPath = filePath ? findTsConfigForFile(filePath) : findTsConfig(workspaceRoot);
      if (tsConfigPath) {
        for (const plugin of languagePlugins) {
          if (plugin.supportsProject(tsConfigPath)) {
            return getPluginEngine(plugin, workspaceRoot);
          }
        }
      }
      return getTsMorphEngine(workspaceRoot);
    },
  };
}

/**
 * Refresh a single file in whichever compiler(s) are loaded.
 * Called by the watcher on `change` events — cheaper than full rebuild.
 * Errors in individual plugins are caught so one failure doesn't block others.
 */
export function invalidateFile(filePath: string): void {
  tsMorphEngineSingleton?.refreshFile(filePath);
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
  tsMorphEngineSingleton = undefined;
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
