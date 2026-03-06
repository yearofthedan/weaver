import * as path from "node:path";

/**
 * Strip the TypeScript source extension from `absPath` and return a
 * `./`-prefixed relative specifier base from `fromDir`.
 *
 * Used by the import-rewrite fallback scan to compute the bare specifier that
 * would appear in an import statement before any extension suffix.
 */
export function toRelBase(fromDir: string, absPath: string): string {
  const stripped = absPath.replace(/\.(ts|tsx|mts|cts)$/, "");
  const r = path.relative(fromDir, stripped);
  return r.startsWith(".") ? r : `./${r}`;
}

/**
 * Compute a relative import specifier from `fromFile` to `toFile`.
 *
 * TypeScript source extensions are replaced with their runtime equivalents
 * (.ts/.tsx/.jsx → .js, .mts → .mjs, .cts → .cjs). JavaScript and all other
 * extensions are left unchanged. The result always starts with `./` or `../`.
 *
 * Generated imports use explicit extensions rather than bare specifiers so the
 * output is valid under `moduleResolution: nodenext` as well as bundler-mode
 * projects. If your project enforces bare specifiers via lint rules, run your
 * linter/formatter after this operation.
 */
export function computeRelativeImportPath(fromFile: string, toFile: string): string {
  let rel = path
    .relative(path.dirname(fromFile), toFile)
    .replace(/\.(ts|tsx|jsx)$/, ".js")
    .replace(/\.mts$/, ".mjs")
    .replace(/\.cts$/, ".cjs");
  rel = rel.replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}
