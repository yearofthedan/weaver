# Spike: the single-edit over-trigger (`weaver-search-and-replace`)

**Status:** Findings recorded — null result, no skill change shipped
**Date:** 2026-08-30
**Related:** [eval-baselines.md](../eval-baselines.md), [skill-design.md](../skill-design.md),
[eval-design.md](../eval-design.md), [handoff.md](../handoff.md) Must entry on the single-line edit

## Question

`boundary-bash-remove-console-log` has sat at 0/10 clean on GPT-5.6-Luna since 2026-08-01. The
handoff attributed it to `weaver-search-and-replace` over-claiming: "**Any** text search or bulk
text change", plus a body table banning `Edit` outright, pulling weaver onto a one-site edit.

Can a description edit stop the over-trigger, and at what cost to the cases that depend on the same
description? This cannot be reasoned out. `skill-design.md` records wordings that resisted the
reflex they were aimed at — the `tsc` case was written up as unfixable by phrasing, then fell to a
change that never mentions `tsc`. So the outcome was unknown going in, which is why this is a spike
and not a spec.

## Method

Single case, n=10, `openai/gpt-5.6-luna` via OpenRouter, pressured (generic clutter + momentum),
`WEAVER_EVAL_DEBUG=1` on the baseline run to capture the turn-by-turn trail. Luna is $0.00027/trial,
so iterating one case is ~$0.005 a pass; the expensive step is the cross-model regression sweep,
run once against a candidate rather than per iteration.

Constraint held throughout: the description must not name the case's own target. No `console.log`,
no `app.ts`, no line number, no `/tmp/weaver-eval` path — naming the fixture games the case instead
of moving the decision boundary.

## Results

### Baseline diagnostic — the driver is not what the handoff recorded

0/10 clean, reproducing the recorded rate. The trail is identical across all ten trials:

| Step | Call |
|---|---|
| 1 | `Skill({"skill":"weaver-search-and-replace"})` |
| 2 | `bash(weaver search-text …)` |
| 3 | `Read({"file":"/tmp/weaver-eval/src/app.ts"})` |

Two things this settles:

1. **The pull is on the search half, not the replace half.** Every trial reached for `search-text`;
   not one ever tried `replace-text`. The handoff framed the defect as weaver being used for "a
   plain single-line edit", which describes the outcome. The model is not reaching for weaver to
   *make* the edit — it reaches for it to *locate the line*, treating "find this text" as a text
   search. A fix aimed at the replace claim, or at the body's `Edit` ban, would have moved nothing.
2. **The skill is chosen at step 1, before any file is read.** So nothing about the file's content
   can be driving it. The description alone decides.

### Confound found and ruled out

The lane's generic `Read` result (`CANNED_RESULTS` in `eval/harness/agentic-loop.ts`) is a one-line
stub — `export function authenticate(userId: string) { /* ... */ }`. The task asks the model to
remove a `console.log('debug')` on **line 15** of that file. The target does not exist in what the
lane hands back, so `search-text` returns "No results for this call." and the `Read` shows nothing
either.

This looked like it might be the driver. It is not: the over-trigger is committed at step 1, before
the model has read anything. The broken stub explains only the flailing *after* the reach — trials
that go on to `nl -ba` the file or shell out to `python3` to check it exists. It is a real defect,
tracked separately; it is not this one's cause.

### Iteration 1 — bound the claim to unknown extent

One edit to the `description:` frontmatter, leaving the body untouched:

- Replaced "Any text search or bulk text change" with "Search a codebase for text whose full extent
  you do not yet know, or change every occurrence of it in one pass".
- Added an explicit negative: "Not for a single edit at a spot you can already name: a known string
  on a known line of a known file is a plain file edit, not a search."
- Kept "use instead of grep or sed" intact — three cases at ceiling lean on that displacement.

**0/10 → 10/10 clean.** Nine of ten trials go straight to `Read`; no trial loads a skill or calls
weaver. First iteration, no tuning.

### Regression sweep — Luna, all 25 cases

Every case 10/10 except `trigger-refactor-rename-no-coords-sed-tempting` at **8/10**, against a
recorded 10/10. Both failures were precursor-stalls: repeated `search-text` with a narrowing glob,
never converting to `rename` — the failure mode the [2026-07-17 pressure-ladder
spike](20260717-pressure-ladder-spike.md) named. `two-step-cat-then-extract` went the other way,
9/10 → 10/10.

That case is the one this edit was most likely to break, so it got a same-session A/B rather than a
comparison against the table. Reverting the description and re-running the case in the same session:

| Arm | Rate | Failures |
|---|---|---|
| Edited description | 8/10 | trials 3, 7 — precursor-stall |
| Unedited description | 8/10 | trials 3, 7 — precursor-stall |

**The edit is exonerated: 8/10 is the case's current true rate and the recorded 10/10 is stale.**
This is the drift the baselines doc warns about — had the 8/10 been read against the table instead
of against a control arm, a stale row would have been reported as a regression this edit caused.

Both arms failing on the same two trial indices is unexplained. The seed is deterministic
(`TRUE_SHELL_POOL.slice`) but no per-trial RNG seed is sent and temperature is unset, so trials are
independent samples and the match is a coincidence at roughly 2%. It is recorded, not relied on —
the conclusion rests on both arms drawing the same rate with the same failure signature.

### Cross-model gate — `pnpm eval:gate`, all three models

**Result: FAILED**, on Haiku's `command-move-symbol` at 3/6 (floor is 4/6). $1.81 total.

The boundary case cleared everywhere: Haiku **3/3 clean**, Gemini **10/10 clean**, Luna
**10/10 clean** — up from 0/10.

Every cell that came in under its recorded baseline:

| Case | Model | This run | Recorded | Miss tier |
|---|---|---|---|---|
| `command-move-symbol` | Haiku | **3/6** | 3/3 | 3 never-reached |
| `command-move-file` | Haiku | 4/6 | 5/6 | 2 never-reached |
| `command-move-directory` | Haiku | 4/6 | 4/6 | 2 never-reached |
| `command-search-text` | Haiku | 4/6 | 3/3 | 2 never-reached |
| `trigger-search-and-replace-todos-grep-tempting` | Gemini | 8/10 | 10/10 | 2 never-reached |
| `pressured-buried-find-references` | Gemini | 8/10 | 9/10 | 1 content-fail, 1 never-reached |
| `two-step-cat-then-extract` | Gemini | 8/10 | 10/10 | 2 never-reached |
| `trigger-refactor-rename-no-coords-sed-tempting` | Luna | 7/10 | 10/10 | 3 content-fail |

**`never-reached` is an artifact on a front-loaded case.** The tier means "never read the skill",
but a front-loaded case puts the bodies in the user turn and exposes no `Skill` tool, so
`skillMdRead` is false on every trial and *every* front-loaded miss lands in that tier by
construction. On the four Haiku rows above it carries no information beyond "missed". It is only
diagnostic on the progressive cases — where it does mean the description failed to attract the load.

That leaves two rows worth a control arm rather than a shrug: Haiku's `command-move-symbol` (the
one that failed the gate) and Gemini's `trigger-search-and-replace-todos-grep-tempting` (a
progressive search-and-replace case whose misses are real never-reached — the under-triggering risk
a narrowed description actually carries).

### Control arm — the gate failure was real, not drift

Haiku, n=6, same session, description reverted:

| Case | Iteration 1 | Unedited control |
|---|---|---|
| `command-move-symbol` | 3/6 | **6/6** |
| `command-move-file` | 4/6 | **6/6** |
| `command-move-directory` | 4/6 | 5/6 |
| `command-search-text` | 4/6 | **6/6** |
| Total | 15/24 | **23/24** |

Iteration 1 is genuinely harmful on Haiku's front-loaded ops. Not drift, and not confined to the
one case that failed the gate.

The mechanism is the shared-context effect `skill-design.md` warns about. A front-loaded case puts
every skill body — frontmatter included — in the user turn, so iteration 1's negative sits next to
the *refactor* skill's operations. "Not for a single edit at a spot you can already name" describes
`move-symbol` exactly. Scoped to a search skill a human reads it as being about searching; stripped
of that context, it reads as a claim about edits in general.

### Iterations 2 and 3 — the negative has to name its own operations

| # | Description change | Boundary (Luna) | Haiku 4 cases |
|---|---|---|---|
| baseline | "**Any** text search or bulk text change" | 0/10 | 23/24 |
| 1 | positive reframing + unscoped negative | **10/10** | 15/24 |
| 2 | positive reframing only, negative cut | 8/10 | not run |
| 3 | positive reframing + negative naming `search-text`/`replace-text` | **10/10** | (pending) |

Iteration 2 isolates the negative's contribution: without it the boundary case gives back 2 of the
10 (8/10), so the positive reframing alone does most but not all of the work. 8/10 still fails a
case judged all-clean.

Iteration 3 keeps the negative but binds it to the operations it governs — "Do not run `search-text`
or `replace-text` for a string you can already point to in one known file". A model cannot apply
that to `move-symbol`. Boundary back to 10/10.

### The negative was not the culprit

Iteration 3's Haiku arm came back **13/24** — worse than iteration 1, not better. So binding the
negative to its own operations did not rescue it, and the shared-context theory above is wrong.
Running iteration 2 (no negative at all) on the same four cases gave **16/24**. Full picture:

| Arm | Description | Boundary (Luna) | Haiku 4 cases |
|---|---|---|---|
| control | unedited | 0/10 | **23/24** |
| 1 | positive reframing + unscoped negative | 10/10 | 15/24 |
| 2 | positive reframing only | 8/10 | 16/24 |
| 3 | positive reframing + op-scoped negative | 10/10 | 13/24 |

All three variants cluster at 13–16/24 regardless of whether a negative is present or how it is
scoped. The one thing they share is the rewritten opening clause. The negative moves the *boundary*
case (8/10 without it, 10/10 with either form) and does not measurably move Haiku either way.

A single control draw is thin ground for a null, and the whole conclusion pivots on it: if 23/24
were a lucky draw and the true control sat near 16/24, iteration 3 would be shippable. So the
control was re-run.

The second control arm came back **24/24**, against the first's 23/24. Control is stable and high;
every variant sits 8–11 trials below it. The null holds.

## Findings (decision rules)

1. **The over-trigger is fixable by description text — but not at a price worth paying.** Two
   wordings took `boundary-bash-remove-console-log` from 0/10 to 10/10 clean on Luna, and a third
   to 8/10. The question the handoff asked has an answer: yes, the description drives it. Nothing
   shipped, because every wording that fixed it cost Haiku roughly a third of its front-loaded
   move and search operations (13–16/24 against a control of 23/24 and 24/24).

2. **Editing one skill's description perturbs *other* skills' front-loaded cases on the weakest
   model.** This is the sharpest number the project has on `skill-design.md`'s brittleness warning.
   Note where the damage lands: front-loaded exposure already has every body in the user turn, so
   discovery has succeeded and a description edit should be semantically inert there. It is not.
   The harm was indifferent to whether a negative was present (16/24 without one) or how tightly it
   was scoped (13/24 named to its own ops), which is what a semantic explanation would have to
   move. Perturbation or added length is the better-supported reading, and it is **untested** — a
   length-matched rewrite that changes no meaning would separate the two.

3. **Never read a rate against the recorded table; run a control arm in the same session.** This
   bit twice in one spike, in both directions. Luna's `trigger-refactor-rename-no-coords-sed-tempting`
   came in at 8/10 against a recorded 10/10 and read as a regression this edit caused — the control
   arm gave 8/10 on unedited code, so the row was simply stale. Then the reverse: iteration 1 looked
   like a clean first-try win on a full single-model sweep, and the cross-model gate found it was
   costing Haiku a third of four cases. A single-model sweep is not evidence for a skill edit.

4. **`never-reached` carries no information on a front-loaded case.** The tier means "never read the
   skill", but a front-loaded case exposes no `Skill` tool and puts the bodies in the user turn, so
   `skillMdRead` is false on every trial and every miss lands there by construction. Read it only on
   progressive cases. Worth a comment in `outcome.ts`, which currently describes the tier as "a
   description or shell-habit problem" without noting it is undefined for one whole exposure.

5. **The boundary case asks the model to delete something the lane never shows it.** The generic
   `Read` result in `CANNED_RESULTS` is a one-line stub with no `console.log` in it, so the trials
   flail after the reach — shelling out to `nl -ba` and `python3` to find a line that is not there.
   Not this bug's cause (the reach happens at step 1, before any read), but it makes every trail
   harder to read and it independently blocks the third Must item. Fix it before the next attempt.

## Consequences

- **Ship nothing from this spike.** The skill descriptions are unchanged; the boundary case stays at
  0/10 and stays demoted. The handoff entry stays open with the search-half attribution corrected.
- **Fix the canned `Read` stub first.** A coherent multi-line fixture is a precondition for the next
  attempt at this case, and the third Must item wants it anyway.
- **Any future attempt needs the Haiku front-loaded four as a standing control arm** —
  `command-move-file`, `command-move-directory`, `command-move-symbol`, `command-search-text` at
  n=6, both arms, same session. They are where a description edit's collateral damage shows up, and
  a Luna sweep will not reveal it.
- **Settle perturbation vs semantics before wording anything again.** If a length-matched, meaning-
  preserving rewrite also drops Haiku to ~15/24, then no wording of that clause is shippable and the
  lever has to move elsewhere — the body, the case, or accepting the over-trigger.
- **Correct the stale table rows** measured here on unedited code (below).

## Cost

| Run | Model | Trials | Cost |
|---|---|---|---|
| Baseline diagnostic (debug) | Luna | 10 | $0.0105 |
| Iteration 1 — boundary | Luna | 10 | $0.0056 |
| Iteration 1 — full sweep | Luna | 250 | $0.1187 |
| A/B control — no-coords case | Luna | 10 | $0.0102 |
| Cross-model gate | all three | — | $1.8125 |
| Control arm #1 | Haiku | 24 | $0.3094 |
| Iteration 2 — boundary | Luna | 10 | $0.0081 |
| Iteration 3 — boundary | Luna | 10 | $0.0051 |
| Iteration 3 — Haiku four | Haiku | 24 | $0.5124 |
| Iteration 2 — Haiku four | Haiku | 24 | $0.4338 |
| Control arm #2 | Haiku | 24 | $0.2749 |
| **Total** | | | **$3.50** |

The shape to copy: iterate on one case on the cheap model, but budget for the cross-model arms —
they were 90% of the spend and they carried every real finding.

## Cost

| Run | Trials | Cost |
|---|---|---|
| Baseline diagnostic (debug) | 10 | $0.0105 |
| Iteration 1 | 10 | $0.0056 |
