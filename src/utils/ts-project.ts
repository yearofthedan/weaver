import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const cache = new Map<string, string | null>();

/**
 * Walk up from `startDir` looking for tsconfig.json.
 * Returns the absolute path if found, or null if not found before filesystem root.
 * Results are memoised; the memo is cleared at the start of each dispatched request via
 * resetDiscoveryCaches, so it is fresh within a dispatch but not guaranteed empty between
 * dispatches — watcher callbacks and refreshFile's own lookups can repopulate it while idle.
 */
export function findTsConfig(startDir: string): string | null {
  const normalised = path.resolve(startDir);

  if (cache.has(normalised)) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by .has() above
    return cache.get(normalised)!;
  }

  let dir = normalised;
  while (true) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) {
      cache.set(normalised, candidate);
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      cache.set(normalised, null);
      return null;
    }
    dir = parent;
  }
}

/** Cache key standing in for "no tsconfig above this file", which is not a path. */
const NO_TSCONFIG_CACHE_KEY = "__no_tsconfig__";

/**
 * Key for anything cached per tsconfig. Shared so the ts-morph project cache and
 * the diagnostic-service cache cannot drift apart on what "no tsconfig" means —
 * `TsMorphEngine.refreshFile` looks both up under the key this returns.
 */
export function tsConfigCacheKey(tsConfigPath: string | null): string {
  return tsConfigPath ?? NO_TSCONFIG_CACHE_KEY;
}

/**
 * Find tsconfig.json starting from the directory containing the given file.
 */
export function findTsConfigForFile(filePath: string): string | null {
  return findTsConfig(path.dirname(path.resolve(filePath)));
}

/**
 * Returns true if the project directory (rooted at the tsconfig location)
 * contains any .vue files. This is the signal that VueEngine should be used
 * for all operations, regardless of starting file extension.
 * Memoised per project root; the memo is cleared at the start of each dispatched request via
 * resetDiscoveryCaches, so it is fresh within a dispatch but not guaranteed empty between
 * dispatches — watcher callbacks and refreshFile's own lookups can repopulate it while idle.
 */
const vueProjectCache = new Map<string, boolean>();

export function isVueProject(tsConfigPath: string): boolean {
  const projectRoot = path.dirname(tsConfigPath);
  if (vueProjectCache.has(projectRoot)) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by .has() above
    return vueProjectCache.get(projectRoot)!;
  }
  const configJson = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configJson.config,
    ts.sys,
    projectRoot,
    undefined,
    tsConfigPath,
    undefined,
    [{ extension: ".vue", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }],
  );
  const hasVue = parsed.fileNames.some((f) => f.endsWith(".vue"));
  vueProjectCache.set(projectRoot, hasVue);
  return hasVue;
}

/**
 * Clears both discovery memos so the next lookup reads the filesystem again. Called once at the
 * start of each dispatched request — see the memo doc comments above for the freshness guarantee
 * this provides.
 */
export function resetDiscoveryCaches(): void {
  cache.clear();
  vueProjectCache.clear();
}
