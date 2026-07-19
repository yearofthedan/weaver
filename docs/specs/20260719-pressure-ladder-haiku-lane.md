# Pressure ladder for the Haiku lane

**type:** change
**date:** 2026-07-19
**tracks:** handoff.md # Pressure ladder for the Haiku lane (scenario matrix) → docs/eval-design.md

---

## Context

The Haiku trigger lane sits at the 15/15 ceiling, so a skill-text regression is invisible until it is catastrophic. The pressure-ladder spike ([findings](archive/20260717-pressure-ladder-spike.md)) proved the lane *can* discriminate — a buried task phrasing under a three-turn true-shell momentum seed collapsed from a 6/6 ceiling to 1/6 — and that **seed depth is the dominant lever** (buried phrasing alone barely moves the rate; the multi-turn true-shell seed is what breaks convergence). It also found the shipped `buildHabitMomentumSeed` is *weaver-shaped* — its "find all files that import Logger" pre-step is `find-importers`-shaped work weaver owns — which violates the momentum-seed principle in `docs/eval-design.md` ("a momentum seed primes a habit, not a substitution precedent") and must be replaced.

## User intent

*As the weaver maintainer, I want the Haiku trigger lane to show a visible rate drop when skill text regresses under realistic pressure, so that a routing regression is caught on a `pnpm eval` run instead of staying masked by a 15/15 ceiling.*

## Relevant files

- `eval/harness/seed.ts` — `buildHabitMomentumSeed` (the weaver-shaped seed to replace) and `buildSeedMessages` (two-step seed, unchanged); the true-shell pre-step pool lands here.
- `eval/harness/seed.test.ts` — where AC1's unit tests go.
- `eval/cases/cases.ts` — the typed `CaseEntry` table; gains `momentumTurns` + `observational` fields and the new pressured / adjacent-negative rows.
- `eval/cases/cases.test.ts` — structural table validation; AC3/AC4 assert the new rows here (no paid run needed).
- `eval/cases/trigger-agentic.llm.test.ts` — the agentic lane; builds the seed uniformly today (`...buildHabitMomentumSeed(c.task)`), gates every skill-trigger case at the 2/3 floor. Gains per-case seed depth via `seedForCase` and per-case gating via `caseIsGating`.
- `eval/harness/grade.ts` — `SUBCOMMAND_MUTABILITY` / `isMutatingCompetitor`; unchanged, but the hard-fail verdict is the mechanism the pressured cases exercise.
- `eval/fixtures/searchText-userId.json`, `searchText-v1.json` — existing precursor fixtures the buried cases reuse for on-path search hops.
- `docs/eval-design.md` — the lane's design doc; the seed section, the "Don't tier what n=3 can't resolve" section, and the momentum-seed principle all constrain this change and get updated.

### Red flags

- `eval/cases/trigger-agentic.llm.test.ts` is already long (two near-duplicate `it.each` blocks with per-trial trail formatting). Do not grow it by inlining seed/gating logic — extract `seedForCase(c)` and `caseIsGating(c)` as pure helpers (co-located with the case table or in the harness) so the lane only *reads* the decision. This keeps the paid-lane file thin and the decisions unit-testable offline.

**Test hotspots:** `seed.test.ts` and `cases.test.ts` are the offline test targets and are not near threshold. The paid `.llm.test.ts` files are not unit tests and are not counted against the threshold.

**Layer-fit check (per AC):**
- AC1 (seed builder) — **pure** function of `(task, turns)`; unit-test in `seed.test.ts`, no model.
- AC2 (`seedForCase`, `caseIsGating`) — **pure** helpers over a `CaseEntry`; unit-test directly. The lane wiring that consumes them is trivial delegation exercised only by the paid lane.
- AC3/AC4 (case rows) — **structural**; assert the rows' measurable properties in `cases.test.ts`. Discrimination itself is confirmed by the spike + a maintainer paid run, not by an offline assertion.

## Value / Effort

- **Value:** Today a routing regression in any of the four highest-traffic skills (`rename`, `replace-text`, `search-text`, `find-references`) is invisible on the eval — every case reads 3/3 whether the text is good or broken. After this change the maintainer runs `pnpm eval trigger-agentic`, reads the pressured rungs, and sees a rate that *moved* — the relative-movement signal `eval-design.md` calls "the point." It also removes a latent contaminant (the weaver-shaped seed that teaches substitution rather than habit), so every trigger-case rate becomes trustworthy.
- **Effort:** Confined to `eval/`. One source file rewritten (`seed.ts`), two small pure helpers, a handful of case-table rows, offline unit/structural tests, and a doc update. No engine, daemon, or CLI surface touched. No new infrastructure — `WEAVER_EVAL_TRIALS` already handles n-escalation and the agentic loop already measures the eventual operation.

## Behaviour

- [ ] **AC1 — True-shell multi-turn momentum seed.** `buildHabitMomentumSeed(task, turns)` returns a `ChatMessage[]` that prepends `turns` distinct true-shell pre-step exchanges before the task, each a standard four-message tool cycle (user request → assistant `bash` tool call → `tool` result → assistant one-line summary), followed by `{ role: "user", content: task }`.
  - Given `turns = 2`, produces `2 × 4 + 1 = 9` messages ending in the task; the two seeded `bash` commands are **distinct** and drawn from the true-shell pool (log grep, `git log --grep`, `find` by name).
  - Given `turns = 0`, produces exactly `[{ role: "user", content: task }]` (no seed).
  - Given `turns` omitted, defaults to `1` pre-step (`5` messages).
  - Given `turns` greater than the pool size, **throws** (loud) rather than cycling or silently under-seeding.
  - Every seeded assistant `bash` command is work weaver does not own: assert each parses as a shell tool (`grep`/`git`/`find`) and **not** as a `weaver <subcommand>` invocation (reuse `isWeaverInvocation` / `weaverSubcommand` from `assertions.ts` to prove the negative).
  - *Laziest wrong impl:* returns the same single grep regardless of `turns` — killed by the distinct-commands and length-scaling assertions. *Type matrix:* the only input axis is `turns` (0 / 1 / n / over-pool); each is a separate assertion above.

- [ ] **AC2 — Per-case seed depth and observational flag, honoured by the lane.** `CaseEntry` gains `momentumTurns?: number` (default `1`) and `observational?: boolean` (default `false`). Two pure helpers live in a **mutated harness file** (not the `.llm.test.ts`, which Stryker's eval lane does not mutate) so their defaults are mutation-covered:
  - `seedForCase(c)` → `buildHabitMomentumSeed(c.task, c.momentumTurns ?? 1)`. Given a case with `momentumTurns: 3`, seeds three pre-steps; given a case without the field, seeds one.
  - `caseIsGating(c)` → `!(c.observational ?? false)`. Given `observational: true`, returns `false`; given the field absent, returns `true`.
  - The agentic trigger lane prints the rate + trail for **every** skill-trigger case (unchanged), but wraps the `belowAlarm` floor assertion in `caseIsGating(c)` — observational cases report without gating; existing cases keep gating.
  - **The load-bearing unit test for each helper is the *safe default*, not the happy path.** `seedForCase` with the field absent must seed exactly one turn (pins `?? 1` — a mutation to `?? 0` strips every pressured case's seed and silently restores the ceiling). `caseIsGating` with the field absent must return `true` (pins `?? false` — a mutation to `?? true` turns the whole lane observational and drops the floor). These two assertions are what earn the exports; write them explicitly.
  - **Keep the flag as a `CaseEntry` field, not a third `CASES.filter(observational)` partition.** Observational cases are still skill-trigger cases and share that `it.each` block; a partition would force a third near-duplicate block. The field read inside the existing block via `caseIsGating` is the leaner shape.
  - *Layer-fit:* the helpers are unit-tested at the harness layer; the lane's guarded assertion is trivial delegation exercised only by the paid lane.

- [ ] **AC3 — Pressured buried cases for the four high-signal commands.** For each of `rename`, `replace-text`, `search-text`, `find-references`, add one trigger case with: buried phrasing (the op request embedded inside a broader, multi-part task), `momentumTurns: 3`, `observational: true`, and `expect.skill`/`expect.command` for the owning op.
  - **AC3 ships four hypotheses, not four proven rungs. Only `rename` is spike-proven** (buried + no-coords + deep seed → 1/6 via precursor-stall). The other three are reasoned extrapolation; the maintainer calibration run (Done-when) tells you which actually move. A green `pnpm check` means the *instrument is wired*, never that the lane discriminates on these three.
  - **Coords co-vary with the discrimination mechanism — do not blanket-hand coordinates.** For the **mutating** targets (`rename`, `replace-text`), *withhold* coordinates and own the search precursor fixture (`searchText-userId.json` for rename, `searchText-v1.json` for replace) — this reproduces the spike-proven precursor-stall path (the model reaches read-only weaver ops, then stalls in `cat`/grep instead of converting to the mutating op). Per spike finding #5, real coordinate-carry happens only through an owned `search-text` result, so a no-coords case must own that fixture or it strands on the neutral stub. For the **read-only** targets (`search-text`, `find-references`), there is no mutating conversion to stall on — the discriminator is whether the model ever leaves grep for weaver at all — so give coordinates where the op needs them and do not manufacture a precursor. This mechanism difference is why the three non-rename rungs are hypotheses.
  - *Structural assertion (`cases.test.ts`):* for each of the four commands there is ≥1 trigger case with `observational === true` and `momentumTurns >= 3` and the matching `expect.command`.
  - *Laziest wrong impl:* reuse a direct phrasing under the deep seed — the structural test pins the measurable properties (observational, deep seed, command); the buried framing is a human-review property noted in the case comment.

- [ ] **AC4 — Adjacent-negative boundary cases.** Add three `expect.skill: "bash"` boundary cases that sit close to weaver's territory and must **not** pull a skill in: (1) rename a single local variable used only inside one function (a plain Edit, not a project-wide `weaver-refactor` rename); (2) a text search in a non-TypeScript/Vue project (no compiler value, plain shell search is correct); (3) remove a stray `console.log` (a one-off edit).
  - *Structural assertion (`cases.test.ts`):* the three cases exist with `expect.skill === "bash"` and distinct tasks.
  - The boundary lane already passes only when every trial is clean (no skill load, no weaver call); these cases inherit that gating unchanged.

- [ ] **Doc — `eval-design.md`.** Update the seed description (true-shell multi-turn, depth as a first-class lever, the pool + throw-on-over-pool rule) and add the observational-pressured-case concept to the agentic-lane section (pressured rungs report movement, do not gate; gating stays on the ceiling cases as the floor and the boundary cases as the over-trigger guard). State that seed depth co-varies with the rung: light rungs (existing direct/indirect cases) keep depth 1 as ceiling canaries; the buried rung uses depth 3 as the discriminator.

## Interface

Eval-internal only — no shipped CLI, MCP, or engine surface changes.

`CaseEntry` (`eval/cases/cases.ts`) gains two optional fields:

- **`momentumTurns?: number`** — number of true-shell pre-step exchanges the agentic trigger lane seeds before the task. Contains a small non-negative integer. Realistic bounds: `0`–`3` (pool size). Zero/empty: absent ⇒ `1` (current single-turn behaviour). Adversarial: a value beyond the pool ⇒ `buildHabitMomentumSeed` throws. Only the agentic trigger lane reads it; command/two-step lanes ignore it.
- **`observational?: boolean`** — when `true`, the agentic trigger lane reports the case's rate + trail but does not assert the `belowAlarm` floor. Contains a flag. Zero/empty: absent ⇒ `false` (gating, current behaviour). Only meaningful on `stage: "trigger"` skill cases (not boundary cases, which have their own clean-across-trials gate).

`buildHabitMomentumSeed(task: string, turns?: number): ChatMessage[]` — signature gains `turns` (default `1`). Existing single-arg callers keep current behaviour.

Two pure helpers (exported for unit tests, consumed by the lane): `seedForCase(c: CaseEntry): ChatMessage[]` and `caseIsGating(c: CaseEntry): boolean`.

**Design-shape check:** no new transport entry point; no `node:fs` (the seed is static in-memory test data). The lane stays thin — it reads `seedForCase`/`caseIsGating` rather than computing depth or gating inline.

## Open decisions

- **Gating mode for the pressured cases — RESOLVED: observational.** The pressured buried cases report their rate + trail but carry no pass/fail assertion; gating stays on the existing ceiling trigger cases (the catastrophic floor) and the boundary cases (over-trigger). *Reasoning:* at n=3 the only passing non-ceiling rate is exactly 2/3 — a single knife-edge point indistinguishable from sampling noise (`eval-design.md`, "Don't tier what n=3 can't resolve"). The spike puts the buried+deep rung at ~1/6, so a 2/3 gate would fail today and force a paid tuning loop the execution agent cannot run. The lane is on-demand and human-read; the improvement over today is that the pressured rungs *move* on a run instead of pinning at 3/3, which observation captures directly. *Consequences:* regressions surface as visible rate drops, not automated failures — the maintainer reads the ladder before/after a skill edit and re-runs a surprising flip at `WEAVER_EVAL_TRIALS=6`. Revisit a gate for a pressured case only if a later spike pins a stable ≥2/3 point.

## Security

- **Workspace boundary:** N/A — no file reads or writes; the seed is static in-memory test data and the eval never executes emitted commands.
- **Sensitive file exposure:** N/A — no file content is read.
- **Input injection:** N/A — the new `momentumTurns`/`observational` fields are typed table data, never interpolated into a path or shell command.
- **Response leakage:** N/A — no user-controlled strings enter error messages or responses; the throw on over-pool `turns` carries only the requested count and pool size.

## Edges

- **The seed swap must not break the floor.** After replacing the weaver-shaped seed with the true-shell depth-1 seed, the existing gating trigger cases must stay green and the boundary cases must stay clean. This is the regression guard for AC1/AC2 — verified by a maintainer paid run, noted in the Outcome.
- **Coverage invariant unaffected.** `eval/cases/coverage.test.ts` requires a command-stage case per operation; trigger cases are not per-operation, so adding trigger rows does not change coverage. New boundary/pressured cases must not collide with existing case `name`s (the table is keyed by name in trails).
- **Two-step seed untouched.** `buildSeedMessages` and the two-step carry-through cases are a separate seed mechanism and must not change.
- **`momentumTurns` is bounded by the pool.** The pool holds ≥3 distinct true-shell steps; a request beyond it throws rather than cycling — a typo must fail loud, not silently seed fewer/duplicate turns.

## Done-when

- [ ] All ACs verified: AC1 by `seed.test.ts`, AC2 by helper unit tests, AC3/AC4 by `cases.test.ts` structural assertions.
- [ ] Mutation score ≥ threshold for `eval/harness/seed.ts` and any new helper file (`pnpm test:mutate:eval:file`).
- [ ] `pnpm check` passes (offline — no paid run required to pass the gate).
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`; extract per the test-refactoring hierarchy if implementation pushes one past threshold.
- [ ] `docs/eval-design.md` updated (seed section + observational-pressured-case concept + depth-per-rung note).
- [ ] `docs/handoff.md` current-state eval line updated to describe the true-shell multi-turn seed + observational pressured rungs; task entry removed.
- [ ] Deferred follow-ons added to `docs/handoff.md` as `[needs design]`: (a) search/replace **differentiator rule** (grader read/write-class match), (b) **shadowing** metric (non-gating count once cases fire it), (c) **skill-text tuning against the ladder** (the `variable`→`replace-text` routing lever from spike finding #4, and any pressured-rung gap the first paid run reveals).
- [ ] **Maintainer paid-run calibration (not an execution-agent step):** run `pnpm eval trigger-agentic` at n=3 with the OpenRouter env vars; confirm the existing gating cases stay green under the new depth-1 seed, and record where the four pressured rungs land (the discrimination baseline) in the archived Outcome.
- [ ] Non-obvious gotchas added to `docs/eval-design.md` (skip if none).
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended.
