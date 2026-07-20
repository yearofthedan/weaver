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

**Design settled 2026-07-20 (`/spec` pass): Design A — drop the unsatisfiable
live pre-step; rely on the momentum seed that already carries context.**

Correction to the direction proposed above. Direction C framed the fix as
*adding* authored seeded-context machinery. That over-scoped: the depth-3
momentum seed (`buildHabitMomentumSeed`) already prepends three context-gathering
exchanges — build-log grep, `git log`, `find` — each with an authored,
satisfiable tool result. It *is* the "context pre-steps in seeded history" C
describes. The changelog clause in the live task was a *second, redundant*
context step, and the broken one: a live non-weaver bash call resolves to
`CANNED_RESULTS.bash` (the generic file list), which no changelog hunt can
satisfy. So the realization is subtractive (remove the redundant live clause),
not additive (build a slot). The root-cause diagnosis held; the proposed fix
direction did not.

Change: remove `"skim the changelog for context, then"` from the
`pressured-buried-replace-text` task. What remains — the "version bump" framing,
the buried replace phrasing, and the `"flag any file where the replacement looks
risky"` tail — keeps the burial; the depth-3 seed keeps the pressure (per
2026-07-19: seed depth dominates, task-string burial barely moves the rate).

Durable guard (removes the failure *class*, not just this instance): a rule added
to `docs/eval-design.md` — a pressured case's live task must contain no leading
pre-step the harness cannot satisfy (an artifact the canned results never
produce); scenario context belongs in the momentum seed, which weaver does not
own. This subsumes the separate "make the generic bash stub fail safe" idea.

Scope: `replace-text` rung only.
- `rename`/`search-text` read low for skill-text reasons under the separate
  "pressured mutating rungs read low" item; reshaping their preambles here would
  confound that item's one-change-at-a-time A/B.
- `find-references` passes 3/3 and its changelog mention is a *trailing* note the
  model reaches only after matching (the loop returns on match), so no hunt-loop
  occurs — the doc rule (leading pre-steps) leaves it compliant untouched.
- Reconfirm with a scoped `-t` run (this rung must clear 0/3).

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

- [x] Scoped paid re-baseline (`-t "pressured-buried-replace-text"`, n=3) clears
      the 0/3 floor — this is the reproduction/verification. The failure only
      manifests against the live model, so there is no in-`pnpm check` regression
      test; the durable guard is the doc rule below, not a unit test.
- [x] `docs/eval-design.md` rule added: a pressured case's live task carries no
      leading pre-step the harness cannot satisfy (this *is* the failure-class fix)
- [x] `pnpm check` passes (lint + build + test:eval invariants)
- [x] No public surface changed (eval-internal case data + doc)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Verification (real path — scoped paid eval, n=3):**

```
pass-cli run --env-file .env -- pnpm eval trigger-agentic \
  -t "pressured-buried-replace-text" --disable-console-intercept
```

`pressured-buried-replace-text — rate 3/3` (was 0/3). All three trials identical:
skill loaded@1 → `weaver search-text` → `weaver replace-text` (`matched@3
args:correct`). The ideal search→replace trajectory, matching the root-cause
A/B's changelog-off arm. `pnpm check` green (377 eval-invariant tests).

**The fix:** removed the `"skim the changelog for context, then"` clause from the
one case's task string (`eval/cases/cases.ts`) + a failure-class rule in
`docs/eval-design.md`. No new machinery, no source change.

**Reflection:**
- *What the investigation got right / wrong.* Root cause was correct and
  A/B-confirmed. The proposed fix *direction* (C — build an authored seeded-context
  slot) over-scoped: it did not register that the depth-3 momentum seed already
  *is* seeded context with authored, satisfiable results. Once seen, the fix
  collapsed from "add a builder + field + tests" to "delete one clause." The lesson
  for the next agent: when a fix direction proposes new machinery to *supply* a
  capability, first check whether an existing harness path already supplies it —
  here `buildHabitMomentumSeed` did.
- *Instrument value, honestly.* The n=3 verification read 3/3 — but a later n=6
  baseline (2026-07-20, "pressured mutating rungs" investigation) observed **2/6**,
  combined 5/9. So the "sits at ceiling" reading above was n=3 optimism, corrected
  here: the rung is mid-range, not at ceiling. The changelog fix itself holds — at
  n=6 every trail still loads the skill@1 and runs `weaver search-text` correctly.
  The residual failures do not reach `replace-text`; the trails show the model
  reading each file after searching, which *plausibly* services the task's "flag any
  file where the replacement looks risky" tail (observed mechanism; not isolated by
  A/B, so a theory, not a confirmed driver). Net: the changelog blocker is removed,
  and a separate, milder cause is now visible and owned by the "pressured mutating
  rungs read low" investigation.
- *Scope discipline paid off.* Touching only `replace-text` kept this fix from
  confounding that separate item's one-change-at-a-time A/B on `rename`/`search-text`.
- Test count added: 0 (case-data + doc fix; no unit-testable seam). Mutation: N/A
  (no source touched).
