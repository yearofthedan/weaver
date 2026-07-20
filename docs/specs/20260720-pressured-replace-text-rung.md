# pressured-buried-replace-text rung reads 0/3

**type:** bug
**date:** 2026-07-20
**tracks:** handoff.md # pressured-buried-replace-text rung reads 0/3 — cause unconfirmed

---

## Symptom

The `pressured-buried-replace-text` rung of the agentic trigger lane reads 0/3
under the true-shell depth-3 momentum seed. The rung is observational (does not
gate), but 0/3 means the skill never routes the model to `weaver replace-text`
under pressure.

```
input:    task = "We're doing a version bump across the repo: skim the changelog
          for context, then replace every `v1` with `v2` including comments
          throughout the project, and flag any file where the replacement looks
          risky." (momentumTurns: 3, observational)
actual:   0/3 — all three trails run find/ls/Glob hunting a changelog and never
          reach the replace intent; 2/3 never load the skill.
          trial 1 [no match, skill loaded@6]: find … -iname "changelog*" → find … CHANGELOG* → ls … | grep -iE "change|history|release" → ls -la → find … -name "*CHANGE*"
          trial 2 [no match, no skill load]: find … CHANGELOG* → find … "*change*|*release*|*version*" → ls -la → find … *.md/*.txt → ls → Glob CHANGELOG*
          trial 3 [no match, no skill load]: find … changelog* → ls | grep change → ls → find … CHANGELOG* → ls → Glob CHANGELOG*
expected: the model reaches `weaver replace-text` within the 6-step budget
          (as the direct/indirect replace rungs do at 3/3).
```

Harness grounding: the lane is simulated — a non-weaver bash call is fed back
`CANNED_RESULTS.bash` (`"src/auth.ts\nsrc/api.ts\nsrc/utils.ts"`, in
`eval/harness/agentic-loop.ts`), which contains no changelog. So the "skim the
changelog" instruction can never be satisfied by the canned result, whatever the
model does.

## Value / Effort

- **Value:** This rung is one of four pressured discriminators the ladder exists
  to provide. If it fails for a *scenario* reason (an unsatisfiable pre-step)
  rather than a *skill-text* reason, it is a broken instrument — it will not move
  when `weaver-search-and-replace` regresses or improves, so it gives the
  maintainer no signal and misdirects the skill-text tuning follow-on.
- **Effort:** If the theory holds, the fix is a one-line case-table edit. If the
  theory is killed, the rung's real cause is elsewhere (trigger/body) and the fix
  routes into the skill-text tuning work instead.

Reproduction command (baseline, changelog preamble present):

```
pass-cli run --env-file .env -- pnpm eval trigger-agentic \
  -t "pressured-buried-replace-text" --disable-console-intercept
```

## Expected

The rung measures replace-*conversion* under pressure: with the buried phrasing
and depth-3 seed but no unsatisfiable pre-step, the model should reach
`weaver replace-text` at a rate comparable to the read-only pressured rungs — not
be blocked by a scenario step the harness cannot satisfy.

## Root cause

**Confirmed by single-variable A/B (2026-07-20, scoped `-t` runs, n=3 each).**
The task's opening clause — "skim the changelog for context" — is an
unsatisfiable pre-step in the simulated lane. Removing *only* that clause (task
otherwise identical: depth-3 seed, buried phrasing, replace intent, flag-risky
tail) flips the rung:

- changelog-on (committed): **0/3** — trails run find/ls/Glob hunting a changelog.
- changelog-off: **3/3** — every trail loads the skill@1, runs `weaver search-text`
  then converts to `weaver replace-text` (`matched@3 args:correct`).

Mechanism: a non-weaver bash call is fed `CANNED_RESULTS.bash`
(`eval/harness/agentic-loop.ts` — `"src/auth.ts\nsrc/api.ts\nsrc/utils.ts"`),
which never contains a changelog. The "skim the changelog" instruction therefore
can never be satisfied, so the model loops on find/ls/Glob and exhausts its
6-step budget before reaching the replace intent. Replace *routing* is fine — the
off-arm shows the ideal search→replace trajectory; the preamble was the sole
blocker.

This is a **case-scenario bug, not a skill-text bug**: the same failure would
occur with a perfect `weaver-search-and-replace` body. Contrast the working
pressured rungs, whose preambles reference *commits/exports* — a `git log` the
model runs once and accepts a (canned) result for — rather than a *file* the
canned file-list never contains. The general principle mirrors the momentum-seed
rule in `eval-design.md`: a pre-step must be work the harness can satisfy.

## Fix

**Needs design — routed to `/spec` (direction chosen, design deferred).**

The confirmed cause is a live context pre-step the harness cannot satisfy. Two
approaches were weighed:

- **A (patch):** reword this rung's preamble to a tolerable `git log`-style step.
  One line, but relies on the model gracefully degrading on a wrong canned
  result, costs 1–2 budget steps, and leaves the footgun for the next author.
- **C (chosen):** move context pre-steps out of the live task string and into
  *seeded history* — the `[canned user, canned assistant+toolcall, canned tool
  result, model turn]` shape `buildHabitMomentumSeed` already emits — with an
  **authored** tool result. The model never executes the pre-step against the
  dumb bash stub, so the loop cannot occur; the result is whatever we write.

C is the design because it removes the failure class, not the instance. Scope for
the `/spec` pass:
- Applies across the pressured rungs, not just `replace-text`. The `rename`
  rung's "check what's currently exported" is the same live-inspection shape and
  may benefit; the `search-text`/`find-references` git-log preambles are tolerated
  today but would be more robust seeded.
- Decide how much burial stays in the live task (the 2026-07-19 result found seed
  depth dominates and task-string burial barely moves the rate, so a more direct
  task loses little).
- Subsumes the separate "make the generic bash stub fail safe" idea — with context
  pre-steps seeded, an authored task no longer requires an unsatisfiable live step.
- Reconfirm each reshaped rung with a scoped `-t` run (this rung must clear 0/3).

## Security

- **Workspace boundary:** N/A — eval-only case-table data; no file read/write path
  changes.
- **Sensitive file exposure:** N/A — no file content read.
- **Input injection:** N/A — the task string is static test data, never
  interpolated into a path or shell command; the eval never executes it.
- **Response leakage:** N/A — no user-controlled strings enter responses.

## Edges

- The three other pressured rungs (`rename`, `search-text`, `find-references`)
  carry their own preambles ("check what's exported", "check recent commits",
  "skim the recent commits"). Verify the fix does not need to extend to them —
  their preambles reference commits/exports the momentum seed's `git log` step or
  the neutral stub can plausibly satisfy, unlike a changelog file.
- The replace *intent* itself works unpressured (`command-replace-text` 3/3) and
  under depth-1 pressure (`trigger-search-and-replace-*` 3/3) — so the failure is
  specific to this rung's scenario, not to replace routing in general.

## Done-when

- [ ] Reproduction case now produces expected output
- [ ] Regression test covers the exact failing case
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (N/A expected — eval-internal)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant doc (`docs/eval-design.md`) if any
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
