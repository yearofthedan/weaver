/** Source file extensions for a plain TypeScript/JavaScript project. */
export const TS_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
]);

/** Source file extensions for a Vue project (superset of TS_EXTENSIONS). */
export const VUE_EXTENSIONS: ReadonlySet<string> = new Set([...TS_EXTENSIONS, ".vue"]);

/**
 * Extensions an engine can answer a type-error query for. `.js`/`.jsx` are
 * excluded because whether they are checkable depends on `allowJs`.
 */
export const TYPECHECK_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".mts", ".cts"]);

/**
 * Maps each JS-family extension to its TypeScript counterpart.
 * Used by the import-rewrite fallback to match specifiers that use `.js`
 * extensions against the moved `.ts` source file.
 */
export const JS_TS_PAIRS: ReadonlyArray<[string, string]> = [
  [".js", ".ts"],
  [".jsx", ".tsx"],
  [".mjs", ".mts"],
  [".cjs", ".cts"],
];

/** The set of JS-family extensions derived from JS_TS_PAIRS. */
export const JS_EXTENSIONS: ReadonlySet<string> = new Set(JS_TS_PAIRS.map(([js]) => js));

/** Strips a TS/JS source file extension from a path, leaving the bare stem. */
export function stripExt(filePath: string): string {
  return filePath.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}
