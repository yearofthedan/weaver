# Remove per-operation fallback workspace walks

**type:** change
**date:** 2026-03-23
**tracks:** handoff.md # remove-per-operation-fallback-walks

---

## Context

Several operations bolt on per-operation `walkFiles` calls to catch files outside `tsconfig.include`. Now that the project graph expansion ships all workspace files into the ts-morph `Project` at bootstrap, these walks are redundant — every workspace file is already in-project.

## User intent

*As a maintainer, I want dead fallback code removed, so that the codebase has one clear path for file discovery (the expanded project graph) instead of duplicated walk-and-scan logic that's easy to get wrong.*

## Relevant files

- `src/ts-engine/engine.ts` (lines 225-228) — `moveSymbol` fallback: walks workspace, runs `ImportRewriter.rewrite()` on unmodified files. Redundant because `tsMoveSymbol` (line 72-74 of `move-symbol.ts`) already collects importers from `project.getSourceFiles()`, which now includes all workspace files.
- `src/ts-engine/after-file-rename.ts` (line 37) — `tsAfterFileRename` fallback: walks workspace, calls `rewriteImportersOfMovedFile`. Called by `tsMoveFile` and `tsMoveDirectory` after `getEditsForFileRename`. With all files in-project, `getEditsForFileRename` sees them — but `rewriteImportersOfMovedFile` is a text-based specifier match that may catch edge cases (e.g. `.js` extension specifiers) the compiler misses. **Keep this one — it's a safety net, not just a scope expansion.**
- `src/ts-engine/remove-importers.ts` (lines 104-143) — `removeOutOfProjectImporters`: walks workspace, skips files already in `projectFilePaths`. With all workspace files in-project, every file is skipped — the function is a no-op.
- `src/ts-engine/move-symbol.ts` — `tsMoveSymbol`: already rewrites all in-project importers at line 104. Confirms the `engine.ts` fallback is redundant.

### Red flags

- None. The files are well within size limits. Test files for these are co-located and not near threshold.

## Value / Effort

- **Value:** Removes ~30 lines of dead code and two unnecessary `walkFiles` calls (each spawns `git ls-files`). Eliminates a class of bugs where the fallback and the primary path disagree on results.
- **Effort:** Minimal. Two deletion sites, one function to remove entirely. Tests must verify operations still work without the fallback.

## Behaviour

- [ ] **AC1: Remove `moveSymbol` fallback walk from `TsMorphEngine.moveSymbol`.** Delete lines 226-228 of `engine.ts` (the `walkFiles` + `ImportRewriter.rewrite` block after `tsMoveSymbol`). Verified by: existing `moveSymbol` tests still pass; `moveSymbol` in `simple-ts` fixture updates a test file outside `tsconfig.include`.

- [ ] **AC2: Remove `removeOutOfProjectImporters` from `remove-importers.ts`.** Delete the `removeOutOfProjectImporters` function and its call in `tsRemoveImportersOf`. The `walkFiles` import can be removed. Verified by: existing `deleteFile` tests still pass; `deleteFile` removes import from a test file outside `tsconfig.include`.

## Interface

No public interface changes. Internal only — removing dead code paths.

## Resolved decisions

### Keep or remove `after-file-rename.ts` fallback?

**Decision: Keep.** `tsAfterFileRename` does two things the compiler doesn't: (1) `rewriteMovedFileOwnImports` adjusts the moved file's own relative specifiers, (2) `rewriteImportersOfMovedFile` is a text-based specifier match that catches `.js` extension specifiers and other edge cases `getEditsForFileRename` may not handle. Unlike the other two fallbacks, this one provides correctness guarantees beyond scope expansion. Remove it in a separate spec after verifying the compiler handles all its edge cases.

## Security

- **Workspace boundary:** N/A. Removing code paths; no new reads or writes.
- **Sensitive file exposure:** N/A.
- **Input injection:** N/A.
- **Response leakage:** N/A.

## Edges

- **moveSymbol + ImportRewriter still needed inside `tsMoveSymbol`.** The removal is only the *second* `ImportRewriter.rewrite()` call in `engine.ts`. The first call inside `tsMoveSymbol` (line 104 of `move-symbol.ts`) is the primary path and remains.
- **`walkFiles` import in `engine.ts` stays.** It's still used by `addWorkspaceFiles`.

## Done-when

- [ ] All ACs verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
