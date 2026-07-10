---
name: weaver-code-inspection
description: Any symbol or type question — "where is X used / who calls X?", "any TypeScript errors?", "where is X defined?" — use instead of grep for a symbol's usages, or tsc/build to check types. Finds all references to a named symbol (function, variable, type) at a position, jumps to a definition through re-exports, gets the TypeScript type errors for a file or project. For free-text, comment, or string search (e.g. TODO), use weaver-search-and-replace.
---

# Code Inspection

**STOP.** Before running `grep` to find where a symbol is used, before running `tsc` or a build just to check for type errors, or before reading a file just to find a definition — use these commands instead. They see through re-exports, barrel `index.ts` files, type-only imports, and Vue SFCs that grep misses, and they're scope-aware so they won't match unrelated identifiers with the same name.

## Trust the response

`find-references` and `find-importers` return the **exhaustive** set of matches across re-exports, barrels, and SFCs. **Do not grep afterward to "double-check"** — the response is the proof. If grep would have caught something the tool missed, that's a bug to file, not a workflow.

## Find all references to a symbol

```bash
weaver find-references '{"file": "/abs/path/src/a.ts", "line": 10, "col": 5}'
```

Returns `{file, line, col}` for every reference — including through re-exports and barrel files. Use before deleting or significantly modifying a symbol to understand the blast radius, or during a review to find all callers without writing a regex.

**Instead of:**
```bash
grep -r "resolveDeclarationStatement" src/
```
**Use `find-references`** — it won't return string literals, comments, or unrelated identifiers with the same name.

## Find all files that import a file

```bash
weaver find-importers '{"file": "/abs/path/src/utils.ts"}'
```

Returns every file that imports the given file. Use before moving, deleting, or understanding a file's dependents. Empty `references` means nothing imports the file.

## Jump to definition

```bash
weaver get-definition '{"file": "/abs/path/src/a.ts", "line": 10, "col": 5}'
```

Follows through re-exports to the actual declaration. Text grep stops at the re-export.

## Check type errors

```bash
# One file
weaver get-type-errors '{"file": "/abs/path/src/a.ts"}'

# Project-wide (capped at 100)
weaver get-type-errors '{}'
```

Use to check the project baseline before a refactor, or to verify a specific file after manual edits. Works for `.ts`/`.tsx` and, in Vue projects, `.vue` SFCs. Errors only — no warnings or suggestions.

**Instead of:**
```bash
tsc --noEmit src/auth.ts
```
**Use `get-type-errors`** — it resolves the project's real tsconfig (bare `tsc` on one file ignores it) and returns structured `{file, line, col, message}` errors instead of text to parse.

## When NOT to use

- **Searching for a text pattern** (not a symbol) — use `search-text` (see weaver-search-and-replace skill)

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check coordinates or path
