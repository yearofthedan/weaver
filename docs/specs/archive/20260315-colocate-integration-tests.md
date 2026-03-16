# Colocate integration tests

**type:** change
**date:** 2026-03-15
**tracks:** handoff.md # test colocation

---

## Context

Phase 2 of test colocation. Phase 1 moved unit tests next to source and fixtures to `src/__testHelpers__/`. Integration tests still live in the `tests/` tree. This spec moves them to colocated `*.integration.test.ts` files next to their entry points, moves integration-only helpers to `src/__testHelpers__/`, and removes the `tests/` directory entirely.

## User intent

*As a developer (human or agent), I want integration tests colocated next to the entry points they exercise, so that the test tree mirrors the source tree consistently and the parallel `tests/` directory is eliminated.*

## Relevant files

- `vitest.config.ts` — update `include` to drop `tests/` patterns
- `vitest.stryker.config.ts` — update `include`/`exclude` patterns
- `tsconfig.json` — add `*.integration.test.ts` to excludes
- `tests/mcp-helpers.ts` — MCP test utilities; integration-only
- `tests/process-helpers.ts` — subprocess spawning utilities; integration-only
- `tests/fake-daemon.ts` — fake daemon script for protocol tests; integration-only

### Red flags

- None identified. Mechanical moves.

## Value / Effort

- **Value:** Eliminates the parallel `tests/` tree entirely. Integration tests sit next to the entry point they exercise, making it obvious what's covered. One convention for the whole project.
- **Effort:** Low-moderate — ~20 integration test files to relocate plus 3 helper files. Config updates are incremental on top of Phase 1 changes.

## Behaviour

- [x] **AC1: Integration tests colocate as `*.integration.test.ts`.** Tests that map to a source entry point move next to it with the `.integration.test.ts` suffix. Mapping:
  - `tests/daemon/{daemon,stop,stop-daemon,run-functions,protocol-version,watcher}.test.ts` → `src/daemon/*.integration.test.ts`
  - `tests/daemon/serve.test.ts` → `src/daemon/serve.integration.test.ts`
  - `tests/mcp/{find-references,get-definition,move-file,move-symbol,rename,run-serve,security,call-daemon-timeout,error-masking}.test.ts` → `src/mcp.integration.test.ts` or `src/mcp/` if it becomes a directory
  - `tests/security/{sensitive-files,workspace}.test.ts` → `src/security.integration.test.ts`
- [x] **AC2: Cross-cutting integration tests move to `src/`.** Tests with no clear single entry point move to `src/` as `*.integration.test.ts`:
  - `tests/cli-workspace-default.test.ts` → `src/cli-workspace-default.integration.test.ts`
  - `tests/eval/{fixture-coverage,fixture-server}.test.ts` → `src/eval-fixture-coverage.integration.test.ts`, `src/eval-fixture-server.integration.test.ts`
  - `tests/scripts/{agent-conventions,skill-file}.test.ts` → `src/agent-conventions.integration.test.ts`, `src/skill-file.integration.test.ts`
- [x] **AC3: Integration-only helpers move to `src/__testHelpers__/`.** `tests/mcp-helpers.ts`, `tests/process-helpers.ts`, and `tests/fake-daemon.ts` move to `src/__testHelpers__/`.
- [x] **AC4: `tests/` directory fully removed.** No leftover files. The old directory must not exist after the migration.
- [x] **AC5: All tools pass.** `pnpm check` (biome + build + test) passes. `pnpm test:mutate` passes with the same break threshold (75). Vitest finds all tests under `src/`.

## Interface

No public API changes. This is an internal project structure change.

Config file changes:

| File | Change |
|------|--------|
| `tsconfig.json` | Add `"src/**/*.integration.test.ts"` to `exclude` (if not already covered by a broader pattern) |
| `vitest.config.ts` | `include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"]`, remove `tests/` patterns |
| `vitest.stryker.config.ts` | Replace per-file exclusion list with single glob: `"src/**/*.integration.test.ts"`. Stryker runs unit tests only — integration tests are noise for mutation testing (slow, imprecise, flaky). |
| `stryker.config.mjs` | No change expected — `mutate` targets `src/**/*.ts` which already excludes test files via other config |

## Security

- **Workspace boundary:** N/A — project structure change only.
- **Sensitive file exposure:** N/A — test files contain no secrets.
- **Input injection:** N/A — no new parameters.
- **Response leakage:** N/A — no response changes.

## Edges

- **Use light-bridge `moveFile` for all moves.** Dogfooding opportunity.
- **No test logic changes.** Tests must not be rewritten, only moved and re-imported.
- **Stryker exclusion list stays equivalent.** Every test currently excluded from Stryker's sandbox (subprocess-spawning tests) must remain excluded at its new path. The set must not silently shrink or grow.
- **MCP tests may consolidate or stay separate.** If MCP tests remain as separate files, they could go in a `src/mcp/` directory alongside a future `mcp.ts` extraction. The spec doesn't mandate consolidation — just colocation.

## Blocked by

- Phase 1 (colocate unit tests) must land first.

## Done-when

- [x] All ACs verified by tests
- [x] `pnpm check` passes (lint + build + test)
- [x] `pnpm test:mutate` passes with same break threshold (75)
- [x] `dist/` contains no test files or fixture data
- [x] `tests/` directory no longer exists
- [x] All test files under `src/` (colocated unit tests and `*.integration.test.ts`)
- [x] Docs updated:
      - handoff.md current-state directory layout
      - README.md project structure (if it documents `tests/`)
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Tests moved:** ~20 integration test files + 3 helpers. `tests/` directory fully eliminated.

**Key decisions made during implementation:**
- MCP tests went into `src/mcp/` directory (option a), which required moving `src/mcp.ts` → `src/mcp/mcp.ts` first
- Security tests formerly misnamed as `*.integration.test.ts` (pure unit tests for `isSensitiveFile`, `isWithinWorkspace`, `validateWorkspace`) were consolidated into `src/security.test.ts`
- 3 daemon tests (`ensure-daemon`, `language-plugin-registry`, `paths`) were correctly identified as unit tests and moved as `*.test.ts`, not `*.integration.test.ts`
- `vitest.config.ts` simplified to single include: `["src/**/*.test.ts"]` — the `*.integration.test.ts` pattern is redundant since it matches `*.test.ts`

**Test count:** 710 tests across 65 files, all passing.

**Reflection:**
- What went well: light-bridge `moveFile` handled the bulk moves correctly and rewrote all imports. The `walkFiles` ENOENT fix (from a prior commit) was essential — without it, sequential moves in git-tracked directories would fail.
- What did not go well: The execution agent disabled `checkTypeErrors` on all moves (told to do so by dispatch instructions that were too broad). Independent moves should always check types. The agent also continued past errors instead of stopping, requiring manual intervention. Security tests were misclassified as integration tests by the spec — caught during review.
- What took longer than expected: Debugging the ENOENT in `walkFiles` consumed significant time before realising the daemon was running stale compiled code from `dist/`. The fix was already in source but the daemon hadn't been rebuilt.
- Recommendation for next agent: Always rebuild (`pnpm build`) before running integration tests that hit the daemon. When dispatching to execution agents, only pass `checkTypeErrors: false` for interdependent batched moves, never for independent ones. Stop on first error — do not continue and hope errors are transient.
