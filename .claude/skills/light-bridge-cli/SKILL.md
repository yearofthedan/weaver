---
name: light-bridge-cli
description: Use before cross-file edits when light-bridge is installed as a CLI tool. Compiler-aware refactoring via shell commands — renames, moves, and deletes track every reference through re-exports, barrel files, and Vue SFCs. Avoids broken imports from manual grep-and-replace.
---

# Refactoring with light-bridge CLI

Shell out to `light-bridge <operation> '<json>'` for any change that fans out across multiple files. The compiler tracks every reference — re-exports, barrel files, type-only imports, Vue SFCs — so you don't have to.

## When to use

- **Moving, renaming, or deleting code that other files import?** Use light-bridge. Manual editing misses re-exports and scope.
- **Change isolated to one file?** Edit directly — light-bridge handles structural transformations, not authoring.

| Situation | Command | Not this |
|---|---|---|
| Rename a symbol across files | `light-bridge rename` | Search-and-replace (misses scope) |
| Move a file | `light-bridge move-file` | `mv` + fixing imports by hand |
| Move a directory | `light-bridge move-directory` | `mv` + fixing every nested import |
| Move an export between files | `light-bridge move-symbol` | Copy-paste + updating importers |
| Delete a file with dependents | `light-bridge delete-file` | `rm` (leaves broken imports) |
| Extract statements into a function | `light-bridge extract-function` | Manual cut-paste |
| Find all usages before a refactor | `light-bridge find-references` | Text grep (hits false positives) |
| Jump to a symbol's definition | `light-bridge get-definition` | Text grep (stops at re-exports) |
| Regex search across workspace | `light-bridge search-text` | grep (no structured output) |
| Regex or surgical replace | `light-bridge replace-text` | sed/awk (no scope, no type check) |
| Check type errors | `light-bridge get-type-errors` | `tsc` (different output format) |

## Invocation

```bash
light-bridge <operation> '<json>'
# or pipe JSON via stdin:
echo '<json>' | light-bridge <operation>
```

Path-valued keys (`file`, `oldPath`, `newPath`, `sourceFile`, `destFile`) resolve relative to `--workspace` (default: cwd). The daemon auto-spawns on first call.

## Quick reference

```bash
# Rename symbol at line 5, col 3
light-bridge rename '{"file": "src/a.ts", "line": 5, "col": 3, "newName": "bar"}'

# Move a file (rewrites all importers)
light-bridge move-file '{"oldPath": "src/old.ts", "newPath": "src/new.ts"}'

# Move a directory (rewrites all nested imports)
light-bridge move-directory '{"oldPath": "src/utils", "newPath": "src/helpers"}'

# Move an exported symbol between files
light-bridge move-symbol '{"sourceFile": "src/a.ts", "symbolName": "Foo", "destFile": "src/b.ts"}'

# Delete a file (removes imports first)
light-bridge delete-file '{"file": "src/old.ts"}'

# Extract lines 10-20 into a function
light-bridge extract-function '{"file": "src/a.ts", "startLine": 10, "startCol": 1, "endLine": 20, "endCol": 1, "functionName": "extracted"}'

# Find all references to symbol at position
light-bridge find-references '{"file": "src/a.ts", "line": 10, "col": 5}'

# Get definition location
light-bridge get-definition '{"file": "src/a.ts", "line": 10, "col": 5}'

# Regex search
light-bridge search-text '{"pattern": "TODO", "glob": "*.ts", "maxResults": 50}'

# Regex replace across files
light-bridge replace-text '{"pattern": "oldName", "replacement": "newName", "glob": "*.ts"}'

# Surgical replace with exact positions (from search-text coordinates)
light-bridge replace-text '{"edits": [{"file": "src/a.ts", "line": 3, "col": 10, "oldText": "old", "newText": "new"}]}'

# Type errors for one file or project-wide
light-bridge get-type-errors '{"file": "src/a.ts"}'
light-bridge get-type-errors '{}'
```

## Reading responses

Every response has a `status` field: `"success"`, `"warn"`, or `"error"`. **`"warn"` means the operation completed but left type errors** — check `typeErrors` in the response and fix them.

All write operations return:

- **`filesModified`** — every file changed. Don't read these to verify; the list is exhaustive.
- **`filesSkipped`** — files outside the workspace that need manual attention.
- **`typeErrors`** — type errors in modified files after the change. **These are action items** — fix with `replace-text`.

Pass `"checkTypeErrors": false` when batching changes to check errors once at the end.

## Common sequences

**Rename a symbol:** One `rename` call. Check `typeErrors`. Then one `replace-text` pass for derived names (e.g. `fooSingleton`) the compiler doesn't track.

**Move a file:** One `move-file` call. Check `filesSkipped` — fix those manually with `replace-text`.

**Reorganise exports:** One `move-symbol` per export. Check `typeErrors` after each.

**Delete safely:** `find-references` first to see dependents, then `delete-file`.

**Extract a function:** `extract-function` with line range. Function is placed at module scope (not exported). Use `move-symbol` if it belongs elsewhere.

**Search → surgical replace:** `search-text` returns `{file, line, col, matchText}` for every hit. Feed those coordinates into `replace-text` surgical mode (`edits` array) for position-verified multi-file edits — stale coordinates fail safely instead of corrupting.

## Scenarios

**"Rename `UserService` to `AuthService` — it's imported in 30 files."**
Don't grep-and-replace — you'll hit unrelated `UserService` strings in comments and other scopes. Use `rename`: one call, scope-aware, updates every real reference.
```bash
light-bridge rename '{"file": "src/services/user.ts", "line": 3, "col": 14, "newName": "AuthService"}'
```

**"Move all the helpers from `src/utils/` into `src/shared/`."**
Don't `mv` the directory — every file importing from `utils/` will break. Use `move-directory`: it relocates files and rewrites every import path.
```bash
light-bridge move-directory '{"oldPath": "src/utils", "newPath": "src/shared"}'
```

**"Find every text reference to `FOO` and rename them to `BAR`."**
This is the grep/sed replacement. `search-text` finds all occurrences with structured coordinates; `replace-text` applies the change. The response includes `typeErrors` — check them to see if the rename broke anything.
```bash
light-bridge search-text '{"pattern": "FOO", "glob": "**/*.ts"}'
light-bridge replace-text '{"pattern": "FOO", "replacement": "BAR", "glob": "**/*.ts"}'
# → response includes filesModified, replacementCount, and typeErrors
```
For selective replacement (only some hits), use surgical mode with coordinates from the search results.

## Errors

- **`DAEMON_STARTING`** — project graph still loading. Retry after a short delay.
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check coordinates or path.
- **`NOT_SUPPORTED`** — operation doesn't support this file type (e.g. `extract-function` on `.vue`).
- **`WORKSPACE_VIOLATION`** — path is outside the workspace boundary.
- **`VALIDATION_ERROR`** — malformed JSON or missing required fields.

Exit code `0` for success/warn, `1` for errors.
