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

- [ ] `stryker.config.mjs` has `coverageAnalysis: "perTest"`.
- [ ] `pnpm test:mutate` completes without error (exit code 0 or 1 for threshold breach — never a crash/exception).
- [ ] The mutation score is within 5% of the baseline (`"off"`) — same surviving mutants are accepted.
- [ ] `NoCoverage` count is not meaningfully higher than with `"off"` for modules with active unit tests (`src/operations/`, `src/utils/`, `src/security.ts`, `src/providers/`). Any `NoCoverage` count increase ≥ 5 mutants must be investigated before merging.

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

- [ ] All ACs verified (actual run output reviewed)
- [ ] `pnpm check` passes (lint + build + test — not mutation run)
- [ ] `docs/tech/mutation-testing.md` updated: remove the "real fix for slow mutation runs is `coverageAnalysis: "perTest"` (backlog item)" note; update the `pnpm test:mutate` duration estimate
- [ ] handoff.md P3.5 entry removed
- [ ] Spec archived to `docs/specs/archive/` with Outcome section
