# Source refactoring for mutation speed

**type:** change
**date:** 2026-03-15
**tracks:** handoff.md # source refactoring for mutation speed
**depends on:** 20260305-colocate-tests (test colocation must land first)

---

## Context

After profiling the mutation test suite, three source files emerged as structural problems that inflate per-mutant test time and create misleading coupling:

1. **`operations/searchText.ts` is a utility provider masquerading as an operation.** `globToRegex` and `walkWorkspaceFiles` are general workspace-walking utilities — `replaceText.ts` already imports them directly from `searchText.ts`, an operation-to-operation dependency with no architectural justification. These belong in `src/utils/`.

2. **`security.ts` mixes two independent concerns.** `isSensitiveFile` is a pure pattern-matching function with no OS/FS dependencies. `isWithinWorkspace` and `validateWorkspace` are filesystem-dependent boundary checks. The test files already split these apart (`security/sensitive-files.test.ts` and `security/workspace.test.ts`); the source should match. Separating them lets `isSensitiveFile`'s 20+ pure unit tests load and run without touching any filesystem code.

3. **`operations/getTypeErrors.ts` contains `getTypeErrorsForFiles`, which is dispatcher plumbing.** `getTypeErrorsForFiles` is called only by `dispatcher.ts` to enrich post-write responses — it is not a user-facing operation. Its presence in the operation file blurs the operation/daemon boundary and forces the `getTypeErrors` test suite to mix read-only operation tests with dispatcher-helper tests that have different setup needs.

Two runtime problems also identified:

4. **Read-only test suites copy fixtures per test unnecessarily.** With Stryker's `perTest` coverage analysis every mutant reruns all covering tests. `searchText.test.ts` (13 tests) and `getTypeErrors.test.ts` (~12 tests) each call `copyFixture` inside every test body even though neither operation modifies files. With ~40–50 mutants per file this amounts to hundreds of redundant fixture copies per Stryker run. Switching read-only describe blocks to `beforeAll`/`afterAll` is straightforward.

5. **Dispatcher's `checkTypeErrors` tests run in Stryker but kill no unique mutants.** `dispatcher.ts` is excluded from mutation. The six tests in the `dispatchRequest post-write diagnostics` block cover `dispatcher.ts` logic and redundantly re-cover `getTypeErrors.ts` lines that are already covered by faster direct tests. They add ~90 seconds to every Stryker run for zero unique mutant kills.

## Value / Effort

- **Value:** Fixes a cross-operation import smell; reduces Stryker runtime by eliminating redundant fixture copies and test reruns; makes `isSensitiveFile` a dependency-free module; sharpens the operation/daemon boundary.
- **Effort:** Low-to-moderate. AC1–AC3 are source moves with import updates. AC4 is a test rewrite touching only setup/teardown, no assertions. AC5 is a one-line Stryker config change.

## Behaviour

- [ ] **AC1: `globToRegex` and `walkWorkspaceFiles` move to `src/utils/glob-walk.ts`.** The private `walkRecursive` helper moves with them. `searchText.ts` and `replaceText.ts` update their imports. `searchText.ts` no longer exports any utilities — only `searchText`. The colocated tests for `globToRegex` and `walkWorkspaceFiles` live beside `glob-walk.ts`, not inside the search operation test file.

- [ ] **AC2: `isSensitiveFile` moves to `src/utils/sensitive-files.ts`.** Its constant tables (`SENSITIVE_BASENAME_EXACT`, `SENSITIVE_EXTENSIONS`, `SENSITIVE_BASENAME_PATTERNS`) move with it. `security.ts` retains only `isWithinWorkspace` and `validateWorkspace`. All callers update their import paths. The colocated test for `isSensitiveFile` lives beside `sensitive-files.ts`.

- [ ] **AC3: `getTypeErrorsForFiles` moves to `src/daemon/post-write-diagnostics.ts`.** `dispatcher.ts` updates its import. `getTypeErrors.ts` retains `getTypeErrors`, `getForFile`, `getForProject`, `toDiagnostic`, and `MAX_DIAGNOSTICS`; the new file imports `toDiagnostic` and `MAX_DIAGNOSTICS` from `getTypeErrors.ts`. The colocated tests for `getTypeErrorsForFiles` live beside `post-write-diagnostics.ts`, separate from the `getTypeErrors` operation tests.

- [ ] **AC4: Read-only describe blocks share a single fixture copy.** In `searchText.test.ts`, all tests in the `searchText operation` describe block share one `copyFixture` call via `beforeAll`/`afterAll`. Tests that write additional files into the shared dir (binary-file test, `.env` test) clean up their additions in `afterEach`. The same pattern applies to each read-only describe block in `getTypeErrors.test.ts`. No assertions change.

- [ ] **AC5: `dispatchRequest post-write diagnostics` tests excluded from Stryker.** The six tests in that describe block are added to `stryker.config.mjs`'s `testFiles` exclusion list. They remain in the full vitest run but do not run during mutation testing. If the mutation score drops after this exclusion, the tests were killing mutants the direct operation tests were not — investigate the coverage gap rather than reverting.

## Interface

No public API changes. Internal import changes only:

| File | Change |
|------|--------|
| `src/utils/glob-walk.ts` | New: `globToRegex`, `walkWorkspaceFiles`, `walkRecursive` |
| `src/utils/sensitive-files.ts` | New: `isSensitiveFile` + constant tables |
| `src/daemon/post-write-diagnostics.ts` | New: `getTypeErrorsForFiles` |
| `src/operations/searchText.ts` | Removes utility exports; imports from `../utils/glob-walk.js` |
| `src/operations/replaceText.ts` | Imports `walkWorkspaceFiles` from `../utils/glob-walk.js` |
| `src/security.ts` | Removes `isSensitiveFile` and its constant tables |
| `src/operations/getTypeErrors.ts` | Removes `getTypeErrorsForFiles`; exports `toDiagnostic` + `MAX_DIAGNOSTICS` for `post-write-diagnostics.ts` |
| `src/daemon/dispatcher.ts` | Imports `getTypeErrorsForFiles` from `./post-write-diagnostics.js` |
| `stryker.config.mjs` | Add `checkTypeErrors` describe-block path to `testFiles` exclusion list |

## Edges

- **`toDiagnostic` becomes a cross-file import.** Exporting it from `getTypeErrors.ts` is the simplest path. If that feels like an internal implementation detail leaking across the module boundary, an alternative is to move `toDiagnostic` and `MAX_DIAGNOSTICS` to `src/utils/diagnostics.ts` — either is acceptable, choose what's cleaner at implementation time.
- **`beforeAll` sharing only for read-only describe blocks.** Any describe block that writes files (`replaceText`, `deleteFile`, `extractFunction`) must keep per-test `copyFixture`. Do not share fixtures across describe blocks with different fixture state.
- **Stryker score after AC5.** If the score drops, the `checkTypeErrors` tests were killing mutants the direct tests were missing. The fix is a coverage gap in the operation tests, not reverting the exclusion.
- **`handoff.md` layout table.** The directory listing entries for `searchText.ts` and `security.ts` need updating after these moves.

## Done-when

- [ ] `pnpm check` passes (lint + build + test)
- [ ] `pnpm test:mutate` score >= 75 and not lower than before
- [ ] No file in `src/operations/` exports utilities imported by another operation
- [ ] `security.ts` imports only `node:fs`, `node:os`, `node:path` (no pattern-matching constants)
- [ ] `getTypeErrors.ts` does not export `getTypeErrorsForFiles`
- [ ] handoff.md directory layout updated to reflect new files
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
