import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const cache = new Map<string, string | null>();

/**
 * Walk up from `startDir` looking for tsconfig.json.
 * Returns the absolute path if found, or null if not found before filesystem root.
 * Results are cached for the process lifetime.
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
 * Cached per project root for the process lifetime.
 */
const vueProjectCache = new Map<string, boolean>();

export function isVueProject(tsConfigPath: string): boolean {
  const projectRoot = path.dirname(tsConfigPath);
  if (vueProjectCache.has(projectRoot)) {
    // biome-ignore lint/style/noNonNullAssertion: guarded by .has() above
    return vueProjectCache.get(projectRoot)!;
  }
  const vueFiles = ts.sys.readDirectory(projectRoot, [".vue"], [], [], 1000);
  const hasVue = vueFiles.length > 0;
  vueProjectCache.set(projectRoot, hasVue);
  return hasVue;
}
