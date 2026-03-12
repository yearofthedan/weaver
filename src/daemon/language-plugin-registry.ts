import { createVueLanguagePlugin } from "../plugins/vue/plugin.js";
import type { LanguagePlugin, LanguageProvider, ProviderRegistry } from "../types.js";
import { findTsConfigForFile } from "../utils/ts-project.js";

const languagePlugins: LanguagePlugin[] = [];
const pluginProviders = new Map<string, LanguageProvider>();

let tsProviderSingleton: import("../compilers/ts.js").TsProvider | undefined;

async function getTsProvider(): Promise<import("../compilers/ts.js").TsProvider> {
  if (!tsProviderSingleton) {
    const { TsProvider } = await import("../compilers/ts.js");
    tsProviderSingleton = new TsProvider();
  }
  return tsProviderSingleton;
}

async function getPluginProvider(plugin: LanguagePlugin): Promise<LanguageProvider> {
  let provider = pluginProviders.get(plugin.id);
  if (!provider) {
    provider = await plugin.createProvider();
    pluginProviders.set(plugin.id, provider);
  }
  return provider;
}

export function registerLanguagePlugin(plugin: LanguagePlugin): void {
  languagePlugins.push(plugin);
}

/** Clear all registered plugins and cached providers. Exported for testing only. */
export function clearLanguagePlugins(): void {
  languagePlugins.length = 0;
  pluginProviders.clear();
}

/**
 * Create a `ProviderRegistry` scoped to the project containing `filePath`.
 * `projectProvider` iterates registered language plugins; first match wins,
 * with TsProvider as the default fallback.
 * `tsProvider` always returns TsProvider for AST-level operations (e.g. moveSymbol).
 */
export function makeRegistry(filePath: string): ProviderRegistry {
  return {
    async projectProvider(): Promise<LanguageProvider> {
      const tsConfigPath = findTsConfigForFile(filePath);
      if (tsConfigPath) {
        for (const plugin of languagePlugins) {
          if (plugin.supportsProject(tsConfigPath)) {
            return getPluginProvider(plugin);
          }
        }
      }
      return getTsProvider();
    },
    async tsProvider() {
      return getTsProvider();
    },
  };
}

/**
 * Refresh a single file in whichever provider(s) are loaded.
 * Called by the watcher on `change` events — cheaper than full rebuild.
 * Errors in individual plugins are caught so one failure doesn't block others.
 */
export function invalidateFile(filePath: string): void {
  tsProviderSingleton?.refreshFile(filePath);
  for (const plugin of languagePlugins) {
    try {
      plugin.invalidateFile?.(filePath);
    } catch {
      // Isolation: continue to other plugins even if one throws
    }
  }
}

/**
 * Drop all loaded providers so they rebuild lazily on the next request.
 * Called by the watcher on `add` and `unlink` events — structural changes
 * that require the full project graph to be refreshed.
 * Errors in individual plugins are caught so one failure doesn't block others.
 */
export function invalidateAll(): void {
  tsProviderSingleton = undefined;
  pluginProviders.clear();
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
