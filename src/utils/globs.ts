/**
 * Convert a glob pattern to a RegExp matched against a relative file path.
 *
 * Supported: `*` (non-slash wildcard), `**` (multi-segment wildcard), `?` (single char).
 * Patterns without a `/` are matched against the basename only.
 */
export function globToRegex(pattern: string): RegExp {
  // No separator → match against basename only by prepending **/
  const p = pattern.includes("/") ? pattern : `**/${pattern}`;

  // Split on ** first to avoid treating its * characters as single-segment wildcards.
  const reStr = p
    .split("**")
    .map(
      (part) =>
        part
          .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`) // escape regex specials
          .replace(/\*/g, "[^/]*") // * → non-slash run
          .replace(/\?/g, "[^/]"), // ? → single non-slash char
    )
    .join(".*"); // ** → match any path segments

  return new RegExp(`^${reStr}$`);
}
