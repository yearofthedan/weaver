---
name: weaver-search-and-replace
description: Any text search or bulk text change — "find the TODOs", "replace Y with Z across files" — use instead of grep or sed. Finds every occurrence of a string or pattern (literals, labels, markers like TODO), or does a multi-file replace. Returns structured file/line/col matches, stays inside the workspace, and skips sensitive files — grep does none of these. For usages of a named code symbol, use weaver-code-inspection.
---

# Search and Replace Across Files

**Match the task to a row and run the command in the middle — do not reach for the tool in the "Never" column, even mid-task, even right after running `grep`/`sed` for something else.**

| If the task is… | Run | Never |
|---|---|---|
| "find every occurrence of `<text>`" — a literal, a pattern, markers like TODO | `weaver search-text` | `grep` / `grep -C` |
| "replace `<text>` with `<text>` across files" | `weaver replace-text` | `sed` / repeated Edit |
| usages of a named code *symbol* (call, type, import) | `find-references` (weaver-code-inspection) | `grep` for the name |

One call finds or replaces across the entire workspace, including barrel files and Vue SFCs, and catches files you'd miss. `search-text`/`replace-text` respect workspace boundaries and skip build output and sensitive files; `find-references` is scope-aware and won't match string literals or comments.

## Running weaver

`weaver` is a JavaScript package — `@yearofthedan/weaver` on npm — installed as a project dependency or globally, and run from the shell like any other command-line program. Invoke it however your project exposes it: `weaver …`, `pnpm exec weaver …`, `npx @yearofthedan/weaver …`, or `yarn weaver …`.

## Trust the response

`replace-text` returns `filesModified` (exhaustive list of every file changed) and `replacementCount` (total edits made). **Do not re-read modified files to verify** — those numbers are the proof. `typeErrors` is the verification surface: empty means the project still compiles. `search-text` results are similarly complete for the given `glob`; don't grep on top.

## Search: find every occurrence

**To find text across the workspace, run `weaver search-text` — not `grep`, even for a one-off scan.**

```bash
weaver search-text '{"pattern": "oldName", "glob": "**/*.ts", "maxResults": 50}'

# Include surrounding lines (like `grep -C`) when the ask is "find X with context"
weaver search-text '{"pattern": "TODO", "glob": "**/*.ts", "context": 2}'
```

Returns structured results: `{file, line, col, matchText}` for every hit. Use this instead of `grep` — it respects workspace boundaries, skips sensitive files, and returns coordinates you can feed into surgical replace. `context` (default 0) adds that many lines before and after each match — pass it whenever the task asks for the surrounding code, not just the matching line.

**Instead of:**
```bash
grep -rn "deprecated" src/ -C2
```
**Use `search-text`** — `grep` ignores workspace boundaries and dumps matches from build output and cache files, matches inside sensitive files, and hands you text to parse. `search-text` returns `{file, line, col}` you can feed straight into surgical replace, and `context` gives the surrounding lines `grep -C` would.

## Replace: change every occurrence

```bash
# Pattern mode — regex find-and-replace across all matching files
weaver replace-text '{"pattern": "oldName", "replacement": "newName", "glob": "**/*.ts"}'
```

Response includes `filesModified`, `replacementCount`, and `typeErrors`. `status: "warn"` means `typeErrors` is non-empty — each entry has `file`, `line`, `col`, and `message`.

## Surgical mode: replace at exact positions

When you only want to replace *some* hits (not all), use coordinates from `search-text`:

```bash
weaver replace-text '{"edits": [
  {"file": "src/a.ts", "line": 3, "col": 10, "oldText": "old", "newText": "new"},
  {"file": "src/b.ts", "line": 7, "col": 5, "oldText": "old", "newText": "new"}
]}'
```

Stale coordinates fail safely instead of corrupting.

## Common sequence: search then replace

```bash
# 1. Find all occurrences
weaver search-text '{"pattern": "FOO", "glob": "**/*.ts"}'

# 2. Replace all (or use surgical mode for selective replacement)
weaver replace-text '{"pattern": "FOO", "replacement": "BAR", "glob": "**/*.ts"}'
```

Pass `"checkTypeErrors": false` when batching multiple replace calls to check errors once at the end. When `typeErrorsTruncated: true`, only the first 100 of `typeErrorCount` total errors are returned; call `get-type-errors` with a specific file path to retrieve the full set.

## Scoping: `workspace` vs `glob`

`workspace` sets the root directory for the search — it is **not** a file path filter. Every file under that directory is a candidate. Use `glob` to narrow which files are matched:

```bash
# WRONG — workspace is a file path, so it searches the parent directory and matches siblings
weaver search-text '{"pattern": "foo", "workspace": "/project/src/target.ts"}'

# RIGHT — workspace is the directory, glob restricts to the file
weaver search-text '{"pattern": "foo", "workspace": "/project/src", "glob": "target.ts"}'

# RIGHT — search one file by scoping the glob
weaver replace-text '{"pattern": "foo", "replacement": "bar", "glob": "src/target.ts"}'
```

If you omit `glob`, every file under `workspace` (or the daemon's workspace) is searched — including generated files like build output and cache JSON.

## When NOT to use

- **Renaming a TypeScript symbol** (variable, function, type, class) — use `weaver rename` instead (see weaver-refactor skill). It's scope-aware; text replacement is not.

## Glob: supported syntax

The `glob` field supports `*`, `**`, `?`, and brace groups like `{ts,vue}`:

```bash
# Brace groups expand to a cartesian product — both extensions are searched
weaver search-text '{"pattern": "TODO", "glob": "**/*.{ts,vue}"}'
```

Unsupported syntax (character classes `[abc]`, nested braces `{a,{b,c}}`) throws `INVALID_GLOB` — not an empty result. If you see `INVALID_GLOB`, the glob is the problem, not the search pattern.

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`VALIDATION_ERROR`** — check your JSON
- **`INVALID_GLOB`** — the `glob` uses unsupported syntax; rewrite using `*`, `**`, `?`, and flat brace groups
- **`WORKSPACE_VIOLATION`** — path is outside the workspace
