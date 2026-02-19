import * as fs from "node:fs";
import * as path from "node:path";

const cache = new Map<string, string | null>();

/**
 * Walk up from `startDir` looking for tsconfig.json.
 * Returns the absolute path if found, or null if not found before filesystem root.
 * Results are cached for the process lifetime.
 */
export function findTsConfig(startDir: string): string | null {
  const normalised = path.resolve(startDir);

  if (cache.has(normalised)) {
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
