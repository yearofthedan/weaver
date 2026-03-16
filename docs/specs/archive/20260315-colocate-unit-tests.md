# Colocate unit tests

**type:** change
**date:** 2026-03-15
**tracks:** handoff.md # test colocation

---

## Context

All tests currently live in a parallel `tests/` tree that mirrors `src/`. This makes it easy to miss coverage gaps, forces mental path-mapping between source and test, and means test fixtures sit far from the code they exercise. This is Phase 1 of a two-phase migration: move unit tests and fixtures next to source files. Phase 2 (separate spec) handles integration tests and removes `tests/` entirely.

## User intent

*As a developer (human or agent), I want unit tests next to the source files they test, so that I can see at a glance whether a file has tests and navigate between source and test without mental path-mapping.*

## Relevant files

- `vitest.config.ts` — update `include` to find tests in `src/`
- `vitest.stryker.config.ts` — update `include`/`exclude` patterns for new paths
- `tsconfig.json` — add excludes so `.test.ts` and `__testHelpers__/` stay out of `dist/`
- `stryker.config.mjs` — update `testFiles` patterns if referenced
- `tests/helpers.ts` — shared helper (`cleanup`, `copyFixture`, `readFile`, `fileExists`) used by both unit and integration tests; moves to `src/__testHelpers__/`
- `tests/fixtures/` — fixture directories used by unit tests; move to `src/__testHelpers__/`

### Red flags

- None identified. The move is mechanical — no logic changes, no new abstractions.

## Value / Effort

- **Value:** Developers see immediately whether a source file has a test. Removes mental path-mapping between `src/` and `tests/` trees. Colocated fixtures reduce indirection when understanding what a test exercises.
- **Effort:** Moderate — ~40 unit test files to relocate, ~10 fixture directories to move, plus config updates to vitest, tsconfig, and stryker. All mechanical moves with well-defined verification (`pnpm check` must pass). No logic changes.

## Behaviour

- [x] **AC1: Unit tests colocate with source.** Every test file that tests a single source module moves next to it: `src/operations/rename.test.ts` beside `src/operations/rename.ts`, `src/utils/errors.test.ts` beside `src/utils/errors.ts`, etc. Import paths within moved tests are updated. Unit tests are those under `tests/compilers/`, `tests/domain/`, `tests/operations/`, `tests/plugins/`, `tests/ports/`, `tests/utils/`, and `tests/daemon/dispatcher.test.ts` (which tests the dispatcher directly without subprocess spawning).
- [x] **AC2: Test fixtures move to `src/__testHelpers__/fixtures/`.** All fixture directories moved to `src/__testHelpers__/fixtures/` (with an extra `fixtures/` subfolder for clarity). `copyFixture` extracted to `src/__testHelpers__/fixtures/fixtures.ts` next to the fixtures it copies. `react-project` confirmed unused and removed. `move-dir-vue` (added by moveDirectory bug fix) also moved.
- [x] **AC3: Shared test helper moves to `src/__testHelpers__/`.** `tests/helpers.ts` moved to `src/__testHelpers__/helpers.ts`. Import paths in all 35 test files updated. `copyFixture` re-exported from `fixtures/fixtures.ts` for backward compatibility.
- [x] **AC4: Build output unchanged.** `tsc` produces the same `dist/` contents — no `.test.ts` files, no `__testHelpers__/` directories compiled into `dist/`. `tsconfig.json` excludes `src/**/*.test.ts` and `src/__testHelpers__/**`.
- [x] **AC5: All tools pass.** `pnpm check` (biome + build + test) passes. Vitest finds all unit tests at their new `src/` locations and all integration tests at their current `tests/` locations.

## Interface

No public API changes. This is an internal project structure change.

Config file changes:

| File | Change |
|------|--------|
| `tsconfig.json` | Add `"src/**/*.test.ts"` and `"src/__testHelpers__/**"` to `exclude` |
| `vitest.config.ts` | `include: ["src/**/*.test.ts", "tests/**/*.test.ts"]` (both locations during transition) |
| `vitest.stryker.config.ts` | Update `include` and `exclude` patterns to match new unit test locations |
| `stryker.config.mjs` | Update any test file patterns if they reference `tests/` |
| `biome.json` | No change needed — colocated tests are already covered by `"src/**"` |

## Security

- **Workspace boundary:** N/A — no file reads/writes at runtime; this is a project structure change.
- **Sensitive file exposure:** N/A — test files and fixtures contain no secrets.
- **Input injection:** N/A — no new parameters or user input.
- **Response leakage:** N/A — no response changes.

## Edges

- **Use light-bridge `moveFile` for all moves.** Dogfooding opportunity — the tools should handle test file moves with correct import rewriting (once the moveFile VolarCompiler blocker is fixed).
- **No test logic changes.** Tests must not be rewritten, only moved and re-imported. If a test fails after the move, the fix is the import path, not the assertion.
- **Integration tests untouched.** All tests under `tests/mcp/`, `tests/daemon/` (except `dispatcher.test.ts`), `tests/eval/`, `tests/scripts/`, `tests/security/`, and `tests/cli-workspace-default.test.ts` remain in `tests/` for Phase 2.
- **Stryker exclusion list stays equivalent.** Every test currently excluded from Stryker must remain excluded at its new path.
- **Fixture paths in test code.** Tests that reference fixtures via relative paths (e.g. `path.join(__dirname, "../fixtures/simple-ts")`) must be updated to point to `src/__testHelpers__/`.

## Blocked by

- ~~**`moveFile` doesn't rewrite imports inside moved files outside tsconfig project.**~~ Fixed — see archived spec `20260315-movefile-volar-own-imports.md`. The moved file's own imports are now rewritten. However, `moveFile` still doesn't rewrite imports **in other files** that are outside `tsconfig.include` (e.g., test files importing the moved file). See handoff.md `[needs design]` entry for the extraproject importers bug. For AC1, this means `moveFile` will move each test file and rewrite its own imports, but won't update sibling test files that import the moved test. Manual fixup may be needed.

## Done-when

- [ ] All ACs verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `dist/` contains no test files or fixture data
- [ ] All unit test files under `src/` (colocated next to source)
- [ ] All integration test files still under `tests/` (untouched)
- [ ] Docs updated:
      - handoff.md current-state directory layout
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Reflection:**

- **What went well:** `moveFile` handled all 42 file moves with correct import rewriting. The `moveDirectory` tool worked for `__helpers__/` directories (clean moves to non-existent destinations). `biome.json` fixture exclusion was a latent bug caught early by this work.
- **What did not go well:** An earlier attempt hit the `walkFiles` ENOENT bug (git ls-files --cached returning deleted files). The execution agent encountered the error but continued instead of stopping — violating the spec's instruction to stop on errors. The ENOENT was from a stale daemon running pre-fix `dist/` code, not a new bug.
- **What took longer than it should have:** Investigating whether the ENOENT was a new bug or a known one. The agent notes from the failed attempt mixed with the successful run's notes, making triage harder.
- **Recommendation for Phase 2:** Always rebuild and kill the daemon before MCP tool usage. The `moveDirectory` tool cannot merge into existing non-empty directories — use `moveFile` for files going into existing directories.

**Tests added:** 1 regression test (sequential moves in git-tracked directories)
**Total test count:** 710
**Config changes:** `vitest.config.ts`, `vitest.stryker.config.ts`, `tsconfig.json`, `biome.json` (fixture exclusion)
