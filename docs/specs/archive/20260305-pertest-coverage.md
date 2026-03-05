# Enable Stryker `coverageAnalysis: "perTest"`

**type:** change
**date:** 2026-03-05
**tracks:** handoff.md # P3.5 → (no feature doc — config-only change)

---

## Context

`stryker.config.mjs` currently sets `coverageAnalysis: "off"`, which runs every test for every mutant. With 413 tests and hundreds of mutants the run takes over an hour. `perTest` mode performs one initial dry-run to record which tests hit which mutants, then runs only the relevant subset per mutant — typically a 5–10× speedup.

The handoff entry flagged "validate Vitest's Istanbul provider in the sandbox." After reading `@stryker-mutator/vitest-runner@9.6.0`, this concern is unfounded: the runner explicitly sets `coverage: { enabled: false }` and uses its own instrumentation (the `__stryker__` global) to track per-test hits — no Istanbul or V8 provider is involved.

## Value / Effort

- **Value:** Multi-hour mutation runs are a friction tax on every quality pass. Cutting them to ~10–20 min makes them runnable on-demand, not just in CI.
- **Effort:** One-line config change. Validation requires one full run to confirm the score is stable and NoCoverage count is not inflated.

## Behaviour

- [x] `stryker.config.mjs` has `coverageAnalysis: "perTest"`.
- [x] `pnpm test:mutate` completes without error (exit code 0 or 1 for threshold breach — never a crash/exception).
- [x] The mutation score is within 5% of the baseline (`"off"`) — same surviving mutants are accepted.
- [x] `NoCoverage` count is not meaningfully higher than with `"off"` for modules with active unit tests (`src/operations/`, `src/utils/`, `src/security.ts`, `src/providers/`). Any `NoCoverage` count increase ≥ 5 mutants must be investigated before merging.

## Interface

Config-only change. No public surface changes. The `stryker.config.mjs` diff is:

```diff
- coverageAnalysis: "off",
+ coverageAnalysis: "perTest",
```

## Edges

- Stryker's instrumenter inserts `__stryker__` calls **inline** (not prepended), so line numbers in the sandbox are not shifted. The existing `disableTypeChecks: false` guard is sufficient; no additional line-shift protection is needed.
- `vitest.related: false` in the config is unchanged — Stryker does its own test filtering; `related` is for vitest's import-graph filter, which is separate.
- `timeoutMS: 120_000` is unchanged. Per-mutant runs will be shorter, so this remains a safe ceiling.
- The existing `concurrency: 2` setting is unchanged. perTest may allow raising this later, but that's out of scope.

## Done-when

- [x] All ACs verified (actual run output reviewed)
- [x] `pnpm check` passes (lint + build + test — not mutation run)
- [x] `docs/tech/mutation-testing.md` updated: remove the "real fix for slow mutation runs is `coverageAnalysis: "perTest"` (backlog item)" note; update the `pnpm test:mutate` duration estimate
- [x] handoff.md P3.5 entry removed
- [x] Spec archived to `docs/specs/archive/` with Outcome section

---

## Outcome

**Tests added:** 0 (config-only change)

**Mutation score (security.ts scoped run):**
- Baseline `"off"` + broken exclusions: 86.96%, 8m02s, 459 tests
- Final `"perTest"` + fixed exclusions: 88.41%, 2m51s, 413 tests — **~2.8× speedup**

**Discoveries during implementation:**

1. **The Istanbul concern in the handoff was wrong.** `@stryker-mutator/vitest-runner` sets `coverage: { enabled: false }` and uses its own `__stryker__` global instrumentation for perTest coverage — no Istanbul/V8 dependency.

2. **Stryker `testFiles` negation patterns have always been silently broken.** `FileMatcher` calls `path.resolve(pattern)`, turning `!tests/foo.test.ts` into `/abs/path/!tests/foo.test.ts`. The `!` becomes a literal path character; the exclusion never fires. All 49 test files (including subprocess-spawning daemon/MCP tests) were running in every dry-run. Fixed by moving to a dedicated `vitest.stryker.config.ts` that uses vitest's `exclude:` array (which handles negation correctly).

3. **`perTest` alone gave ~15% speedup; fixing the exclusions gave the rest.** With broken exclusions, daemon/MCP tests contributed to the dry-run cost (459 tests, 2min dry-run). After fixing, dry-run dropped to 41s (413 tests). The combined effect: 2.8× speedup on `security.ts`.

4. **`pnpm test:mutate:ci` was a dead reference** — removed from `mutation-testing.md`.
