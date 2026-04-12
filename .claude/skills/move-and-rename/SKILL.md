---
name: move-and-rename
description: Use when moving files or directories, renaming a symbol used across files, moving exports between files, or deleting a file that other files import. Before using mv, rm, or manual import fixup.
---

# Move, Rename, and Delete Across Files

**STOP.** If you're about to `mv` a file, `rm` a file that has importers, or rename a variable/function/type that's used in other files — use these commands instead. They rewrite every import, re-export, and reference automatically.

## Rename a symbol across files

```bash
weaver rename '{"file": "src/a.ts", "line": 5, "col": 3, "newName": "bar"}'
```

One call. Scope-aware — won't touch unrelated identifiers that share the same name. Check `typeErrors` in the response, then do one `replace-text` pass for derived string names (e.g. `fooSingleton`) the compiler doesn't track.

## Move a file

```bash
weaver move-file '{"oldPath": "src/old.ts", "newPath": "src/new.ts"}'
```

Rewrites every importer. Check `filesSkipped` — those are outside the workspace and need manual fixup with `replace-text`.

## Move a directory

```bash
weaver move-directory '{"oldPath": "src/utils", "newPath": "src/helpers"}'
```

Relocates all files and rewrites every nested import path.

## Move an export between files

```bash
weaver move-symbol '{"sourceFile": "src/a.ts", "symbolName": "Foo", "destFile": "src/b.ts"}'
```

Moves the declaration and updates every importer. `destFile` is created automatically if it does not exist — no need to pre-create it. Check `typeErrors` after each move.

## Delete a file safely

```bash
# 1. Check what depends on it
weaver find-references '{"file": "src/old.ts", "line": 1, "col": 1}'

# 2. Delete — removes all imports and re-exports first
weaver delete-file '{"file": "src/old.ts"}'
```

## Extract a function

```bash
weaver extract-function '{"file": "src/a.ts", "startLine": 10, "startCol": 1, "endLine": 20, "endCol": 1, "functionName": "extracted"}'
```

Infers parameters, return types, and async propagation. Function is placed at module scope (not exported). Use `move-symbol` afterward if it belongs in a different file.

## Reading responses

All write operations return:

- **`filesModified`** — every file changed. Don't read these to verify; the list is exhaustive.
- **`filesSkipped`** — files outside workspace that need manual attention.
- **`typeErrors`** / **`typeErrorCount`** / **`typeErrorsTruncated`** — type errors in modified files. See below.

Pass `"checkTypeErrors": false` when batching changes to check errors once at the end.

## When the response has type errors

`status: "warn"` means `typeErrors` is non-empty. These are action items — something wasn't fully updated and the codebase won't compile until they're fixed.

Follow-up workflow:

1. Examine each entry — `file`, `line`, `col`, and `message` identify exactly what broke.
2. Call `replace-text` with surgical edits to fix each broken reference.
3. Call `get-type-errors` on the modified files to confirm clean.

When `typeErrorsTruncated: true`, only the first 100 of `typeErrorCount` total errors appear. Call `get-type-errors` with a specific file path to see the full set before fixing.

## When NOT to use

- **Changing a string/pattern across files** — use `replace-text` (see search-and-replace skill)

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check coordinates or path
- **`NOT_SUPPORTED`** — operation doesn't support this file type (e.g. `extract-function` on `.vue`)
- **`WORKSPACE_VIOLATION`** — path is outside the workspace
