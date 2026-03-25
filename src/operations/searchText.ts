import safeRegex from "safe-regex2";
import { EngineError } from "../domain/errors.js";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { walkWorkspaceFiles } from "../utils/file-walk.js";
import { isSensitiveFile } from "../utils/sensitive-files.js";
import type { SearchMatch, SearchTextResult } from "./types.js";

const DEFAULT_MAX_RESULTS = 500;

/** Return true if the string content appears to be binary (contains a null character). */
function isBinaryContent(content: string): boolean {
  const checkLen = Math.min(content.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (content.charCodeAt(i) === 0) return true;
  }
  return false;
}

/**
 * Search for a regex pattern across all text files in the workspace.
 *
 * @param pattern - ECMAScript regex pattern string
 * @param scope - workspace scope used to resolve the root and read file content
 * @param opts.glob - optional glob to restrict which files are searched
 * @param opts.context - lines of context before and after each match (like grep -C)
 * @param opts.maxResults - cap on total matches returned (default 500)
 */
export async function searchText(
  pattern: string,
  scope: WorkspaceScope,
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

  const files = walkWorkspaceFiles(scope.root, glob);
  const matches: SearchMatch[] = [];
  let truncated = false;

  outer: for (const filePath of files) {
    if (isSensitiveFile(filePath)) continue;

    let content: string;
    try {
      content = scope.fs.readFile(filePath);
    } catch {
      scope.recordSkipped(filePath);
      continue;
    }
    if (isBinaryContent(content)) continue;

    // Split into lines; trim the trailing empty string that results from a
    // final newline (virtually all text files end with one).
    const rawLines = content.split("\n");
    const lines =
      rawLines.length > 0 && rawLines[rawLines.length - 1] === ""
        ? rawLines.slice(0, -1)
        : rawLines;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx];
      // Reset lastIndex for each line (the regex has the `g` flag)
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop idiom
      while ((m = re.exec(lineText)) !== null) {
        const lineNum = lineIdx + 1; // 1-based
        const colNum = m.index + 1; // 1-based

        const match: SearchMatch = {
          file: filePath,
          line: lineNum,
          col: colNum,
          matchText: m[0],
        };

        if (context > 0) {
          const start = Math.max(0, lineIdx - context);
          const end = Math.min(lines.length - 1, lineIdx + context);
          match.surroundingText = lines.slice(start, end + 1).join("\n");
        }

        matches.push(match);

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
