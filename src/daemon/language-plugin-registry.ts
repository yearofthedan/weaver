import { createVueLanguagePlugin } from "../plugins/vue/plugin.js";
import type { Compiler, CompilerRegistry, LanguagePlugin } from "../types.js";
import { findTsConfigForFile } from "../utils/ts-project.js";

const languagePlugins: LanguagePlugin[] = [];
const pluginCompilers = new Map<string, Compiler>();

let tsMorphCompilerSingleton: import("../compilers/ts.js").TsMorphCompiler | undefined;

async function getTsMorphCompiler(): Promise<import("../compilers/ts.js").TsMorphCompiler> {
  if (!tsMorphCompilerSingleton) {
    const { TsMorphCompiler } = await import("../compilers/ts.js");
    tsMorphCompilerSingleton = new TsMorphCompiler();
  }
  return tsMorphCompilerSingleton;
}

async function getPluginCompiler(plugin: LanguagePlugin): Promise<Compiler> {
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
 * with TsMorphCompiler as the default fallback.
 * `tsCompiler` always returns TsMorphCompiler for AST-level operations (e.g. moveSymbol).
 */
export function makeRegistry(filePath: string): CompilerRegistry {
  return {
    async projectCompiler(): Promise<Compiler> {
      const tsConfigPath = findTsConfigForFile(filePath);
      if (tsConfigPath) {
        for (const plugin of languagePlugins) {
          if (plugin.supportsProject(tsConfigPath)) {
            return getPluginCompiler(plugin);
          }
        }
      }
      return getTsMorphCompiler();
    },
    async tsCompiler() {
      return getTsMorphCompiler();
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
