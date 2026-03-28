---
name: code-inspection
description: Use when finding all usages of a symbol, jumping to a definition through re-exports, or checking type errors — before using grep to find references or tsc to check types.
---

# Code Inspection

Compiler-aware queries that see through re-exports, barrel files, and Vue SFCs. Use instead of `grep` for finding usages or `tsc` for checking types.

## Find all references to a symbol

```bash
light-bridge find-references '{"file": "src/a.ts", "line": 10, "col": 5}'
```

Returns every reference location — including through re-exports and barrel files that text grep would miss. Use before deleting or significantly modifying a symbol to understand the blast radius.

## Jump to definition

```bash
light-bridge get-definition '{"file": "src/a.ts", "line": 10, "col": 5}'
```

Follows through re-exports to the actual declaration. Text grep stops at the re-export.

## Check type errors

```bash
# One file
light-bridge get-type-errors '{"file": "src/a.ts"}'

# Project-wide (capped at 100)
light-bridge get-type-errors '{}'
```

Use to check the project baseline before a refactor, or to verify a specific file after manual edits.

## When NOT to use

- **Searching for a text pattern** (not a symbol) — use `search-text` (see search-and-replace skill)

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check coordinates or path
