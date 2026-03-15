# moveFile does not rewrite imports in out-of-project TS/JS files (VolarCompiler)

**type:** bug
**date:** 2026-03-15
**tracks:** handoff.md # moveFile-extraproject-imports

---

## Symptom

When `moveFile` routes through VolarCompiler (Vue projects), moving a file that is imported by `.ts/.js` files outside `tsconfig.include` leaves those importers' specifiers pointing at the old path. The moved file itself is rewritten correctly (`rewriteMovedFileOwnImports`), and `.vue` importers are handled (`updateVueImportsAfterMove`), but `.ts/.js` out-of-project importers are silently broken.

```
input:    moveFile("src/composables/useCounter.ts", "src/utils/useCounter.ts") via VolarCompiler
          tests/unit/counter.test.ts contains: import { useCounter } from "../../src/composables/useCounter"
actual:   import specifier unchanged: "../../src/composables/useCounter"
expected: import specifier rewritten to "../../src/utils/useCounter"
```

Failing test added: `tests/operations/moveFile_volarCompiler.test.ts` — "rewrites imports in out-of-project .ts files that import the moved file".

## Value / Effort

- **Value:** High. Every Vue project user moving a file that is imported by out-of-project test files or scripts gets silently broken imports across all consumers. The workaround (manual `replaceText` for each importer) scales linearly with the number of importing files — the observed case had 30+ files.
- **Effort:** Low. TsMorphCompiler already has the correct fallback walk (`ts.ts:276-307`). The fix is extracting it as a shared domain function and calling it from both compilers' `afterFileRename`.

## Expected

After moving a file via VolarCompiler, all `.ts/.js` files in the workspace that import the old path have their specifiers rewritten to point at the new path — same behaviour TsMorphCompiler already provides.

```
input:    moveFile("src/composables/useCounter.ts", "src/utils/useCounter.ts") via VolarCompiler
          tests/unit/counter.test.ts contains: import { useCounter } from "../../src/composables/useCounter"
expected: import specifier rewritten to "../../src/utils/useCounter"
          tests/unit/counter.test.ts appears in filesModified
```

## Root cause

`VolarCompiler.afterFileRename` (`src/plugins/vue/compiler.ts:218-225`) only calls `updateVueImportsAfterMove` (`.vue` files) and `rewriteMovedFileOwnImports` (the moved file itself). It lacks the fallback walk that `TsMorphCompiler.afterFileRename` (`src/compilers/ts.ts:276-307`) uses to catch out-of-project `.ts/.js` importers.

Both compilers' `getEditsForFileRename` relies on the TS language service, which only knows about files in the tsconfig program. TsMorphCompiler compensates with the fallback walk; VolarCompiler does not.

## Fix

### AC1: Extract fallback walk as shared domain function

Extract the TS/JS importer fallback walk from `TsMorphCompiler.afterFileRename` (`ts.ts:276-307`) into a shared domain function (e.g. `rewriteImportersOfMovedFile(oldPath, newPath, scope)` in `src/domain/`). Both `TsMorphCompiler.afterFileRename` and `VolarCompiler.afterFileRename` call it.

The narrowest wrong implementation: only calling the extracted function from VolarCompiler but not replacing the inline code in TsMorphCompiler — leaving duplicated logic.

### AC2: Regression — existing behaviour unchanged

- TsMorphCompiler integration tests continue to pass (the extraction must be a pure refactor for TsMorphCompiler).
- VolarCompiler `.vue` importer rewriting still works — the existing "moves a composable file and updates .vue imports" test passes.
- The existing "rewrites own relative imports when moving a file to a shallower directory depth" test passes.

### AC3: Coexisting `.js` file guard preserved

The `isCoexistingJsFile` guard from `TsMorphCompiler.afterFileRename` is preserved in the extracted function. `.js` extension imports that resolve to a real `.js` file on disk are not rewritten.

The narrowest wrong implementation: dropping the coexisting-file check during extraction, causing imports of real `.js` files to be incorrectly rewritten when a `.ts` file with the same base name is moved.

## Security

- **Workspace boundary:** N/A — the fallback walk already exists in TsMorphCompiler; extraction doesn't change which files are accessed. `scope.contains()` check is preserved.
- **Sensitive file exposure:** N/A — the fix rewrites import specifier strings, not file content.
- **Input injection:** N/A — specifiers go through `path.resolve`/`path.relative` computation, no shell invocation.
- **Response leakage:** N/A — no new information surfaces in the response.

## Relevant files

| File | Why it matters |
|------|----------------|
| `src/compilers/ts.ts` (lines 271-308) | TsMorphCompiler `afterFileRename` — source of the fallback walk to extract |
| `src/compilers/ts.ts` (`rewriteSpecifier`, `isCoexistingJsFile`) | Helper functions that must move with the extraction |
| `src/plugins/vue/compiler.ts` (lines 218-225) | VolarCompiler `afterFileRename` — needs to call the extracted function |
| `src/domain/rewrite-own-imports.ts` | Prior art — shared domain function pattern to follow |
| `src/utils/relative-path.ts` | `toRelBase` utility used by the fallback walk |
| `tests/operations/moveFile_volarCompiler.test.ts` | Failing test already added; regression tests live here |
| `tests/operations/moveFile_tsMorphCompiler.test.ts` | TsMorphCompiler regression tests — must still pass after extraction |

## Red flags

- **`ts.ts` is 359 lines** — above the 300-line review threshold. Extracting ~35 lines of fallback walk logic + helper functions will improve this.
- **`compiler.ts` is 226 lines** — well within limits. Adding one function call keeps it under 230.

## Edges

- **Same-directory rename:** Importers' specifiers resolve identically — should be a no-op.
- **Substring false positives:** `./my-utils` must not match when moving `./utils` — existing `rewriteSpecifier` uses exact match.
- **Moving within vs. out of tsconfig include:** The fallback walk handles both (walks by directory, not by project membership).
- **Dynamic imports / `require()`:** Not covered by the AST query. Pre-existing limitation, out of scope.
- **Files already rewritten by `getEditsForFileRename`:** Skipped via `alreadyModified` set — must be preserved in extraction.

## Done-when

- [ ] All fix criteria (AC1-AC3) verified by tests
- [ ] Failing test now passes
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed — check `docs/features/moveFile.md`
- [ ] Tech debt discovered during investigation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
