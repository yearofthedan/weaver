---
name: light-bridge-refactoring
description: Guides agents to use light-bridge compiler-aware refactoring tools instead of manual file editing for cross-file changes.
---

# Refactoring with light-bridge

light-bridge provides compiler-aware refactoring through MCP tools. The compiler tracks every reference through re-exports, barrel files, type-only imports, and Vue SFCs — scope-aware, so it won't touch unrelated identifiers that share the same name.

## When to use light-bridge

Use light-bridge tools instead of manual file editing whenever the change fans out across multiple files. The compiler handles the cascade; you get back a summary without loading any affected files into context.

| Situation | Tool | Not this |
|---|---|---|
| Renaming a symbol used across files | `rename` | Search-and-replace (misses scope, hits false positives) |
| Moving a file to a different directory | `moveFile` | Shell `mv` + manually fixing every broken import |
| Moving a named export between files | `moveSymbol` | Copy-paste + manually updating every importer |
| Deleting a file with dependents | `deleteFile` | Shell `rm` (leaves broken imports everywhere) |
| Extracting statements into a function | `extractFunction` | Manual cut-paste (misses parameter inference, async propagation) |
| Finding all usages before a refactor | `findReferences` | Text grep (misses re-exports, hits string matches) |
| Jumping to a symbol's actual definition | `getDefinition` | Text grep (stops at the re-export, not the source) |

**Stay with direct file editing** when the change is in one file, or when you need to write new code rather than restructure existing code. light-bridge handles structural transformations, not authoring.

## How to use the tools

### Write operations

All write operations (`rename`, `moveFile`, `moveSymbol`, `deleteFile`, `extractFunction`, `replaceText`) return:

- **`filesModified`** — every file that was changed. Do not read these files to verify; the list is exhaustive.
- **`filesSkipped`** — files outside the workspace boundary that were impacted but not written. Surface these to the user; they need manual attention.
- **`typeErrors`** — type errors found in modified files after the change (returned by default). Treat these as action items — something wasn't fully updated. Use `replaceText` to fix remaining issues.

Pass `checkTypeErrors: false` only when you plan to batch multiple changes and check errors once at the end.

### Read operations

- **`findReferences`** — use before deleting or significantly modifying a symbol, to understand the blast radius.
- **`getDefinition`** — use to jump from a usage to the actual declaration, through re-exports and barrel files.
- **`getTypeErrors`** — use to check the project baseline before a refactor, or to verify a specific file after manual edits. Omit the `file` param for a project-wide check (capped at 100).

### Text operations

- **`searchText`** — regex search across the workspace with structured results (file, line, col, matchText).
- **`replaceText`** — two modes: pattern mode (regex + replacement across files) or surgical mode (exact position-verified edits). Use surgical mode with coordinates from `searchText` for precise multi-file edits. Sensitive files (.env, keys) are never touched.

## Common sequences

**Rename a symbol:** Just call `rename`. One call handles everything — check `typeErrors` in the response for any issues.

**Move a file:** Call `moveFile`. Check `filesSkipped` — if any, fix those imports manually with `replaceText`.

**Reorganise exports between modules:** Call `moveSymbol` for each export. Check `typeErrors` after each move.

**Delete a file safely:** Call `findReferences` first to understand what depends on it. Then call `deleteFile` — it removes all imports and re-exports before deleting. Check `typeErrors` for anything left broken.

**Extract a function:** Call `extractFunction` with the line/column range. The compiler infers parameters, return types, and async propagation. The function is placed at module scope (not exported). Use `moveSymbol` afterward if it belongs in a different file.

**Fix type errors after changes:** Read `typeErrors` from the write operation response. Use `replaceText` in surgical mode to fix remaining issues. Call `getTypeErrors` on specific files to verify fixes.

## Error handling

- **`DAEMON_STARTING`** — the project graph is still loading. Retry after a short delay.
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check position coordinates or file path. Do not retry with the same arguments.
- **`NOT_SUPPORTED`** — the operation doesn't support this file type or shape (e.g. `extractFunction` on `.vue` files).
- **`WORKSPACE_VIOLATION`** — a path argument is outside the workspace boundary.

All paths must be absolute.
