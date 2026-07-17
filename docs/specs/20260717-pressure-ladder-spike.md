# Spike: pressure-ladder discrimination (Haiku lane)

**Status:** Findings recorded — feeds the "Pressure ladder for the Haiku lane" spec
**Date:** 2026-07-17
**Related:** [eval-design.md](../eval-design.md), [handoff.md](../handoff.md) P3 pressure-ladder task,
[skill-shape-trigger-spike](archive/20260710-skill-shape-trigger-spike.md)

## Question

The Haiku lane sits at the 15/15 ceiling, so regressions are invisible until catastrophic. Can
harder phrasings + stronger pressure levers make the lane *discriminate*, and which lever matters
most? Design decisions (matrix shape, default trial count, which levers to standardise) depend on
the answer, which cannot be reasoned out — it needs real trials.

## Method

Four `rename` cases at n=6 against `anthropic/claude-haiku-4.5` (OpenRouter), identifiers held
constant (`userId`→`accountId`) so the existing `searchText-userId.json` fixture stands in for the
search precursor. Varied two axes: phrasing (direct / indirect-no-coords / buried) and seed depth
(one true-shell turn vs three). Scratch test, deleted after; observational (no gating assertion),
results written to a file (`console.log` is swallowed by vitest's reporter on passing tests).

Seeds were **true-shell** throughout — every seeded pre-step is work weaver does not own (log grep,
`git log --grep`, `find` by name), never a weaver-shaped task. See the eval-design.md principle "A
momentum seed primes a habit, not a substitution precedent."

## Results

| Case | Seed | Rate | Mechanism |
|------|------|------|-----------|
| direct, tool named | 1 true-shell turn | 6/6 @step2 | trivial — ceiling |
| indirect, no coords | 1 true-shell turn | 6/6 @step5–6 | grep → read → converges on rename |
| buried in broader task | 1 true-shell turn | 5/6 | one stall (cat'd the file, ran out of budget) |
| buried + **deep** seed | 3 true-shell turns | **1/6** | stalls in grep/cat/find-references, never converges |

## Findings (decision rules)

1. **The premise holds — the lane can be made to discriminate.** Buried + deep seed collapsed to
   1/6 from a 6/6 ceiling.
2. **Seed depth dominates phrasing.** Buried phrasing alone barely moves the rate (5/6); the *same*
   task under a 3-turn true-shell seed drops to 1/6. The multi-turn true-shell habit-momentum seed
   is the primary lever; the phrasing axis is secondary and bites mainly in combination.
3. **The failure mode is precursor-stall, not substitution.** Under heavy momentum the model stays
   in grep → Read → cat → `find-references` read-mode and never converts to `rename` (it reaches
   read-only weaver ops, then cats the file instead of renaming). The discriminating metric is
   convergence on the mutating op within budget — the eventual-operation metric already captures it.
   The lever to fix a red is body text pushing convert-to-action, not trigger description.
4. **"Variable" is a phrasing lever toward replace-text.** The indirect-no-coords case is 6/6 here,
   but the shipped `no-coords-sed-tempting` (which frames the target as "the **variable** userId")
   was red in the same session. Framing the target as "a variable" appears to cue a
   text-substitution model. Concrete, testable lever for folded-in grader item (a).
5. **No-coords cases measure selection, not arg-carry.** The model greps in bash, gets the generic
   bash stub, and hallucinates a position (`line: 1`). Real coordinate-carry only happens when the
   model is routed through `weaver search-text` (owned canned result). Keep no-coords cases as
   selection-rate cases; put arg-carry in the two-step lane (seeds a real search-text result).

## Consequences for the spec

- **Default n=3** (existing default; accepted coarseness — escalate n on demand to confirm a
  surprising flip rather than baking in permanent high-n).
- **Replace the weaver-shaped shipped `buildHabitMomentumSeed`** with a multi-turn true-shell seed;
  make seed depth a first-class lever. High-impact, not cosmetic.
- **Keep the three-phrasing axis** but understand it as secondary.
- **Start the matrix at the highest-signal commands** (rename, replace-text, search-text,
  find-references), not all 12 ops.
- **`-t`-filtered iteration** during skill-text tuning; full runs only at milestones. Whole change
  targets ~US$10–20; a naive full-run-every-iteration loop is $100+.

## Cost

Two paid runs, ~US$1.50 total (one wasted to swallowed `console.log` before results were written to
a file — see the eval-design.md discipline). Anchor: 4 cases × n=6 ≈ US$0.75 (~$0.03/trial-run).
