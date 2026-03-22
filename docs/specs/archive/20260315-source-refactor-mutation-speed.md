# Source refactoring for mutation speed

**type:** change
**date:** 2026-03-15
**tracks:** handoff.md # source refactoring for mutation speed
**depends on:** ~~20260305-colocate-tests~~ (satisfied — both colocate specs archived)

---

## Context

After profiling the mutation test suite, three source files emerged as structural problems that inflate per-mutant test time and create misleading coupling:

1. **`operations/searchText.ts` is a utility provider masquerading as an operation.** `globToRegex` and `walkWorkspaceFiles` are general workspace-walking utilities — `replaceText.ts` already imports them directly from `searchText.ts`, an operation-to-operation dependency with no architectural justification. These belong in `src/utils/`. Note: `src/utils/file-walk.ts` already exports `walkFiles()` (extension-filtered, git-aware) and `SKIP_DIRS`. `walkWorkspaceFiles` is a near-duplicate (git-aware, glob-filtered instead of extension-filtered, its own `walkRecursive`). AC1 should consolidate them rather than creating a parallel module — see AC1 for details.

2. **`security.ts` mixes two independent concerns.** `isSensitiveFile` is a pure pattern-matching function with no OS/FS dependencies. `isWithinWorkspace` and `validateWorkspace` are filesystem-dependent boundary checks. The test files already split these apart (`security/sensitive-files.test.ts` and `security/workspace.test.ts`); the source should match. Separating them lets `isSensitiveFile`'s 20+ pure unit tests load and run without touching any filesystem code.

3. **`operations/getTypeErrors.ts` contains `getTypeErrorsForFiles`, which is dispatcher plumbing.** `getTypeErrorsForFiles` is called only by `dispatcher.ts` to enrich post-write responses — it is not a user-facing operation. Its presence in the operation file blurs the operation/daemon boundary and forces the `getTypeErrors` test suite to mix read-only operation tests with dispatcher-helper tests that have different setup needs.

Two runtime problems also identified:

4. **Read-only test suites copy fixtures per test unnecessarily.** With Stryker's `perTest` coverage analysis every mutant reruns all covering tests. `searchText.test.ts` (13 tests) and `getTypeErrors.test.ts` (~12 tests) each call `copyFixture` inside every test body even though neither operation modifies files. With ~40–50 mutants per file this amounts to hundreds of redundant fixture copies per Stryker run. Switching read-only describe blocks to `beforeAll`/`afterAll` is straightforward.

5. **Dispatcher's `checkTypeErrors` tests run in Stryker but kill no unique mutants.** `dispatcher.ts` is excluded from mutation. The six tests in the `dispatchRequest post-write diagnostics` block cover `dispatcher.ts` logic and redundantly re-cover `getTypeErrors.ts` lines that are already covered by faster direct tests. They add ~90 seconds to every Stryker run for zero unique mutant kills.

## Value / Effort

- **Value:** Fixes a cross-operation import smell; reduces Stryker runtime by eliminating redundant fixture copies and test reruns; makes `isSensitiveFile` a dependency-free module; sharpens the operation/daemon boundary.
- **Effort:** Low-to-moderate. AC1–AC3 are source moves with import updates. AC4 is a test rewrite touching only setup/teardown, no assertions. AC5 is a one-line Stryker config change.

## Behaviour

- [ ] **AC1: Consolidate file-walking utilities into `src/utils/file-walk.ts`; move `globToRegex` to `src/utils/glob-walk.ts`.** `walkWorkspaceFiles` and its private `walkRecursive` move into the existing `src/utils/file-walk.ts`, which already exports `walkFiles()`, `walkRecursive()`, and `SKIP_DIRS`. The two walkers share the same git-ls-files-with-readdir-fallback pattern — consolidate the implementation so there is one `walkRecursive` and one git-ls-files code path. `globToRegex` moves to `src/utils/globs.ts` (it is a pure string→RegExp function unrelated to file walking). `searchText.ts` and `replaceText.ts` update their imports. `searchText.ts` no longer exports any utilities — only `searchText`. Colocated tests for `globToRegex` live beside `globs.ts`; `walkWorkspaceFiles` tests live beside `file-walk.ts`.

- [ ] **AC2: `isSensitiveFile` moves to `src/utils/sensitive-files.ts`.** Its constant tables (`SENSITIVE_BASENAME_EXACT`, `SENSITIVE_EXTENSIONS`, `SENSITIVE_BASENAME_PATTERNS`) move with it. `security.ts` retains only `isWithinWorkspace` and `validateWorkspace`. All callers update their import paths. The colocated test for `isSensitiveFile` lives beside `sensitive-files.ts`.

- [ ] **AC3: `getTypeErrorsForFiles` moves to `src/daemon/post-write-diagnostics.ts`.** `dispatcher.ts` updates its import. `getTypeErrors.ts` retains `getTypeErrors`, `getForFile`, `getForProject`, `toDiagnostic`, and `MAX_DIAGNOSTICS`; the new file imports `toDiagnostic` and `MAX_DIAGNOSTICS` from `getTypeErrors.ts`. The colocated tests for `getTypeErrorsForFiles` live beside `post-write-diagnostics.ts`, separate from the `getTypeErrors` operation tests.

- [ ] **AC4: Read-only describe blocks share a single fixture copy.** In `searchText.test.ts`, all tests in the `searchText operation` describe block share one `copyFixture` call via `beforeAll`/`afterAll`. Tests that write additional files into the shared dir (binary-file test, `.env` test) clean up their additions in `afterEach`. The same pattern applies to each read-only describe block in `getTypeErrors.test.ts`. No assertions change.

- [ ] **AC5: `dispatcher.test.ts` excluded from Stryker.** Add `"src/daemon/dispatcher.test.ts"` to the `exclude` array in `vitest.stryker.config.ts`. (`dispatcher.ts` is already excluded from mutation in `stryker.config.mjs`; this excludes its *tests*, which currently run during Stryker and redundantly cover `getTypeErrors.ts` mutants without killing any unique ones.) The tests remain in the full vitest run but do not run during mutation testing. If the mutation score drops after this exclusion, the tests were killing mutants the direct operation tests were not — investigate the coverage gap rather than reverting.

## Interface

No public API changes. Internal import changes only:

| File | Change |
|------|--------|
| `src/utils/file-walk.ts` | Add: `walkWorkspaceFiles` (consolidated with existing `walkFiles`/`walkRecursive`) |
| `src/utils/globs.ts` | New: `globToRegex` |
| `src/utils/sensitive-files.ts` | New: `isSensitiveFile` + constant tables |
| `src/daemon/post-write-diagnostics.ts` | New: `getTypeErrorsForFiles` |
| `src/operations/searchText.ts` | Removes utility exports; imports from `../utils/glob-walk.js` and `../utils/file-walk.js` |
| `src/operations/replaceText.ts` | Imports `walkWorkspaceFiles` from `../utils/file-walk.js` |
| `src/security.ts` | Removes `isSensitiveFile` and its constant tables |
| `src/operations/getTypeErrors.ts` | Removes `getTypeErrorsForFiles`; exports `toDiagnostic` + `MAX_DIAGNOSTICS` for `post-write-diagnostics.ts` |
| `src/daemon/dispatcher.ts` | Imports `getTypeErrorsForFiles` from `./post-write-diagnostics.js` |
| `vitest.stryker.config.ts` | Add `src/daemon/dispatcher.test.ts` to `exclude` array |

## Edges

- **`toDiagnostic` becomes a cross-file import.** **Decision: export from `getTypeErrors.ts`.** Only two consumers (`getTypeErrors.ts` and `post-write-diagnostics.ts`), both in the same domain. A separate `utils/diagnostics.ts` would be premature.
- **`beforeAll` sharing only for read-only describe blocks.** Any describe block that writes files (`replaceText`, `deleteFile`, `extractFunction`) must keep per-test `copyFixture`. Do not share fixtures across describe blocks with different fixture state.
- **Stryker score after AC5.** If the score drops, the `checkTypeErrors` tests were killing mutants the direct tests were missing. The fix is a coverage gap in the operation tests, not reverting the exclusion.
- **`handoff.md` layout table.** The directory listing entries for `searchText.ts` and `security.ts` need updating after these moves.

## Done-when

- [x] `pnpm check` passes (lint + build + test)
- [ ] `pnpm test:mutate` score >= 75 and not lower than before — blocked by pre-existing `engine.test.ts` failure in Stryker sandbox (see handoff P1)
- [x] No file in `src/operations/` exports utilities imported by another operation
- [x] `security.ts` imports only `node:fs`, `node:os`, `node:path` (no pattern-matching constants)
- [x] `getTypeErrors.ts` does not export `getTypeErrorsForFiles`
- [x] handoff.md directory layout updated to reflect new files
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**AC1:** Consolidated `walkWorkspaceFiles` into existing `file-walk.ts`, extracted `globToRegex` to `globs.ts`. The two walkers shared git-ls-files + readdir-fallback logic — now one code path. `globs.ts` at 100% mutation score.

**AC2:** Extracted `isSensitiveFile` + constant tables to `utils/sensitive-files.ts`. `security.ts` now only contains workspace boundary checks.

**AC3:** Moved `getTypeErrorsForFiles` to `daemon/post-write-diagnostics.ts`. Exported `toDiagnostic` and `MAX_DIAGNOSTICS` from `getTypeErrors.ts` (two consumers, same domain — no separate utils module needed).

**AC4:** Already satisfied — the AC1 and AC2 agents refactored both test files to use `beforeAll`/`afterAll` as part of their moves.

**AC5:** Added `dispatcher.test.ts` to the exclude array in `vitest.stryker.config.ts`.

**Reflection:** The spec was well-scoped — all changes were small moves. AC4 turned out to be a no-op because the execution agents for AC1/AC2 already applied the shared-fixture pattern when moving tests. The `file-walk.ts` consolidation (AC1) was the most valuable structural change — eliminating a near-duplicate walker. The mutation score check (`pnpm test:mutate`) has not been run yet; the runtime improvement from AC4+AC5 should be verified on the next Stryker run.
