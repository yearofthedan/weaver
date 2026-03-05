# Colocate tests

**type:** change
**date:** 2026-03-05
**tracks:** handoff.md # test colocation

---

## Context

All tests currently live in a parallel `tests/` tree that mirrors `src/`. This makes it easy to miss coverage gaps, forces mental path-mapping between source and test, and means test fixtures sit far from the code they exercise. Colocating unit tests and their fixtures next to source files is standard practice in modern TS/Vue projects and improves cohesion.

## Value / Effort

- **Value:** Developers (human and agent) see at a glance whether a source file has tests. Colocated fixtures reduce indirection when understanding what a test exercises. Removes the parallel-tree maintenance burden.
- **Effort:** Moderate — ~46 test files to relocate, plus config updates to vitest, tsconfig, stryker, and biome. All mechanical moves with well-defined verification (`pnpm check` must pass). No logic changes, no new infrastructure.

## Behaviour

- [ ] **AC1: Unit tests colocate with source.** Every test file that tests a single source module moves next to it: `src/operations/rename.test.ts` beside `src/operations/rename.ts`, `src/utils/errors.test.ts` beside `src/utils/errors.ts`, etc. Import paths within moved tests are updated.
- [ ] **AC2: Integration tests move to `__tests__/` at project root.** Tests that span multiple modules or require subprocess spawning (daemon lifecycle, MCP end-to-end, CLI, eval, security boundary) move to `__tests__/` with current subdirectory structure preserved: `__tests__/mcp/`, `__tests__/daemon/`, `__tests__/eval/`, `__tests__/security/`, `__tests__/scripts/`.
- [ ] **AC3: Operation-specific fixtures colocate as `__fixtures__/`.** Fixture directories that serve a single test file move next to that test as `__fixtures__/` (e.g. `src/operations/__fixtures__/rename/`). Shared cross-cutting fixtures (like the `simple-ts` project used by many tests) move to `__tests__/__fixtures__/`.
- [ ] **AC4: Build output unchanged.** `tsc` produces the same `dist/` contents — no `.test.ts` files, no `__fixtures__/` directories compiled into `dist/`.
- [ ] **AC5: All tools pass.** `pnpm check` (biome + build + test), `pnpm test:mutate` with the same score threshold, and vitest all pass with updated config.

## Interface

No public API changes. This is an internal project structure change.

Config file changes:

| File | Change |
|------|--------|
| `tsconfig.json` | Add `"src/**/*.test.ts"` and `"src/**/__fixtures__/**"` to `exclude` |
| `vitest.config.ts` | `include: ["src/**/*.test.ts", "__tests__/**/*.test.ts"]` |
| `stryker.config.mjs` | Update `testFiles` patterns from `tests/` to `src/` and `__tests__/` |
| `biome.json` | Update `files.includes` — replace `"tests/**"` with `"__tests__/**"` (colocated tests already covered by `"src/**"`) |

## Edges

- **No test logic changes.** Tests must not be rewritten, only moved and re-imported. If a test fails after the move, the fix is the import path, not the assertion.
- **Stryker exclusion list stays equivalent.** Every test file currently excluded from Stryker's sandbox (subprocess-spawning tests) must remain excluded at its new path. The set of excluded tests must not silently shrink or grow.
- **Fixture paths in test code.** Tests that reference fixtures via relative paths (e.g. `path.join(__dirname, "../fixtures/simple-ts")`) must be updated. Search for `fixtures` in test files to find all references.
- **`tests/` directory fully removed.** No leftover files. The old directory must not exist after the migration.
- **Git history.** Use `git mv` where possible to preserve file history.

## Done-when

- [ ] All ACs verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `pnpm test:mutate` passes with same break threshold (75)
- [ ] `dist/` contains no test files or fixture data
- [ ] `tests/` directory no longer exists
- [ ] Docs updated:
      - handoff.md current-state directory layout
      - README.md project structure (if it documents `tests/`)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

---

# Stage 2: Source refactoring for mutation speed

**depends on:** Stage 1 complete (AC4 only; AC1–AC3 and AC5 are independent)

## Context

After profiling the mutation test suite, three source files emerged as structural problems that inflate per-mutant test time and create misleading coupling:

1. **`operations/searchText.ts` is a utility provider masquerading as an operation.** `globToRegex` and `walkWorkspaceFiles` are general workspace-walking utilities — `replaceText.ts` already imports them directly from `searchText.ts`, an operation-to-operation dependency with no architectural justification. These belong in `src/utils/`.

2. **`security.ts` mixes two independent concerns.** `isSensitiveFile` is a pure pattern-matching function with no OS/FS dependencies. `isWithinWorkspace` and `validateWorkspace` are filesystem-dependent boundary checks. The test files already split these apart (`security/sensitive-files.test.ts` and `security/workspace.test.ts`); the source should match. Separating them lets `isSensitiveFile`'s 20+ pure unit tests load and run without touching any filesystem code.

3. **`operations/getTypeErrors.ts` contains `getTypeErrorsForFiles`, which is dispatcher plumbing.** `getTypeErrorsForFiles` is called only by `dispatcher.ts` to enrich post-write responses — it is not a user-facing operation. Its presence in the operation file blurs the operation/daemon boundary and forces the `getTypeErrors` test suite to mix read-only operation tests with dispatcher-helper tests that have different setup needs.

Two runtime problems also identified:

4. **Read-only test suites copy fixtures per test unnecessarily.** With Stryker's `perTest` coverage analysis every mutant reruns all covering tests. `searchText.test.ts` (13 tests) and `getTypeErrors.test.ts` (~12 tests) each call `copyFixture` inside every test body even though neither operation modifies files. With ~40–50 mutants per file this amounts to hundreds of redundant fixture copies per Stryker run. Once fixtures are colocated (Stage 1), switching read-only describe blocks to `beforeAll`/`afterAll` is straightforward.

5. **Dispatcher's `checkTypeErrors` tests run in Stryker but kill no unique mutants.** `dispatcher.ts` is excluded from mutation. The six tests in the `dispatchRequest post-write diagnostics` block cover `dispatcher.ts` logic and redundantly re-cover `getTypeErrors.ts` lines that are already covered by faster direct tests. They add ~90 seconds to every Stryker run for zero unique mutant kills.

## Value / Effort

- **Value:** Fixes a cross-operation import smell; reduces Stryker runtime by eliminating redundant fixture copies and test reruns; makes `isSensitiveFile` a dependency-free module; sharpens the operation/daemon boundary.
- **Effort:** Low-to-moderate. AC1–AC3 are source moves with import updates. AC4 is a test rewrite touching only setup/teardown, no assertions. AC5 is a one-line Stryker config change.

## Behaviour

- [ ] **AC1: `globToRegex` and `walkWorkspaceFiles` move to `src/utils/glob-walk.ts`.** The private `walkRecursive` helper moves with them. `searchText.ts` and `replaceText.ts` update their imports. `searchText.ts` no longer exports any utilities — only `searchText`. The colocated tests for `globToRegex` and `walkWorkspaceFiles` live beside `glob-walk.ts`, not inside the search operation test file.

- [ ] **AC2: `isSensitiveFile` moves to `src/utils/sensitive-files.ts`.** Its constant tables (`SENSITIVE_BASENAME_EXACT`, `SENSITIVE_EXTENSIONS`, `SENSITIVE_BASENAME_PATTERNS`) move with it. `security.ts` retains only `isWithinWorkspace` and `validateWorkspace`. All callers update their import paths. The colocated test for `isSensitiveFile` lives beside `sensitive-files.ts`.

- [ ] **AC3: `getTypeErrorsForFiles` moves to `src/daemon/post-write-diagnostics.ts`.** `dispatcher.ts` updates its import. `getTypeErrors.ts` retains `getTypeErrors`, `getForFile`, `getForProject`, `toDiagnostic`, and `MAX_DIAGNOSTICS`; the new file imports `toDiagnostic` and `MAX_DIAGNOSTICS` from `getTypeErrors.ts`. The colocated tests for `getTypeErrorsForFiles` live beside `post-write-diagnostics.ts`, separate from the `getTypeErrors` operation tests.

- [ ] **AC4: Read-only describe blocks share a single fixture copy.** In the colocated `searchText.test.ts`, all tests in the `searchText operation` describe block share one `copyFixture` call via `beforeAll`/`afterAll`. Tests that write additional files into the shared dir (binary-file test, `.env` test) clean up their additions in `afterEach`. The same pattern applies to each read-only describe block in `getTypeErrors.test.ts`. No assertions change. *(Requires Stage 1 — fixture paths differ after colocation.)*

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
- [ ] `pnpm test:mutate` score ≥ 75 and not lower than before Stage 2
- [ ] No file in `src/operations/` exports utilities imported by another operation
- [ ] `security.ts` imports only `node:fs`, `node:os`, `node:path` (no pattern-matching constants)
- [ ] `getTypeErrors.ts` does not export `getTypeErrorsForFiles`
- [ ] handoff.md directory layout updated to reflect new files
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
