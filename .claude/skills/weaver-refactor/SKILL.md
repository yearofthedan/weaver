---
name: weaver-refactor
description: Rename, move, or restructure a symbol or file across the codebase — rename a symbol everywhere, move a file/directory/export, delete a file with importers, extract a function. If you don't have the symbol's line/col, it locates it for you first. Rewrites every import, re-export, and reference that mv, rm, sed, or manual edits miss — including across Vue SFCs.
---

# Refactor Across Files

**STOP.** If you're about to `mv` a file, `rm` a file that has importers, rename a symbol used in other files, or extract a function by hand — use these commands instead. They rewrite every import, re-export, and barrel-file reference — including across Vue SFCs — that grep, sed, and Edit miss.

## No `line`/`col`? Locate with `search-text` first — don't grep.

`rename` (and the `find-references` impact check) take a symbol's `file`/`line`/`col`. If you don't have them, **`search-text` returns exactly that shape** — locate first, then act at the returned position. **The returned `{file, line, col}` is the proof: pass it straight to the next command. Do not `grep`, `cat`, or re-open the file to re-confirm the match — that just burns your budget before you act.**

```bash
# 1. Locate the symbol in the file it lives in — returns {file, line, col}.
#    Scope the glob to that file; don't broad-hunt the whole tree.
weaver search-text '{"pattern": "userId", "glob": "src/auth.ts"}'

# 2. Rename at the returned position — one call, updates every reference
weaver rename '{"file": "src/auth.ts", "line": 12, "col": 9, "newName": "accountId"}'
```

`rename` already updates every reference, so you don't check first — just rename. If you separately *want* the blast radius, `find-references` at that same position returns it; it's an optional inspection, not a step before renaming.

## Trust the response

`filesModified` is the exhaustive list of every file the operation changed. **Do not re-read those files to verify the change happened** — the response is the proof. Verification is `typeErrors`: empty means the project still compiles; non-empty entries name the file and line. Re-reading the modified files burns context for no information gain.

## Pick a command

| You want to… | Use |
|---|---|
| Rename a symbol everywhere it's used | `rename` |
| Move a file and rewrite every importer | `move-file` / `move-directory` |
| Move an export to a different file (incl. across `.vue`) | `move-symbol` |
| Delete a file and clean up everything that imported it | `delete-file` |
| Pull a block of code into its own function | `extract-function` |

## Rename a symbol across files

```bash
weaver rename '{"file": "src/a.ts", "line": 5, "col": 3, "newName": "bar"}'
```

Don't have the `line`/`col`? See the locate-first recipe at the top. One call. Scope-aware — won't touch unrelated identifiers that share the same name. Check `typeErrors` in the response. For TypeScript renames, also review `nameMatches` — a complete list of identifiers in the modified files whose text still contains the old name as a substring (e.g. `tsProviderSingleton` after renaming `TsProvider`). Each entry has `file`, `line`, `col`, `name`, and `kind`. Use `replace-text` to update any derived names you want to change after reviewing the list.

## Move a file

```bash
weaver move-file '{"oldPath": "src/old.ts", "newPath": "src/new.ts"}'
```

One call — don't `mkdir` the destination or `mv` the file yourself. Creates any missing destination directories and rewrites every importer. Check `filesSkipped` — those are outside the workspace and need manual fixup with `replace-text`.

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

Only top-level exported declarations (`export function`, `export const`, `export class`, …) — not class methods, and not re-exports via `export { }`. If `destFile` already exports a symbol with the same name, the call returns `SYMBOL_EXISTS`; pass `"force": true` to replace the destination's declaration with the source version and rewrite importers.

Works for symbols declared in a `.vue` SFC's `<script setup>` block as well: pass the `.vue` file as `sourceFile`. The destination can be `.ts` (extract to a shared module) or `.vue` (move into another component's `<script setup>`). Transitive imports used by the moved symbol are not copied — `typeErrors` in the destination will tell you what to add.

## Delete a file

```bash
weaver delete-file '{"file": "src/old.ts"}'
```

One call. Removes every import and re-export of the file across the project first, then deletes it — you don't check importers before deleting, it cleans them up for you. Want the list of importers first anyway? `weaver find-importers '{"file": "src/old.ts"}'` — optional, not a prerequisite.

## Extract a function

```bash
weaver extract-function '{"file": "src/a.ts", "startLine": 10, "startCol": 1, "endLine": 20, "endCol": 1, "functionName": "extracted"}'
```

Infers parameters, return types, and async propagation. Function is placed at module scope (not exported). Use `move-symbol` afterward if it belongs in a different file.

The selection must cover complete statements: `endCol` is inclusive and must point at the last character of the last statement (the `;` if present, or the last token in no-semicolon style).

## Response fields

All write operations return:

- **`filesModified`** — exhaustive list of every file changed. See "Trust the response" above.
- **`filesSkipped`** — files outside the workspace that need manual attention.
- **`typeErrors`** / **`typeErrorCount`** / **`typeErrorsTruncated`** — type errors in files modified by the operation. `status: "warn"` means `typeErrors` is non-empty. Each entry has `file`, `line`, `col`, and `message`. When `typeErrorsTruncated: true`, only the first 100 of `typeErrorCount` total errors are returned; call `get-type-errors` with a specific file path to retrieve the full set.

Pass `"checkTypeErrors": false` when batching changes to check errors once at the end.

## When NOT to use

- **Changing a string/pattern across files** — use `replace-text` (see weaver-search-and-replace skill)

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check coordinates or path
- **`SYMBOL_EXISTS`** — `move-symbol` destination already exports that name; pass `"force": true` to replace it
- **`NOT_SUPPORTED`** — operation doesn't support this target (e.g. `extract-function` on a `.vue` file without a `<script setup>` block)
- **`WORKSPACE_VIOLATION`** — path is outside the workspace
