# Operation: searchText

## Why use this

Use `searchText` to find where a string literal, import path, configuration value, or any text pattern appears across the workspace. It returns structured JSON — file, line, col, matched text — that feeds directly into `replaceText`'s surgical edit mode. Unlike shell `grep`, it enforces workspace boundaries, skips sensitive files automatically, and returns machine-readable output an agent can act on without parsing.

## What it does

Searches all text files in the workspace for an ECMAScript regex pattern and returns match locations.

**MCP tool call:**

```json
{
  "name": "searchText",
  "arguments": {
    "pattern": "calculateTotal",
    "glob": "**/*.ts",
    "context": 2,
    "maxResults": 100
  }
}
```

**Response:**

```json
{
  "ok": true,
  "matches": [
    {
      "file": "/path/to/project/src/utils.ts",
      "line": 12,
      "col": 14,
      "matchText": "calculateTotal",
      "context": [
        { "line": 10, "text": "// Compute the order total", "isMatch": false },
        { "line": 11, "text": "export function calculateTotal(items: Item[]): number {", "isMatch": false },
        { "line": 12, "text": "  return calculateTotal(items);", "isMatch": true },
        { "line": 13, "text": "}", "isMatch": false },
        { "line": 14, "text": "", "isMatch": false }
      ]
    }
  ],
  "truncated": false
}
```

`line` and `col` are 1-based. When `truncated` is true, results were capped — narrow the search with a more specific pattern or glob.

## Key concepts

- **File discovery** uses `git ls-files` when available (respects `.gitignore`); falls back to recursive readdir that skips standard directories (`node_modules`, `.git`, etc.).
- **Glob filtering** supports `*`, `**`, and `?`. Patterns without a `/` match against the basename only (e.g. `*.ts` matches any `.ts` file at any depth).
- **ReDoS protection** — patterns are checked with `safe-regex2` before execution. Patterns with catastrophic backtracking potential are rejected with `REDOS`.
- **Binary files** are skipped automatically (detected by null-byte check on the first 512 bytes).
- **Default cap** is 500 matches. Pass `maxResults` to adjust.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| Any text file in the workspace | Yes |
| Binary files | Skipped automatically |
| Sensitive files (`.env`, keys, certs) | Skipped automatically |

## Constraints & limitations

- Pattern is ECMAScript regex syntax, not PCRE. Named groups and lookbehinds work; atomic groups and possessive quantifiers do not.
- Matches are found per-line. Multi-line patterns (matching across `\n`) are not supported.
- The glob filter is a simplified subset — `{a,b}` alternation and `[abc]` character classes in the glob itself are not supported (regex character classes in the *pattern* are fine).
- No `--fixed-string` mode; literal dots, brackets, etc. in the pattern must be escaped.

## Security & workspace boundary

- All searched files are within the workspace root. `git ls-files` is run with `cwd` set to the workspace; the recursive fallback only descends from the workspace root.
- Sensitive files are skipped via `isSensitiveFile()` — `.env`, private keys, certificates, and similar files are never read.
- Symlinks that resolve outside the workspace are included by `git ls-files` but their content is still read from disk (the resolved path). Workspace boundary is enforced at the file-discovery level, not per-byte.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why `git ls-files` instead of a recursive walk?**
`git ls-files --cached --others --exclude-standard` gives the exact set of files a developer would expect searched — it respects `.gitignore`, includes untracked-but-not-ignored files, and is fast even in large repos. The recursive fallback exists for non-git workspaces.

**Why per-line matching instead of whole-file regex?**
Per-line matching makes context lines trivial to compute (just index into the lines array) and keeps memory bounded. Whole-file regex with `m` flag would enable multi-line patterns but would complicate match-to-line-number mapping and context extraction.

**Why `safe-regex2` for ReDoS detection?**
An agent-supplied pattern runs against every file in the workspace. A catastrophic-backtracking pattern could lock the daemon for minutes. `safe-regex2` rejects star-height > 1 patterns before execution.
