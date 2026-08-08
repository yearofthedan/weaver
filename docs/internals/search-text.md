# Internals: search-text

User-facing reference: [docs/commands/search-text.md](../commands/search-text.md).

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
  │   │     apply glob filter, then excludeGlob filter
  │   │     skip sensitive files via isSensitiveFile(), then skip binary files (null-byte check on first 512 bytes)
  │   └─ per-file: split into lines, apply regex per line, collect matches + optional surroundingText
  ▼ result { ok, matches[], truncated }
```

## Technical decisions

**Why `git ls-files` instead of a recursive walk?**
`git ls-files --cached --others --exclude-standard` gives the exact set of files a developer would expect searched — it respects `.gitignore`, includes untracked-but-not-ignored files, and is fast even in large repos. The recursive fallback exists for non-git workspaces.

**Why per-line matching instead of whole-file regex?**
Per-line matching makes context lines trivial to compute (just index into the lines array) and keeps memory bounded. Whole-file regex with `m` flag would enable multi-line patterns but would complicate match-to-line-number mapping and context extraction.

**Why `safe-regex2` for ReDoS detection?**
An agent-supplied pattern runs against every file in the workspace. A catastrophic-backtracking pattern could lock the daemon for minutes. `safe-regex2` rejects star-height > 1 patterns before execution.

**`globToRegex` splits on `**` before replacing `*`.**
Naive single-pass replacement (`**` → placeholder → `.*`, `*` → `[^/]*`) requires a control character placeholder, which Biome rejects. Instead, split the pattern string on `**`, convert each part independently, then join with `.*`. This avoids any placeholder characters and is cleaner.
