# Retire the single-shot trigger lanes; consolidate triggering on the agentic rate lane

**type:** change
**date:** 2026-07-10
**tracks:** handoff.md # Grader refinement + assertion audit + single-shot lane retirement (Part 3) → docs/eval-design.md

---

## Context

The assertion audit ([spike](archive/20260710-assertion-audit-spike.md)) confirmed the
agentic rate lane against Haiku is the lane to trust, and that the plain-text echo stays.
This change delivers the retirement Part 3 names: the two single-shot *trigger* lanes
(`trigger.llm.test.ts`, `trigger-adversarial.llm.test.ts`) and `skillTools()`. The agentic
lane already measures triggering under the same pressures and better (it credits
precursors), so the single-shot trigger lanes are redundant. The command and two-step
lanes are **out of scope** — they stay; the two-step lane's degenerate-seed false negative
is recorded in the spike for later. Two things the retired clean lane carried must move to
the agentic lane: the boundary over-trigger guard, and the first-call selection signal.

## User intent

*As a maintainer editing skill files, I want the agentic rate lane to be the single home
for trigger signal — first-call wins and over-trigger guarding included — so that retiring
the redundant single-shot trigger lanes loses no signal and there is one lane to read.*

## Relevant files

- `eval/cases/trigger-agentic.llm.test.ts` — the surviving lane; gains a boundary branch and reports `matchedAtStep`
- `eval/cases/trigger.llm.test.ts` — clean single-shot trigger lane; **deleted** (sole home of the boundary guard today)
- `eval/cases/trigger-adversarial.llm.test.ts` — adversarial single-shot trigger lane; **deleted**
- `eval/harness/tools.ts` — `skillTools()` **deleted**; `SKILL_TOOL`/`rateLaneTools`/`BASH_TOOL`/`COMPETING_TOOLS` retained
- `eval/harness/tools.test.ts` — drop the `skillTools()` unit test; keep the rest
- `eval/harness/agentic-loop.ts` — `AgenticResult.matchedAtStep` already exists; the lane just needs to surface it
- `docs/eval-design.md` — lane inventory + iteration path; drop the two retired lanes

### Red flags

- Delete `skillTools()` only after both its consumers (the two trigger lanes) are gone.
- The boundary cases (`expect.skill: "bash"`) exist only in the clean lane's run today; the
  agentic lane currently filters them out (`c.expect.skill !== "bash"`). The delete must not
  drop them — they move into the agentic lane.

## Value / Effort

- **Value:** One trigger lane to read instead of three. The two single-shot trigger lanes
  duplicate the agentic lane's triggering signal at a coarser (first-call-only) resolution;
  the agentic lane already ran the same case subset under the same pressures. Removing them
  removes two lanes a maintainer must cross-reference after a skill-text edit.
- **Effort:** Confined to `eval/`. Delete two test files + one helper + its unit test; add a
  boundary branch and `matchedAtStep` reporting to the agentic lane; update
  `docs/eval-design.md`. No product source, no command/two-step lane touched.

## Behaviour

- [ ] **Boundary over-trigger guard on the agentic lane.** Given a boundary case
      (`expect.skill: "bash"` — legitimate shell work), the case passes when across all
      trials the model neither loads a skill nor reaches any `weaver` invocation within the
      step budget. A trial that loads a skill (`skillMdRead`) or runs any `weaver` command
      fails the case. This is at least as strong as the retired clean lane's first-call
      assertion — it catches an over-trigger anywhere in the trajectory, not only the first
      call. The five `boundary-*` cases run on the agentic lane after this change.
- [ ] **First-call wins surfaced via `matchedAtStep`.** For skill-trigger cases the agentic
      lane records and prints each trial's `matchedAtStep`, so a first-call win (matched at
      step 1 — the signal the retired clean lane gave) is distinguishable from a
      precursor-then-win (matched later). The recorded value is absent when the trial never
      matched.
- [ ] **Single-shot trigger lanes and `skillTools()` removed.** `trigger.llm.test.ts` and
      `trigger-adversarial.llm.test.ts` are deleted; `skillTools()` and its unit test are
      removed; no other export is orphaned (`BASH_TOOL`, `COMPETING_TOOLS`, `SKILL_TOOL`,
      `rateLaneTools` remain, still used by the agentic lane). `pnpm check` passes.

## Interface

No product surface. Internal to the eval harness:

- The agentic lane iterates the full trigger set (skill-trigger cases + `boundary-*`),
  branching on `expect.skill === "bash"` for the boundary assertion.
- `matchedAtStep` (already on `AgenticResult`) is captured into the lane's per-trial record
  and printed in the trail summary.
- `skillTools()` is gone from `tools.ts`.

## Open decisions

(none — the command and two-step lanes are explicitly retained this pass; the agentic
matcher stays subcommand-only since the kept command lane still owns per-operation
argument correctness.)

## Security

- **Workspace boundary:** N/A — eval harness only; asserts on emitted command strings,
  never executes them; no daemon, no file writes outside test temp.
- **Sensitive file exposure:** N/A — reads only the shipped skill files and canned fixtures.
- **Input injection:** N/A — no new string parameter reaches a filesystem or shell.
- **Response leakage:** N/A — no product response surface changes.

## Edges

- **Plain-text echo unchanged.** The audit kept it (8/9 Haiku vs 7/9 tool-format);
  `runAgenticLoop` is touched only through the boundary/reporting wiring the ACs add.
- **Command and two-step lanes untouched.** They keep running as-is; the two-step lane
  remains a known false negative (degenerate `'{}'` seed — root cause in the spike),
  addressed by a later pass, not this one.
- **Boundary runtime.** The agentic lane gains five `boundary-*` cases × trials; boundary
  trials terminate quickly (the model bashes immediately), so the added cost is small.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (only if `agentic-loop.ts`/harness logic changes; deletions and a test-only boundary branch add no mutable product surface)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Docs updated: `docs/eval-design.md` lane inventory + iteration path drop the two retired lanes; the boundary guard and first-call signal are documented as agentic-lane responsibilities
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas recorded (the degenerate-seed root cause is already in the spike)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
