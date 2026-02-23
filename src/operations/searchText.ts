import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import safeRegex from "safe-regex2";
import { isSensitiveFile } from "../security.js";
import type { ContextLine, SearchMatch, SearchTextResult } from "../types.js";
import { EngineError } from "../utils/errors.js";
import { SKIP_DIRS } from "../utils/file-walk.js";

const DEFAULT_MAX_RESULTS = 500;

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

/**
 * Enumerate all text files in the workspace, optionally filtered by a glob.
 * Uses `git ls-files` when available (respects .gitignore); falls back to a
 * recursive readdir that skips SKIP_DIRS.
 */
export function walkWorkspaceFiles(workspace: string, glob?: string): string[] {
  const globRe = glob ? globToRegex(glob) : null;

  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: workspace,
    encoding: "utf8",
  });

  let files: string[];
  if (result.status === 0) {
    files = result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => path.join(workspace, line));
  } else {
    files = walkRecursive(workspace);
  }

  if (globRe) {
    files = files.filter((f) => {
      const rel = path.relative(workspace, f).split(path.sep).join("/");
      return globRe.test(rel);
    });
  }

  return files;
}

function walkRecursive(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/** Return true if the buffer appears to be binary (contains a null byte). */
function isBinaryBuffer(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Search for a regex pattern across all text files in the workspace.
 *
 * @param pattern - ECMAScript regex pattern string
 * @param workspace - absolute path to the workspace root
 * @param opts.glob - optional glob to restrict which files are searched
 * @param opts.context - lines of context before and after each match (like grep -C)
 * @param opts.maxResults - cap on total matches returned (default 500)
 */
export async function searchText(
  pattern: string,
  workspace: string,
  opts: { glob?: string; context?: number; maxResults?: number } = {},
): Promise<SearchTextResult> {
  const { glob, context = 0, maxResults = DEFAULT_MAX_RESULTS } = opts;

  let re: RegExp;
  try {
    re = new RegExp(pattern, "g");
  } catch {
    throw new EngineError(`Invalid regex pattern: ${pattern}`, "PARSE_ERROR");
  }
  if (!safeRegex(re)) {
    throw new EngineError(
      `Pattern rejected: potential ReDoS (catastrophic backtracking): ${pattern}`,
      "REDOS",
    );
  }

  const files = walkWorkspaceFiles(workspace, glob);
  const matches: SearchMatch[] = [];
  let truncated = false;

  outer: for (const filePath of files) {
    if (isSensitiveFile(filePath)) continue;

    let raw: Buffer;
    try {
      raw = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (isBinaryBuffer(raw)) continue;

    const content = raw.toString("utf8");
    const lines = content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx];
      // Reset lastIndex for each line (the regex has the `g` flag)
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop idiom
      while ((m = re.exec(lineText)) !== null) {
        const lineNum = lineIdx + 1; // 1-based
        const colNum = m.index + 1; // 1-based

        // Build context lines
        const contextLines: ContextLine[] = [];
        if (context > 0) {
          const start = Math.max(0, lineIdx - context);
          const end = Math.min(lines.length - 1, lineIdx + context);
          for (let ci = start; ci <= end; ci++) {
            contextLines.push({
              line: ci + 1,
              text: lines[ci],
              isMatch: ci === lineIdx,
            });
          }
        }

        matches.push({
          file: filePath,
          line: lineNum,
          col: colNum,
          matchText: m[0],
          context: contextLines,
        });

        if (matches.length >= maxResults) {
          truncated = true;
          break outer;
        }

        // Prevent infinite loop on zero-length matches
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }

  return { matches, truncated };
}
