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
