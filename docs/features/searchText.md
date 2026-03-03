# Feature: searchText

**Purpose:** Find where a text pattern appears across the workspace — returns structured matches that feed directly into `replaceText`'s surgical edit mode.

Enforces workspace boundaries, skips sensitive files automatically, and provides machine-readable output without parsing.

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

Response:

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
        { "line": 12, "text": "  return calculateTotal(items);", "isMatch": true }
      ]
    }
  ],
  "truncated": false
}
```

`line` and `col` are 1-based. When `truncated` is true, narrow the search with a more specific pattern or glob. Default cap is 500 matches; pass `maxResults` to adjust.

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  ▼ searchText() (src/operations/searchText.ts)
  │   ├─ validate pattern with safe-regex2 — reject catastrophic-backtracking patterns (REDOS)
  │   ├─ file discovery
  │   │     git ls-files --cached --others --exclude-standard (respects .gitignore)
  │   │     fallback: recursive readdir skipping SKIP_DIRS (non-git workspaces)
  │   │     apply glob filter; skip binary files (null-byte check on first 512 bytes)
  │   │     skip sensitive files via isSensitiveFile()
  │   └─ per-file: split into lines, apply regex per line, collect matches + context lines
  ▼ result { ok, matches[], truncated }
```

## Security

- All searched files are within the workspace root. `git ls-files` is run with `cwd` set to the workspace; the recursive fallback only descends from the workspace root.
- Sensitive files are skipped via `isSensitiveFile()` — `.env`, private keys, certificates, and similar files are never read.
- Symlinks that resolve outside the workspace are included by `git ls-files` but their content is still read from disk (the resolved path). Workspace boundary is enforced at the file-discovery level, not per-byte.
- ReDoS protection: `safe-regex2` rejects star-height > 1 patterns before execution.

See [security.md](../security.md) for the full threat model.

## Constraints

- Pattern is ECMAScript regex syntax, not PCRE. Named groups and lookbehinds work; atomic groups and possessive quantifiers do not.
- Matches are found per-line — multi-line patterns (matching across `\n`) are not supported.
- The glob filter is a simplified subset — `{a,b}` alternation and `[abc]` character classes in the glob are not supported (regex character classes in the *pattern* are fine).
- No `--fixed-string` mode; literal dots, brackets, etc. in the pattern must be escaped.
- Binary files are skipped automatically.
- Sensitive files are skipped automatically.

## Technical decisions

**Why `git ls-files` instead of a recursive walk?**
`git ls-files --cached --others --exclude-standard` gives the exact set of files a developer would expect searched — it respects `.gitignore`, includes untracked-but-not-ignored files, and is fast even in large repos. The recursive fallback exists for non-git workspaces.

**Why per-line matching instead of whole-file regex?**
Per-line matching makes context lines trivial to compute (just index into the lines array) and keeps memory bounded. Whole-file regex with `m` flag would enable multi-line patterns but would complicate match-to-line-number mapping and context extraction.

**Why `safe-regex2` for ReDoS detection?**
An agent-supplied pattern runs against every file in the workspace. A catastrophic-backtracking pattern could lock the daemon for minutes. `safe-regex2` rejects star-height > 1 patterns before execution.
