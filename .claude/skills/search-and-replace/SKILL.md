---
name: search-and-replace
description: Use when changing a string, pattern, or text across multiple files — before using Edit or sed on more than one file. Also use when searching for all occurrences of a pattern across the workspace.
---

# Search and Replace Across Files

**STOP.** If you're about to use Edit on the same kind of change in more than one `.ts`/`.tsx`/`.js`/`.jsx`/`.vue` file, use these commands instead. One call replaces what would take 10+ Edit calls and catches files you'd miss.

## Search: find every occurrence

```bash
light-bridge search-text '{"pattern": "oldName", "glob": "**/*.ts", "maxResults": 50}'
```

Returns structured results: `{file, line, col, matchText}` for every hit. Use this instead of `grep` — it respects workspace boundaries, skips sensitive files, and returns coordinates you can feed into surgical replace.

## Replace: change every occurrence

```bash
# Pattern mode — regex find-and-replace across all matching files
light-bridge replace-text '{"pattern": "oldName", "replacement": "newName", "glob": "**/*.ts"}'
```

Response includes `filesModified`, `replacementCount`, and `typeErrors`. Check `typeErrors` — they tell you if the replacement broke something.

## Surgical mode: replace at exact positions

When you only want to replace *some* hits (not all), use coordinates from `search-text`:

```bash
light-bridge replace-text '{"edits": [
  {"file": "src/a.ts", "line": 3, "col": 10, "oldText": "old", "newText": "new"},
  {"file": "src/b.ts", "line": 7, "col": 5, "oldText": "old", "newText": "new"}
]}'
```

Stale coordinates fail safely instead of corrupting.

## Common sequence: search then replace

```bash
# 1. Find all occurrences
light-bridge search-text '{"pattern": "FOO", "glob": "**/*.ts"}'

# 2. Replace all (or use surgical mode for selective replacement)
light-bridge replace-text '{"pattern": "FOO", "replacement": "BAR", "glob": "**/*.ts"}'

# 3. Check typeErrors in the response — fix any issues
```

## When NOT to use

- **Renaming a TypeScript symbol** (variable, function, type, class) — use `light-bridge rename` instead (see move-and-rename skill). It's scope-aware; text replacement is not.

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`VALIDATION_ERROR`** — check your JSON
- **`WORKSPACE_VIOLATION`** — path is outside the workspace
