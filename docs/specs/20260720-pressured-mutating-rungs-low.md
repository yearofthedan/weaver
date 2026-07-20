# Pressured rename/search-text rungs read low

**type:** bug
**date:** 2026-07-20
**tracks:** handoff.md # Pressured mutating rungs read low — investigate then tune

---

## Symptom

At the 2026-07-20 baseline (n=3) the pressured buried rungs of the agentic
trigger lane read low, and the trails differ per rung (not one uniform failure):

```
input:    scoped agentic-trigger runs, momentumTurns: 3, observational rungs
actual (2026-07-20, n=3):
  pressured-buried-rename         0/3   one trail reaches `weaver find-references`
                                        then stalls without converting; others
                                        load the skill too late (@5 of 6)
  pressured-buried-search-text    0/3   all 3 grep for TODO, never load the skill
                                        (was 2/3 on 2026-07-19 — a flip at n=3)
  pressured-buried-find-references 3/3  ceiling (works)
  pressured-buried-replace-text   3/3  (fixed 2026-07-20 — separate spec)
expected: the mutating/read rungs reach their op within the 6-step budget at a
          rate comparable to find-references, or the low read is explained.
```

The `search-text` 2/3→0/3 flip across consecutive days is direct evidence that
n=3 cannot resolve these rates. So the first hypothesis to settle is whether the
low reads are a *stable* signal (attributable to skill text) or *variance* — an
unstable rate cannot be attributed to a skill-text driver, and tuning against
noise would burn paid runs chasing a moving rate.

Per-rung theories carried from the handoff (each untested):
- **search-text:** the `weaver-search-and-replace` frontmatter description stops
  triggering under pressure (vs. the alternative that 2/3→0/3 is noise).
- **rename:** the `weaver-refactor` body lacks a convert-to-action path, so a
  trail reaches a read-only precursor and stalls without converting.

## Value / Effort

- **Value:** These rungs are pressured discriminators for `weaver-refactor` and
  `weaver-search-and-replace`. If they read low for a *stable skill-text* reason,
  the maintainer needs to know which text (description vs body) drives it before
  a tuning pass. If they read low for *variance*, the instrument needs a higher n
  (or a methodology change), not a skill edit — and any tuning against n=3 noise
  is wasted spend.
- **Effort:** Investigation is paid scoped runs. Confirming the driver requires
  single-variable A/B (`WEAVER_EVAL_TRIALS=n … -t "<case>"`), one change at a
  time. The fix routes to `/spec` (skill-text edit is a design call) or to an
  eval-methodology decision if the cause is variance.

Reproduction command (fresh baseline, higher n to settle stability):

```
WEAVER_EVAL_TRIALS=9 pass-cli run --env-file .env -- pnpm eval trigger-agentic \
  -t "pressured-buried" --disable-console-intercept
```

## Expected

Either: the rungs reach their op at a stable rate comparable to find-references
(3/3) under the depth-3 seed; or the low read is explained by a confirmed driver
(a specific skill-text weakness isolated by A/B, or variance that n=3 cannot
resolve).

## Root cause

**What is confirmed: the low reads are stable, not n=3 variance.** An n=6 baseline
(2026-07-20) read rename 0/6, replace-text 2/6, search-text 0/6, find-references
6/6. The `find-references` 6/6 control proves the harness (momentum seed, canned
results, skill-load path) is healthy, so the low reads are rung-specific rather than
noise. The `search-text` 0/6 is a consistent pattern across all six trials — the
earlier 2/3 (2026-07-19) was the variance, not this. **This — stability, and that
the harness is sound — is the confirmed root-cause finding.**

**What is observed (fact, from the tool trails):**

- **search-text — 0/6.** The skill is never loaded in any trial. Every trail runs
  `git log` (the "check the recent commits" pre-step) then greps for TODO directly
  with host `Grep`/`bash` to the step budget.
- **rename — 0/6.** The skill loads late (@5/@6) or never. No coordinates are given;
  the model locates `userId` via host `Glob`/`Grep`/`Read`/`find`. The one early-load
  trial ran `weaver find-references` at a wrong position then greped, never converting.
- **replace-text — 2/6** (corrects the just-archived spec's "ceiling 3/3"). Every
  trail loads the skill@1 and runs `weaver search-text` correctly — the changelog fix
  holds. The 4 failing trails then read each file (`Read auth.ts/api.ts/utils.ts` +
  grep) and exhaust the budget without converting to `replace-text`.
- **find-references — 6/6 (control).** Coordinates given (no locate phase), a
  `git log` pre-step, converts at matched@4–5.

**What is theorized (NOT yet isolated — for the `/spec` pass to confirm by A/B):**
Each of these is a plausible driver read *off* the trail, not proven by changing one
variable and watching the rate move. Do not commit a fix on any of them unconfirmed.

- *search-text:* the driver of "never loads the skill" is unattributed among three
  candidates — the `weaver-search-and-replace` **description** under-triggering on a
  pure-*search* ask, the grep-shaped **core ask** (a TODO hunt reads as shell-doable),
  or the **`git log` pre-step** priming shell mode. (Note replace-text, same skill,
  loads@1 — so the description is not uniformly dead; that narrows, but does not
  isolate, the driver.)
- *rename:* candidate drivers are the **no-coordinates locate phase** eating the
  budget before load, and/or the **description** under-triggering. The handoff's "body
  lacks a convert path" is the least supported — it appeared on one trial only.
- *replace-text residual:* the per-file reads *plausibly* service the "flag any file
  where the replacement looks risky" **tail**, but the tail-as-driver is not isolated.

**Working hypothesis for the fix (to be tested, not assumed):** the drivers may
split into *case-scenario* (a detour-inviting tail/pre-step or a grep-shaped ask —
fixable by a case-table edit like the changelog fix) and *skill-text* (a description
that under-triggers — fixable by a description edit). Which applies per rung is
exactly what the A/B plan must decide.

## Fix

**Needs design — routed to `/spec`.** The cause is confirmed, but the fix is not a
single mechanical change: per rung it must separate the *case-scenario* driver
(trim a detour-inviting instruction — a case-table edit) from the *skill-text*
driver (edit the `weaver-search-and-replace` / `weaver-refactor` description), and
each candidate edit must be confirmed with a single-variable A/B (`WEAVER_EVAL_TRIALS=n
… -t "<case>"`), one change at a time, so attribution is clean. Sequencing these
without confounding — and deciding how much of each rung's low read is a case-design
artifact worth removing vs a genuine skill-text signal worth preserving — is a
design call. The `/spec` pass owns the experiment plan.

## Security

- **Workspace boundary:** N/A — eval-only case-table/skill-text data; no file
  read/write path changes.
- **Sensitive file exposure:** N/A — no file content read.
- **Input injection:** N/A — task strings are static test data, never executed.
- **Response leakage:** N/A — no user-controlled strings enter responses.

## Edges

- `find-references` reads 3/3 — a working control. Whatever the driver, it must
  explain why the read-only+coords rung passes while `search-text`/`rename` do not.
- The just-fixed `replace-text` rung shares the `weaver-search-and-replace` skill
  with `search-text` but converts at 3/3 — so a "description stops triggering"
  theory for search-text must explain why replace-text (same skill) triggers.

## Done-when (investigation)

- [x] Fresh baseline reproduced at n=6; stability settled — **stable, not variance**
      (consistent 0/6 trails; 6/6 control proves the harness)
- [x] Per-rung mechanism observed from the trails (fact) and separated from the
      candidate drivers (theory, not yet isolated)
- [x] Root cause recorded, grounded in observed trails/rates
- [x] Fix routed to `/spec` (needs design — drivers unisolated; A/B-confirmed edits)
- [x] Spec committed; handoff entry re-tagged `[needs design]`

The `/spec` pass then owns: per-rung fix design + the single-variable A/B plan,
its own Done-when for the shipped edits.
