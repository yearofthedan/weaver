---
name: weaver-code-inspection
description: Any symbol or type question — "where is X used / who calls X?", "any TypeScript errors?", "where is X defined?" — use instead of grep for a symbol's usages, or tsc/build to check types. Finds all references to a named symbol (function, variable, type) at a position, jumps to a definition through re-exports, gets the TypeScript type errors for a file or project. For free-text, comment, or string search (e.g. TODO), use weaver-search-and-replace.
---

# Code Inspection

**Match the task to a row and run the command in the middle — do not reach for the tool in the "Never" column, even mid-task, even right after running `grep`/`find`/`tsc` for something else.**

| If the task is… | Run | Never |
|---|---|---|
| "which files import `<file>`?" | `weaver find-importers` | `grep`/`find` for `import`/`from` lines |
| "where is `<symbol>` used? who calls it?" | `weaver find-references` | `grep` for the name |
| "where is `<symbol>` defined?" | `weaver get-definition` | open the file to read it |
| "are there type errors? does it compile?" | `weaver get-type-errors` | `tsc` / `npx tsc` |

These see through re-exports, barrel `index.ts` files, type-only imports, and Vue SFCs that grep misses, and they're scope-aware so they won't match unrelated identifiers with the same name.

## Running weaver

`weaver` is a JavaScript package — `@yearofthedan/weaver` on npm — installed as a project dependency or globally, and run from the shell like any other command-line program. Invoke it however your project exposes it: `weaver …`, `pnpm exec weaver …`, `npx @yearofthedan/weaver …`, or `yarn weaver …`.

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

**To learn which files import a file, run `weaver find-importers` — never `grep`/`find` for `import` or `from` lines.**

```bash
weaver find-importers '{"file": "/abs/path/src/utils.ts"}'
```

Returns every file that imports the given file. Use before moving, deleting, or understanding a file's dependents. Empty `references` means nothing imports the file.

**Instead of:**
```bash
grep -rn "from './service'" src/
```
**Use `find-importers`** — grepping import lines misses re-exports, barrel `index.ts` files, `import type`, and `.vue` SFCs, and matches unrelated strings that merely contain the path. `find-importers` returns the exact importer set.

## Jump to definition

```bash
weaver get-definition '{"file": "/abs/path/src/a.ts", "line": 10, "col": 5}'
```

Follows through re-exports to the actual declaration. Text grep stops at the re-export.

## Check type errors

**Never check types with `tsc`/`npx tsc` — naming a file on the command line turns `tsconfig.json` off, and running from the project root does not change that. Run `weaver get-type-errors` instead.**

```bash
# One file
weaver get-type-errors '{"file": "/abs/path/src/a.ts"}'

# Project-wide (capped at 100)
weaver get-type-errors '{}'
```

Use to check the project baseline before a refactor, or to verify a specific file after manual edits. Works for `.ts`/`.tsx` and, in Vue projects, `.vue` SFCs. Errors only — no warnings or suggestions.

**Instead of:**
```bash
tsc --noEmit src/service.ts
```
**Use `get-type-errors`** — the filename on that command line is what drops `tsconfig.json` (so no `paths`, no `lib`, no `strict`). Depending on the TypeScript version you either get results computed without the project's config, or an outright refusal (TypeScript 6: `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline`). Dropping the filename restores the config but compiles the whole project. `get-type-errors` is scoped and configured in one call, returns structured `{file, line, col, message}` instead of text to parse, and sees `.vue` SFCs.

## When NOT to use

- **Searching for a text pattern** (not a symbol) — use `search-text` (see weaver-search-and-replace skill)

## Errors

- **`DAEMON_STARTING`** — retry after a short delay
- **`SYMBOL_NOT_FOUND`** / **`FILE_NOT_FOUND`** — check coordinates or path
