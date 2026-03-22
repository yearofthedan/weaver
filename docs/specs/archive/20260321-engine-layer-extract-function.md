# Engine layer: `extractFunction` action

**type:** change
**date:** 2026-03-21
**tracks:** handoff.md # Engine layer: extractFunction action → docs/architecture.md

---

## Context

Fifth spec in the engine layer migration. `deleteFile`, `moveFile`, `moveSymbol`, and `moveDirectory` established the pattern: standalone action function in `ts-engine/`, full-workflow method on `Engine`, operation becomes validate + delegate. This spec migrates `extractFunction` — the operation currently owns the full compiler workflow (offset calculation, language service calls, name substitution, cache invalidation). After this spec the operation is two lines, and the compiler logic lives in `ts-engine/` alongside its peers.

## User intent

*As a contributor to light-bridge, I want `extractFunction` to be a full-workflow action on the `Engine` interface, so that the operation is validate + delegate and compiler logic lives behind the engine abstraction like every other action.*

## Relevant files

- `src/operations/extractFunction.ts` — 153 lines; the full compiler workflow moves out of here
- `src/operations/extractFunction.test.ts` — 265 lines; 7 of 9 tests belong at the ts-engine layer after the migration
- `src/ts-engine/engine.ts` — `TsMorphEngine`; gains `extractFunction()` delegation method; `getFunction()` and `getLanguageServiceForFile()` stay (used by `tsExtractFunction`)
- `src/ts-engine/types.ts` — `Engine` interface; gains `extractFunction()`; `ExtractFunctionResult` moves here from `operations/types.ts`
- `src/ts-engine/move-file.ts` — reference implementation: standalone action function pattern
- `src/operations/types.ts` — `ExtractFunctionResult` moves to `ts-engine/types.ts`; re-exported from here for existing callers
- `src/plugins/vue/engine.ts` — `VolarEngine`; gains `extractFunction()` implementing NOT_SUPPORTED for `.vue`, delegate for TS
- `src/compilers/__helpers__/mock-compiler.ts` — needs `extractFunction` mock entry
- `src/daemon/dispatcher.ts` — switches from `registry.tsEngine()` to `registry.projectEngine()` for `extractFunction`

### Red flags

- `src/operations/extractFunction.test.ts` is 265 lines — below the 300-line review threshold, but most tests are at the wrong layer. The migration naturally fixes this: 7 tests move to `ts-engine/extract-function.test.ts`, leaving ~30–40 lines at the operation layer. No pre-cleanup needed.

## Value / Effort

- **Value:** Completes the engine migration for the last unmirgated action. The operation is 153 lines of compiler orchestration; after this spec it is ~5 lines. VolarEngine gets a proper `NOT_SUPPORTED` path at the right layer rather than the operation guarding it.
- **Effort:** Low. Established pattern, no new infrastructure. Two new files (`ts-engine/extract-function.ts`, `ts-engine/extract-function.test.ts`), two files simplified (operation + dispatcher), one type relocated.

## Behaviour

- [x] **AC1: Create `tsExtractFunction()`, delegate from `TsMorphEngine`, add to `Engine` interface, implement in VolarEngine.**

  Created `src/ts-engine/extract-function.ts` exporting `tsExtractFunction()`. Body inlines the compiler workflow verbatim. `ExtractFunctionResult` moved to `src/ts-engine/types.ts`, re-exported from `src/operations/types.ts`. `extractFunction()` added to `Engine` interface. `TsMorphEngine.extractFunction()` is a 1-line delegate. `VolarEngine.extractFunction()` throws `NOT_SUPPORTED` for `.vue`, delegates to `tsEngine` otherwise. Mock updated. 8-test `extract-function.test.ts` created.

- [x] **AC2: Simplify the `extractFunction` operation and update the dispatcher.**

  `src/operations/extractFunction.ts` reduced to `assertFileExists` + `engine.extractFunction(...)` (~5 lines). Dispatcher updated to `registry.projectEngine()`. Operation tests shrunk to 2: FILE_NOT_FOUND guard + mock-engine wiring.

## Interface

**`Engine.extractFunction()` parameters:**

- `file` — absolute path to the source file. `.ts` or `.tsx`. The engine throws `NOT_SUPPORTED` for `.vue`; the operation throws `FILE_NOT_FOUND` if the path does not exist.
- `startLine`, `startCol`, `endLine`, `endCol` — 1-based line/column coordinates of the selection, inclusive. `endCol` points at the last character of the selection (same convention as the current operation).
- `functionName` — the desired name for the extracted function. Replaces whatever name the TypeScript compiler auto-generates. No validation — the compiler will produce a parse error if the name is invalid, which surfaces as `NOT_SUPPORTED`.
- `scope` — workspace boundary and file I/O; edits are written through `scope.writeFile`.

**Return (`ExtractFunctionResult`):**
- `filesModified` — absolute paths of files written. Always exactly one entry (the source file) for a successful extraction.
- `filesSkipped` — files the compiler wanted to edit but were outside the workspace boundary. Always empty in practice (extractFunction is single-file), but preserved for interface consistency.
- `functionName` — echoes the caller-provided name.
- `parameterCount` — number of parameters on the extracted function as inferred by the compiler. Zero when the selection has no outer-scope references.

## Open decisions

None. Pattern is established by `tsMoveFile` / `tsMoveDirectory`. `VolarEngine` delegates to `tsEngine` for non-`.vue` files (same as `moveSymbol`).

## Security

- **Workspace boundary:** No change. `assertFileExists` stays in the operation. All writes go through `scope.writeFile`, which enforces the workspace boundary. No new file paths introduced.
- **Sensitive file exposure:** N/A — no file content surfaces in responses.
- **Input injection:** N/A — no new string parameters reach the filesystem or shell beyond those already validated.
- **Response leakage:** N/A — no new response fields.

## Edges

- `getFunction()` and `getLanguageServiceForFile()` stay on `TsMorphEngine` (not on `Engine`) — `tsExtractFunction` takes `TsMorphEngine` directly, same as `tsMoveFile`.
- The `renameLocation`-based name detection in the current operation (reading the post-edit buffer to find the generated identifier) moves verbatim into `tsExtractFunction`. No change to the algorithm.
- VolarEngine's `NOT_SUPPORTED` for `.vue` is tested at the unit level (AC1). The MCP integration test for `extractFunction` (TS path) continues to pass.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (blocked: Stryker pnpm store sandbox ENOENT in this environment)
- [x] `pnpm check` passes — 775 + 29 tests green
- [x] Docs updated:
      - `docs/architecture.md` — `extractFunction` updated to action, `extract-function.ts` added to layout
      - `docs/handoff.md` — P1 entry removed; layout updated with `extract-function.ts`
- [x] No new tech debt discovered
- [x] No gotchas worth capturing beyond what's already in architecture/feature docs
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Tests added:** 8 in `src/ts-engine/extract-function.test.ts` (7 compiler-behaviour tests moved from operation layer + 1 VolarEngine NOT_SUPPORTED). Net: +1 test total (operation tests shrank from 9 to 2, ts-engine layer gained 8).

**Mutation score:** Could not verify — Stryker fails with ENOENT when copying pnpm store symlinks into its sandbox. Pre-existing environment issue.

**Architectural decisions:**
- `VolarEngine.extractFunction()` throws `NOT_SUPPORTED` for `.vue` at the engine layer rather than in the operation. This is the correct layering — the operation is now framework-agnostic, and VolarEngine enforces its own constraints.
- `dispatcher.ts` now uses `registry.projectEngine()` for `extractFunction`, so Vue projects correctly get the `NOT_SUPPORTED` error from `VolarEngine` rather than silently succeeding with `TsMorphEngine`.
- `ExtractFunctionResult` moved from `src/operations/types.ts` to `src/ts-engine/types.ts`, consistent with where other action result types live. Re-exported from `src/operations/types.ts` so no import churn in callers.

**Deviations from spec:** None. Implementation followed the spec exactly.

**Reflection:**
- This was the final action in the engine layer migration. The pattern is now fully established and consistently applied across all six actions: deleteFile, moveFile, moveSymbol, moveDirectory, rename, extractFunction.
- The migration took the expected shape: two ACs, ~90 minutes total, clean separation of concerns.
- Next P1 is `domain/` cleanup: moving `import-rewriter.ts`, `rewrite-own-imports.ts`, `rewrite-importers-of-moved-file.ts`, `apply-rename-edits.ts` into `ts-engine/`. Now unblocked.
