---
name: search-and-replace
description: Use when changing a string, pattern, or text across multiple files — before using Edit or sed on more than one file. Also use when searching for all occurrences of a pattern across the workspace.
---

# Search and Replace Across Files

**STOP.** If you're about to use Edit on the same kind of change in more than one `.ts`/`.tsx`/`.js`/`.jsx`/`.vue` file, use these commands instead. One call replaces what would take 10+ Edit calls and catches files you'd miss.

## Search: find every occurrence

```bash
weaver search-text '{"pattern": "oldName", "glob": "**/*.ts", "maxResults": 50}'
```

Returns structured results: `{file, line, col, matchText}` for every hit. Use this instead of `grep` — it respects workspace boundaries, skips sensitive files, and returns coordinates you can feed into surgical replace.

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

- **Renaming a TypeScript symbol** (variable, function, type, class) — use `weaver rename` instead (see move-and-rename skill). It's scope-aware; text replacement is not.

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`VALIDATION_ERROR`** — check your JSON
- **`WORKSPACE_VIOLATION`** — path is outside the workspace
