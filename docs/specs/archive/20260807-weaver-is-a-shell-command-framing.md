# Spike: does saying weaver is an installed package fix the "I can't reach weaver" failure?

**Status:** Findings recorded — tactic shipped, [skill-design.md](../../skill-design.md) updated
**Date:** 2026-08-07
**Related:** [eval-design.md](../../eval-design.md), [eval-baselines.md](../../eval-baselines.md),
[skill-design.md](../../skill-design.md), [router table-removal spike](20260801-skill-router-table-removal.md)

## Question

Models were abandoning tasks while holding the bash tool that would have run weaver — falling back
to `grep`/`sed`, or writing the correct `weaver` invocation into prose instead of emitting it.
Gemini 2.5 Flash failed `command-find-references` at 3/10 on this, with every trial opening on a
hallucinated native `find_references({…})` call carrying correct arguments.

Two candidate causes were on the table, needing separate remedies: the **invocation form** reading
as unavailable (skills write a bare `weaver …`, but weaver ships as a devDependency), and the
**skill name** being read as a capability the host must grant. A third emerged from reading the
harness: the front-loaded prompt concatenated raw `SKILL.md` files, YAML frontmatter included, so
the model saw a block headed `name: weaver-code-inspection` that a real host would never show it.

## Method

Arms held to one variable each, measured against the recorded 2026-08-07 n=10 baselines under
identical conditions. Gemini throughout for the primary question — Haiku is 10/10 on both target
cases and cannot see the failure at all.

Research on real host behaviour (Claude Code docs, `anthropics/skills`, `microsoft/playwright`)
ran alongside, to check whether the harness models deployment and what comparable skills do.

## Results

| Arm | Change | Gemini `find-references` | Gemini `rename` |
|---|---|---|---|
| baseline | — | 3/10 | 7/10 |
| 1 | frontmatter stripped from front-loaded prompt (harness only) | 3/10 | 7/10 |
| 2 | package framing added to all three skill bodies | **10/10** | **10/10** |
| 3 | same, positive rewording (no `--version`, no PATH conditional) | **10/10** | **10/10** |

Pooled across arms 2, 3 and the full sweep: **30/30 and 30/30.**

Full-suite sweeps under the shipped text:

| Model | Cases cleared | Notes |
|---|---|---|
| Gemini 2.5 Flash | 27/27 | `boundary-bash-remove-console-log` 9/10 on first sample, 10/10 on recheck |
| GPT-5.6-Luna | 25/27 | both failures are the pre-existing 0/10 boundary over-triggers |
| Haiku 4.5 | 10 cases sampled | seven ceiling cases all 10/10; see below |

Haiku's marginal cases, n=10 each with a second sample on the two that moved:

| Case | Baseline | Pooled after |
|---|---|---|
| `command-get-type-errors` *(observational)* | 6/10 | **20/20** |
| `command-move-file` | 7/10 | **18/20** |
| `pressured-buried-rename` | 5/10 | 6/10 — unchanged |

## What is supported

**Stating that weaver is an installed package, run from the shell, fixes the failure.** 3/10 → 30/30
on the target case, with the mechanism gone rather than merely rarer: the hallucinated
`find_references({…})` opener fired in 8 of 10 baseline trials and **0 of 30** afterwards. Every
post-change trial matched at step 1. A rate can drift; a failure shape vanishing across 30
consecutive trials is not drift.

**It generalises past the case it was aimed at.** Haiku's `command-get-type-errors` went 6/10 →
20/20 and `command-move-file` 7/10 → 18/20, on a model that never exhibited the Gemini failure and
was never the target. Both cases' recorded failure was the same underlying thing —
knowing the command and not emitting it.

**The wording is not load-bearing; the fact is.** Arm 3 rewrote the paragraph from a conditional
("if a bare `weaver` is not on `PATH`…") to a positive statement and dropped the detection command.
Identical rates. What matters is that the model is told weaver is an installed program, not how
the sentence is shaped.

## What is not

**The frontmatter theory — measured and dead.** The leading hypothesis before measurement was that
raw `name:`/`description:` YAML in the front-loaded prompt invited the model to read the skill as a
grantable capability. Stripping it produced byte-identical rates on both cases. Reasoning alone
would have shipped this and claimed the win.

**Mechanism A (PATH doubt) was never observed on Gemini.** Across 40 baseline trials no model
questioned whether the binary was installed; they questioned whether the *capability* existed. The
package-manager fallback in the shipped text is there for real users, not because it is what fixed
this.

**"The skill name is read as a tool namespace" was mis-stated.** The hallucinated tool is named
after the **operation** (`find_references`), not the skill (`weaver-code-inspection`). The single
quote naming the skill was one trial; across ten, the op name is what the model reaches for.

**The residual `move-file` failure is a different driver.** Its one remaining miss per ten runs
`mkdir -p && mv`, then writes: *"For a complete solution that rewrites all importers, **you should
use:** `weaver move-file …`"* — outward-addressed, no claim of inability, one line after
successfully using bash. That reads as completion framing (the job is done, this is advice for
someone else), not unreachability. One trial, so it is an observation, not a mechanism.

**Nothing here moves `pressured-buried-rename`.** 5/10 → 6/10, same shape: the model calls
`weaver search-text`, gets the answer, then re-confirms it with `grep`/`cat` and never converts.
The `weaver-refactor` body already instructs against exactly that, and is ignored.

## Findings worth keeping

**The gate model cannot see the failure it was meant to catch.** Haiku sat at 10/10 on
`command-find-references` while Gemini failed it 3/10. The gate's premise — weakest model as canary,
so a green gate implies a green audience — is falsified by direct measurement, not by argument. No
trial count on a model that does not exhibit a failure will find it.

**Cost per trial, measured:** Haiku **$0.0109**, Gemini **$0.0012**, Luna **$0.00027**. The gate
model is ~9× Gemini and ~40× Luna. A full Gemini sweep at n=10 ($0.32) costs *less* than the current
Haiku gate at n=3 (~$0.89) while sampling three times deeper. The archived $0.03/trial anchor is
roughly 12× high for the cross-family models.

**Failing trials cost ~3× passing ones** — an abandonment burns the whole step budget, a match at
step 1 stops there. Budget a red run accordingly.

**The harness penalises probing that pays off in deployment.** Models emit `weaver --help` and
`command -v weaver` on their own (confirmed: the probes persisted after the `--version` example was
removed). In a real session that returns real help and the agent proceeds better informed; here it
returns `"No results for this call."` or a generic file list, so the probe costs a step and teaches
nothing. A rate drop caused by probing is weaker evidence than the same drop caused by a `grep`
fallback.

**Front-loading is a real deployment mode, and our rendering of it is not exact.** Subagent
definitions take a `skills:` field that injects full skill content at startup, so the exposure
models something real. Real hosts inject rendered markdown, not raw frontmatter — but since
stripping it changed nothing, this is a fidelity note, not a defect worth fixing.

**Playwright, which these skills were modelled on, carries this framing and we had dropped it.**
`playwright-cli/SKILL.md` keeps bare `playwright-cli …` in every example and states the package
fact once in an Installation section, telling the model to substitute the package-manager form
throughout. Weaver copied the structure and omitted the section.

## Recommendation

Ship the paragraph (done). Do **not** rewrite the ~25 bare `weaver …` examples — arm 3 shows the
statement carries it and the examples cost nothing.

Two follow-ups, both queued in handoff: reconsider which model gates, and decide whether the
canned-result resolver should reward probing.

## Cost

**$2.14** across nine paid runs, ~1,000 trials. Haiku accounts for $1.61 of it on 120 trials;
Gemini and Luna together cover 580 trials for $0.47.
