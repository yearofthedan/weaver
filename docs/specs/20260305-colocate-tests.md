# Colocate tests

**type:** change
**date:** 2026-03-05
**tracks:** handoff.md # test colocation

---

## Context

All tests currently live in a parallel `tests/` tree that mirrors `src/`. This makes it easy to miss coverage gaps, forces mental path-mapping between source and test, and means test fixtures sit far from the code they exercise. Colocating unit tests and their fixtures next to source files is standard practice in modern TS/Vue projects and improves cohesion.

## Value / Effort

- **Value:** Developers (human and agent) see at a glance whether a source file has tests. Colocated fixtures reduce indirection when understanding what a test exercises. Removes the parallel-tree maintenance burden.
- **Effort:** Moderate — ~63 test files to relocate, plus config updates to vitest, tsconfig, stryker, and biome. All mechanical moves with well-defined verification (`pnpm check` must pass). No logic changes, no new infrastructure.

## Behaviour

- [ ] **AC1: Unit tests colocate with source.** Every test file that tests a single source module moves next to it: `src/operations/rename.test.ts` beside `src/operations/rename.ts`, `src/utils/errors.test.ts` beside `src/utils/errors.ts`, etc. Import paths within moved tests are updated.
- [ ] **AC2: Integration tests move to `src/__integrationTests__/`.** Tests that span multiple modules or require subprocess spawning (daemon lifecycle, MCP end-to-end, CLI, eval, security boundary) move to `src/__integrationTests__/` with current subdirectory structure preserved: `src/__integrationTests__/mcp/`, `src/__integrationTests__/daemon/`, `src/__integrationTests__/eval/`, `src/__integrationTests__/security/`, `src/__integrationTests__/scripts/`.
- [ ] **AC3: Fixtures colocate under `__fixtures__/`.** Operation-specific fixture directories move next to their test as `__fixtures__/` (e.g. `src/operations/__fixtures__/rename/`). Shared cross-cutting fixtures (like the `simple-ts` project used by many tests) move to `src/__fixtures__/`.
- [ ] **AC4: Build output unchanged.** `tsc` produces the same `dist/` contents — no `.test.ts` files, no `__fixtures__/` directories compiled into `dist/`.
- [ ] **AC5: All tools pass.** `pnpm check` (biome + build + test), `pnpm test:mutate` with the same score threshold, and vitest all pass with updated config.

## Interface

No public API changes. This is an internal project structure change.

Config file changes:

| File | Change |
|------|--------|
| `tsconfig.json` | Add `"src/**/*.test.ts"`, `"src/**/__fixtures__/**"`, and `"src/__integrationTests__/**"` to `exclude` |
| `vitest.config.ts` | `include: ["src/**/*.test.ts", "src/__integrationTests__/**/*.test.ts"]` |
| `stryker.config.mjs` | Update `testFiles` patterns from `tests/` to `src/` and `src/__integrationTests__/` |
| `biome.json` | No change needed — colocated tests and integration tests are already covered by `"src/**"` |

## Blocked by

- **`moveFile` doesn't rewrite imports inside moved files outside tsconfig project.** This spec requires moving test files from `tests/` (outside `tsconfig.json`'s `include`) into `src/`. The `moveFile` tool moves the file but doesn't rewrite the moved file's own imports. This must be fixed first — see handoff.md P1 entry.

## Edges

- **Use light-bridge `moveFile` / `moveDirectory` for all moves.** This is a dogfooding opportunity — the tools should handle test file moves with correct import rewriting (once the blocker above is fixed).
- **No test logic changes.** Tests must not be rewritten, only moved and re-imported. If a test fails after the move, the fix is the import path, not the assertion.
- **Stryker exclusion list stays equivalent.** Every test file currently excluded from Stryker's sandbox (subprocess-spawning tests) must remain excluded at its new path. The set of excluded tests must not silently shrink or grow.
- **Fixture paths in test code.** Tests that reference fixtures via relative paths (e.g. `path.join(__dirname, "../fixtures/simple-ts")`) must be updated. Search for `fixtures` in test files to find all references.
- **`tests/` directory fully removed.** No leftover files. The old directory must not exist after the migration.

## Done-when

- [ ] All ACs verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `pnpm test:mutate` passes with same break threshold (75)
- [ ] `dist/` contains no test files or fixture data
- [ ] `tests/` directory no longer exists
- [ ] All test files under `src/` (colocated unit tests and `__integrationTests__/`)
- [ ] Docs updated:
      - handoff.md current-state directory layout
      - README.md project structure (if it documents `tests/`)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
