import { EngineError } from "../domain/errors.js";

/**
 * Maximum number of patterns produced by brace expansion. Enforced *during*
 * expansion so a `{a,b}{a,b}…` cartesian product throws before its array is
 * materialised, not after.
 */
const BRACE_EXPANSION_CAP = 256;

const GLOB_SYNTAX_HINT =
  "brace groups like {a,b} are supported; character classes [...], nested braces, and unbalanced braces are not";

function invalidGlob(glob: string, detail: string): EngineError {
  return new EngineError(`Unsupported glob syntax: "${glob}" (${detail})`, "INVALID_GLOB");
}

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
  const regexes = expandBraces(glob).map(globToRegex);
  return (relPath: string) => regexes.some((re) => re.test(relPath));
}

/**
 * Throw INVALID_GLOB for syntax compileGlob cannot honour.
 * Rejects: character classes [...], nested braces, unbalanced braces.
 */
function validateGlob(glob: string): void {
  if (glob.includes("[")) throw invalidGlob(glob, GLOB_SYNTAX_HINT);

  // Single pass catches both nesting (depth > 1) and imbalance (depth < 0 or
  // a non-zero final depth).
  let depth = 0;
  for (const ch of glob) {
    if (ch === "{") {
      if (++depth > 1) throw invalidGlob(glob, GLOB_SYNTAX_HINT);
    } else if (ch === "}") {
      if (depth === 0) throw invalidGlob(glob, GLOB_SYNTAX_HINT);
      depth--;
    }
  }
  if (depth !== 0) throw invalidGlob(glob, GLOB_SYNTAX_HINT);
}

/**
 * Expand all brace groups in a glob into a list of plain glob strings via
 * textual cartesian product. A glob with no braces returns `[glob]`.
 *
 * Precondition: `validateGlob` has accepted `glob`, so braces are balanced and
 * non-nested — every `{` has a matching `}` after it at the same depth.
 */
function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  if (open === -1) return [glob];

  // validateGlob guarantees a matching close exists for the first open brace.
  const close = glob.indexOf("}", open);
  const prefix = glob.slice(0, open);
  const alts = glob.slice(open + 1, close).split(",");

  const suffixExpanded = expandBraces(glob.slice(close + 1));

  // Check before building so a blow-up throws instead of allocating the array.
  if (alts.length * suffixExpanded.length > BRACE_EXPANSION_CAP) {
    throw invalidGlob(glob, `brace expansion exceeds the limit of ${BRACE_EXPANSION_CAP} patterns`);
  }

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
