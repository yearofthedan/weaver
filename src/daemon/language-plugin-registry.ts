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
 *
 * `explicitTsConfig`, when given, names the tsconfig to select the engine for directly —
 * it wins over both the `filePath` and `workspaceRoot` discovery routes, since a caller
 * that named a tsconfig (e.g. `getTypeErrors`'s `tsconfig` param) wants *that* config's
 * engine, not whatever the workspace root happens to discover.
 */
export function makeRegistry(
  filePath: string | undefined,
  workspaceRoot: string,
  explicitTsConfig?: string,
): EngineRegistry {
  return {
    async projectEngine(): Promise<Engine> {
      const tsConfigPath =
        explicitTsConfig ??
        (filePath ? findTsConfigForFile(filePath) : findTsConfig(workspaceRoot));
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
      // Optional hook; the catch below absorbs a plugin that omits it.
      plugin.invalidateFile?.(filePath);
    } catch {
      // Isolation: continue to other plugins even if one throws
    }
  }
}

/**
 * Re-read one file into every loaded engine, without discarding what that engine
 * holds around it. Called for every path a dispatch wrote, once that operation
 * has returned and holds no nodes into the project.
 *
 * Each engine recognises the paths it holds and refreshes those; an engine that
 * has not been loaded is skipped, so a read-only dispatch builds no service.
 */
export function refreshWrittenFile(filePath: string): void {
  for (const engine of [tsMorphEngineSingleton, ...pluginCompilers.values()]) {
    try {
      engine?.refreshWrittenFile(filePath);
    } catch {
      // Isolation: continue to other engines even if one throws
    }
  }
}

/**
 * Drop one file's retained diagnostic parse in the ts-morph engine, if it is
 * loaded. Called for every source file the daemon writes, so a later check
 * cannot be answered from the text that was there before the write.
 */
export function evictDiagnosticParse(filePath: string): void {
  tsMorphEngineSingleton?.evictDiagnosticParse(filePath);
}

/**
 * Drop every diagnostic service and parse in the ts-morph engine, if it is
 * loaded. Plugin engines are not touched — only `tsMorphEngineSingleton`.
 */
export function evictAllDiagnosticParses(): void {
  tsMorphEngineSingleton?.evictAllDiagnosticParses();
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
      // Optional hook; the catch below absorbs a plugin that omits it, as in `invalidateFile`.
      plugin.invalidateAll?.();
    } catch {
      // Isolation: continue to other plugins even if one throws
    }
  }
}

// Register built-in plugins
registerLanguagePlugin(createVueLanguagePlugin());
