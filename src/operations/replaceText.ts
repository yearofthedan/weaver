import * as path from "node:path";
import safeRegex from "safe-regex2";
import type { WorkspaceScope } from "../domain/workspace-scope.js";
import { isSensitiveFile } from "../security.js";
import { EngineError } from "../utils/errors.js";
import { walkWorkspaceFiles } from "./searchText.js";
import type { ReplaceTextResult, TextEdit } from "./types.js";

/**
 * Replace text across workspace files. Two modes:
 *
 * **Pattern mode** (`pattern` + `replacement`): applies a regex replace-all
 * across all files in the workspace, optionally filtered by `glob`.
 * `replacement` may use `$1`, `$2`, etc. for capture group backreferences.
 *
 * **Surgical mode** (`edits` array): applies each `{file, line, col, oldText,
 * newText}` edit atomically. `oldText` is verified at the given position before
 * writing — throws `TEXT_MISMATCH` if it doesn't match.
 *
 * Both modes enforce the workspace boundary and skip sensitive files.
 */
export async function replaceText(
  scope: WorkspaceScope,
  opts: {
    pattern?: string;
    replacement?: string;
    glob?: string;
    edits?: TextEdit[];
  },
): Promise<ReplaceTextResult> {
  const { pattern, replacement, glob, edits } = opts;

  if (edits !== undefined) {
    return applySurgicalEdits(scope, edits);
  }

  if (pattern !== undefined && replacement !== undefined) {
    return applyPatternReplace(scope, pattern, replacement, glob);
  }

  // Zod's refine() in ReplaceTextArgsSchema catches this at the protocol boundary;
  // this guard is a second line of defence for callers that bypass the schema (e.g. tests).
  throw new EngineError(
    "replaceText requires either 'pattern'+'replacement' or 'edits'",
    "VALIDATION_ERROR",
  );
}

// ─── Pattern mode ────────────────────────────────────────────────────────────

function applyPatternReplace(
  scope: WorkspaceScope,
  pattern: string,
  replacement: string,
  glob?: string,
): ReplaceTextResult {
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
  let replacementCount = 0;

  for (const filePath of files) {
    // Symlinks in git-tracked files can resolve outside the workspace —
    // scope.contains() re-checks via realpathSync to catch this case.
    if (!scope.contains(filePath)) continue;
    if (isSensitiveFile(filePath)) continue;

    let content: string;
    try {
      content = scope.fs.readFile(filePath);
    } catch {
      continue;
    }

    // Count matches first (resets lastIndex after)
    re.lastIndex = 0;
    const hits = content.match(re);
    if (!hits || hits.length === 0) continue;

    // String-form replacement preserves $1, $2, etc. backreferences
    re.lastIndex = 0;
    const updated = content.replace(re, replacement);

    if (updated !== content) {
      scope.writeFile(filePath, updated);
      replacementCount += hits.length;
    }
  }

  return { filesModified: scope.modified, replacementCount };
}

// ─── Surgical mode ────────────────────────────────────────────────────────────

function applySurgicalEdits(scope: WorkspaceScope, edits: TextEdit[]): ReplaceTextResult {
  // Validate all inputs up front before touching any file
  for (const edit of edits) {
    const abs = path.resolve(edit.file);
    if (!scope.contains(abs)) {
      throw new EngineError(`file is outside the workspace: ${edit.file}`, "WORKSPACE_VIOLATION");
    }
    if (isSensitiveFile(abs)) {
      throw new EngineError(
        `file is sensitive and cannot be modified: ${edit.file}`,
        "SENSITIVE_FILE",
      );
    }
  }

  // Group edits by file
  const byFile = new Map<string, TextEdit[]>();
  for (const edit of edits) {
    const abs = path.resolve(edit.file);
    const group = byFile.get(abs);
    if (group) {
      group.push({ ...edit, file: abs });
    } else {
      byFile.set(abs, [{ ...edit, file: abs }]);
    }
  }

  let replacementCount = 0;

  for (const [filePath, fileEdits] of byFile) {
    let content = scope.fs.readFile(filePath);
    const lines = content.split("\n");

    // Sort edits by position descending (last → first) so earlier offsets
    // stay valid as we apply each change.
    const sorted = [...fileEdits].sort((a, b) => {
      if (b.line !== a.line) return b.line - a.line;
      return b.col - a.col;
    });

    for (const edit of sorted) {
      // Convert 1-based (line, col) to 0-based offset into `content`
      const lineIdx = edit.line - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) {
        throw new EngineError(`Line ${edit.line} is out of range in ${filePath}`, "TEXT_MISMATCH");
      }
      const offset =
        lines.slice(0, lineIdx).reduce((sum, l) => sum + l.length + 1, 0) + (edit.col - 1);
      const actual = content.slice(offset, offset + edit.oldText.length);
      if (actual !== edit.oldText) {
        throw new EngineError(
          `Text mismatch at ${filePath}:${edit.line}:${edit.col} — expected "${edit.oldText}", found "${actual}"`,
          "TEXT_MISMATCH",
        );
      }
      content =
        content.slice(0, offset) + edit.newText + content.slice(offset + edit.oldText.length);
      replacementCount++;
    }

    scope.writeFile(filePath, content);
  }

  return { filesModified: scope.modified, replacementCount };
}
