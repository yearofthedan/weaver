import { EngineError } from "../domain/errors.js";

/**
 * Maximum number of patterns produced by brace expansion before compileGlob
 * throws INVALID_GLOB. Prevents {a,b}{a,b}… cartesian-product DoS.
 */
const BRACE_EXPANSION_CAP = 256;

/**
 * Validate and compile a user-supplied glob into a predicate over relative
 * paths. Supports `*`, `**`, `?`, and brace groups like `{ts,js}`.
 *
 * Throws `INVALID_GLOB` for:
 * - Character classes `[…]`
 * - Nested braces `{…{…}…}`
 * - Unbalanced braces
 * - Expansions exceeding BRACE_EXPANSION_CAP
 */
export function compileGlob(glob: string): (relPath: string) => boolean {
  validateGlob(glob);
  const patterns = expandBraces(glob);
  if (patterns.length > BRACE_EXPANSION_CAP) {
    throw new EngineError(
      `Unsupported glob syntax: "${glob}" (brace expansion produces ${patterns.length} patterns, which exceeds the limit of ${BRACE_EXPANSION_CAP})`,
      "INVALID_GLOB",
    );
  }
  const regexes = patterns.map(globToRegex);
  return (relPath: string) => regexes.some((re) => re.test(relPath));
}

/**
 * Throw INVALID_GLOB for syntax compileGlob cannot honour.
 * Rejects: character classes [...], nested braces, unbalanced braces.
 */
function validateGlob(glob: string): void {
  if (glob.includes("[")) {
    throw new EngineError(
      `Unsupported glob syntax: "${glob}" (brace groups like {a,b} are supported; character classes [...], nested braces, and over-large expansions are not)`,
      "INVALID_GLOB",
    );
  }

  // Check for nested braces and unbalanced braces in a single pass
  let depth = 0;
  for (const ch of glob) {
    if (ch === "{") {
      depth++;
      if (depth > 1) {
        throw new EngineError(
          `Unsupported glob syntax: "${glob}" (brace groups like {a,b} are supported; character classes [...], nested braces, and over-large expansions are not)`,
          "INVALID_GLOB",
        );
      }
    } else if (ch === "}") {
      if (depth === 0) {
        throw new EngineError(
          `Unsupported glob syntax: "${glob}" (brace groups like {a,b} are supported; character classes [...], nested braces, and over-large expansions are not)`,
          "INVALID_GLOB",
        );
      }
      depth--;
    }
  }
  if (depth !== 0) {
    throw new EngineError(
      `Unsupported glob syntax: "${glob}" (brace groups like {a,b} are supported; character classes [...], nested braces, and over-large expansions are not)`,
      "INVALID_GLOB",
    );
  }
}

/**
 * Expand all brace groups in a glob into a list of plain glob strings via
 * textual cartesian product. A glob with no braces returns `[glob]`.
 */
function expandBraces(glob: string): string[] {
  // Find the first `{...}` group
  const open = glob.indexOf("{");
  if (open === -1) return [glob];

  const close = glob.indexOf("}", open);
  // validateGlob already guarantees balanced braces, but guard defensively
  if (close === -1) return [glob];

  const prefix = glob.slice(0, open);
  const suffix = glob.slice(close + 1);
  const alts = glob.slice(open + 1, close).split(",");

  // Recursively expand the suffix to handle multiple brace groups (cartesian product)
  const suffixExpanded = expandBraces(suffix);

  const result: string[] = [];
  for (const alt of alts) {
    for (const sfx of suffixExpanded) {
      result.push(`${prefix}${alt}${sfx}`);
    }
  }
  return result;
}

/**
 * Convert a glob pattern to a RegExp matched against a relative file path.
 *
 * Supported: `*` (non-slash wildcard), `**` (multi-segment wildcard), `?` (single char).
 * Patterns without a `/` are matched against the basename only.
 */
export function globToRegex(pattern: string): RegExp {
  // No separator → match against basename only by prepending **/
  const p = pattern.includes("/") ? pattern : `**/${pattern}`;

  // Build the regex string segment-by-segment. Split on `**` so we can handle
  // the surrounding `/` characters correctly for each `**` occurrence.
  //
  // The key insight: `**` should match zero-or-more path segments. The adjacent
  // `/` characters must be made optional so that root-level files and direct
  // children of named directories are reachable.
  //
  //   /**/   (between two slashes)  →  (/.*)?/   e.g. eval/**/x  matches eval/x
  //   **/    (pattern start)        →  (.*/)?    e.g. **/*.ts  matches foo.ts
  //   /**    (pattern end)          →  (/.*)?    e.g. foo/**  matches foo/bar
  //   **     (no adjacent slashes)  →  .*        matches anything
  const parts = p.split("**");

  const escapePart = (part: string) =>
    part
      .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`) // escape regex specials
      .replace(/\*/g, "[^/]*") // * → non-slash run
      .replace(/\?/g, "[^/]"); // ? → single non-slash char

  let reStr = escapePart(parts[0]);

  for (let i = 1; i < parts.length; i++) {
    const left = reStr;
    const right = escapePart(parts[i]);

    const leftEndsSlash = left.endsWith("/");
    const rightStartsSlash = right.startsWith("/");

    if (leftEndsSlash && rightStartsSlash) {
      // dir/**/file — strip the surrounding slashes and use optional middle
      reStr = `${left.slice(0, -1)}(/.*)?/${right.slice(1)}`;
    } else if (!leftEndsSlash && rightStartsSlash) {
      // **/file — optional prefix (left is empty or lacks trailing slash)
      reStr = `${left}(.*/)?${right.slice(1)}`;
    } else if (leftEndsSlash && !rightStartsSlash) {
      // dir/** — optional suffix
      reStr = `${left.slice(0, -1)}(/.*)?${right}`;
    } else {
      // bare ** with no adjacent slashes
      reStr = `${left}.*${right}`;
    }
  }

  return new RegExp(`^${reStr}$`);
}
