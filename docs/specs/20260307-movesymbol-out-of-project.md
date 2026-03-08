# moveSymbol: rewrite imports in files outside tsconfig.include

**type:** bug
**date:** 2026-03-07
**tracks:** handoff.md # moveSymbol does not rewrite imports in files outside tsconfig.include

---

## Symptom

When `moveSymbol` moves a symbol from file A to file B, imports are only updated in files known to the ts-morph `Project` (i.e. files covered by `tsconfig.include`). Test files, scripts, and other `.ts` files outside `tsconfig.include` keep their stale imports and break silently.

```
input:    moveSymbol({ sourceFile: "src/utils/file-walk.ts", symbolName: "TS_EXTENSIONS", destFile: "src/utils/extensions.ts" })
actual:   tests/daemon/watcher.test.ts still imports TS_EXTENSIONS from "../src/utils/file-walk.js" (stale)
expected: tests/daemon/watcher.test.ts import rewritten to "../src/utils/extensions.js"
```

## Value / Effort

- **Value:** High. This is the most common failure mode for `moveSymbol` in any project with a standard `tsconfig.json` that excludes `tests/`. Every symbol move that has test-file importers leaves broken imports. The workaround (manual `replaceText` after the move) defeats the purpose of a compiler-aware tool. Agents do not anticipate needing a follow-up `replaceText` call, so they discover the breakage only when tests fail or type errors surface later.
- **Effort:** Low-to-moderate. The exact pattern already exists in `TsProvider.afterFileRename`, which walks all workspace `.ts` files with `walkFiles` and rewrites import specifiers using a temporary in-memory ts-morph `Project`. The fix applies the same approach to `afterSymbolMove`, narrowed to named-import rewrites for the specific symbol being moved. One file changes (`src/providers/ts.ts`), plus tests.

## Expected

After `moveSymbol` completes, every `.ts`/`.tsx`/`.js`/`.jsx` file in the workspace that imports `symbolName` from `sourceFile` has its import rewritten to point to `destFile` -- regardless of whether the file is inside `tsconfig.include`.

## Root cause

`moveSymbol` (line 103) iterates `project.getSourceFiles()` to find importers. The ts-morph `Project` is loaded from `tsconfig.json` with `skipAddingFilesFromTsConfig: false`, so it only contains files matched by `tsconfig.include` (typically `src/**/*.ts`). Files excluded by tsconfig (tests, scripts, config files) are not in the project and their imports are never inspected.

The Vue provider's `afterSymbolMove` hook handles `.vue` files (also outside ts-morph) via a regex scan in `scan.ts`. But `TsProvider.afterSymbolMove` is a no-op -- there is no equivalent fallback scan for out-of-project `.ts` files.

The sibling operation `moveFile` solved the same problem via `TsProvider.afterFileRename`, which walks the full workspace with `walkFiles` and rewrites specifiers using a temporary in-memory project. `moveSymbol` lacks this second pass.

## Fix

Implement `TsProvider.afterSymbolMove` as a workspace-wide fallback scan, following the established pattern from `TsProvider.afterFileRename`.

- [ ] **AC1: Out-of-project importers are rewritten.** Given a test file outside `tsconfig.include` that imports `symbolName` from `sourceFile`, after `moveSymbol` completes, the test file's import specifier points to `destFile`. The test file appears in `filesModified`.

- [ ] **AC2: Multi-symbol imports are split correctly.** Given an out-of-project file that imports `{ symbolName, otherSymbol }` from `sourceFile`, after `moveSymbol`, the file has `{ otherSymbol }` from `sourceFile` and `{ symbolName }` from `destFile`. (Narrowest-fix check: a lazy implementation that only handles single-symbol import declarations would leave multi-symbol imports broken.)

- [ ] **AC3: Files already rewritten by the ts-morph pass are not double-rewritten.** The fallback scan skips files that were already modified by the primary AST-based pass (the `importers` loop in `moveSymbol`). This prevents double-rewriting that could corrupt specifiers. (The `afterFileRename` pattern already uses an `alreadyModified` set for this purpose.)

- [ ] **AC4: JS-extension specifiers are handled.** Given an out-of-project file that imports via a JS-family extension (`.js`, `.mjs`, `.cjs`, `.jsx` — all entries in `JS_TS_PAIRS`), the specifier is rewritten to the new path with the JS extension preserved, unless a real JS file exists at the original path (same coexisting-file logic as `afterFileRename`).

## Relevant files

- `src/providers/ts.ts` -- `TsProvider.afterSymbolMove` (currently no-op; this is where the fix goes). Also contains `afterFileRename` which is the pattern to follow.
- `src/operations/moveSymbol.ts` -- calls `afterSymbolMove`; will need to pass `alreadyModified` set (line 143 `filesModified`).
- `src/plugins/vue/scan.ts` -- `updateVueNamedImportAfterSymbolMove` handles the Vue equivalent; reference for the named-import rewrite regex approach.
- `src/utils/file-walk.ts` -- `walkFiles` used by both `afterFileRename` and the Vue scan.
- `src/utils/extensions.ts` -- `TS_EXTENSIONS`, `JS_TS_PAIRS`, `JS_EXTENSIONS` for extension handling.
- `src/utils/relative-path.ts` -- `toRelBase`, `computeRelativeImportPath` for specifier computation.
- `src/types.ts` -- `LanguageProvider.afterSymbolMove` signature (may need `alreadyModified` parameter added).
- `tests/operations/moveSymbol.test.ts` -- existing tests (711 lines; see red flags).

### Red flags

- **`tests/operations/moveSymbol.test.ts` is 711 lines** -- well over the 500-line hard flag. The execution agent should not add new tests to this file without first refactoring it. Following the test refactoring hierarchy: the file likely has repeated project scaffolding that should be extracted to a shared helper (step 3), and parameterised tests may help consolidate similar cases (step 4). Include a prep step to bring the file under threshold before adding AC tests.
- **`afterSymbolMove` signature change ripples through `LanguageProvider` interface.** Adding `alreadyModified` to `afterSymbolMove` touches the interface in `types.ts`, both providers (`TsProvider`, `VolarProvider`), and the call site in `moveSymbol.ts`. The parameter should be optional (defaulting to empty set) so the Vue provider's existing implementation doesn't need changes.

## Security

- **Workspace boundary:** The fallback scan uses `walkFiles` (which respects `.gitignore`) and must check `isWithinWorkspace` before writing, matching the existing pattern in `afterFileRename`. No new boundary bypass risk -- the fix follows an established, reviewed pattern.
- **Sensitive file exposure:** The scan reads file content to check import specifiers. It does not return file content in the response -- only file paths in `filesModified`. No new exposure surface. N/A.
- **Input injection:** No new user-supplied strings are introduced. The `symbolName` and file paths are already validated upstream. N/A.
- **Response leakage:** No change to response shape. N/A.

## Edges

- **Aliased imports (`import { symbolName as alias }`).** The fallback scan must handle `as` aliases in named imports. The Vue scan already handles this (see `scan.ts` line 135: `s.split(/\s+as\s+/)[0].trim()`). The TS fallback should do the same.
- **Type-only imports (`import type { symbolName }`).** These should also be rewritten -- a type-only import is still an import from the source file. The ts-morph AST approach used in the fallback (parsing `ImportDeclaration` nodes) handles these naturally.
- **Re-export specifiers (`export { symbolName } from '...'`).** Out-of-project files may re-export from the source file. These should also be caught. `afterFileRename` handles both import and export declarations (`[...sf.getImportDeclarations(), ...sf.getExportDeclarations()]`); the symbol move fallback should do the same.
- **No regression in the primary AST pass.** The fallback is additive -- it only touches files that were NOT already processed by the ts-morph importer loop. The existing happy path (in-project importers) must continue to work identically.
- **Performance.** `walkFiles` + per-file in-memory project creation is the same approach used by `afterFileRename`. For large workspaces this is O(n) in tracked files. Acceptable given that `moveSymbol` is already an expensive operation and runs infrequently.

## Done-when

- [ ] All fix criteria (AC1-AC4) verified by tests
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `tests/operations/moveSymbol.test.ts` refactored below 500-line threshold before new tests are added
- [ ] `docs/features/moveSymbol.md` updated to document that out-of-project files are now covered
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
