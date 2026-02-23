import * as path from "node:path";

/**
 * Compute a relative import specifier from `fromFile` to `toFile`.
 *
 * Strips the file extension, normalises Windows separators, and
 * ensures the result starts with `./` or `../`.
 */
export function computeRelativeImportPath(fromFile: string, toFile: string): string {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
  rel = rel.replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}
