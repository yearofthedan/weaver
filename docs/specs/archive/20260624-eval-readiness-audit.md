# Eval-suite readiness audit

**type:** research / assessment
**date:** 2026-06-24
**tracks:** handoff.md # Eval-suite readiness audit → docs/eval-design.md

---

## What this is

A step-back verdict on the eval suite, which grew in reactive layers (structural invariants → clean trigger/command/two-step → adversarial → agentic). The deliverable is a new `docs/eval-readiness.md`. Run as an interactive Socratic session with the user — the verdicts need judgment about weaver's eval design, not an execution-agent dispatch. No code changes in this slice; if the verdict recommends a cut, that's a separate follow-up.

## Deliverable: `docs/eval-readiness.md`

Four sections, each landing a *named, checkable* commitment (not "general confidence"):

1. **Pare-back, lane by lane** — one row per lane/rung (structural invariants, clean-trigger, clean-command, two-step, reasoning probe, adversarial, agentic): the bug class **only** that lane catches, what breaks if it's deleted, and a keep / cut / merge verdict. Every lane must name a distinct bug class or an explicit "redundant with X."
2. **Overfit vs generality** — two separate verdicts: is the *harness* (`eval/harness/*`, model swappable via env + config) reusable for another tool's skills; is the *case content* (`cases.ts` + tuned seeds) encoding real failures or overfit to the 7B canary.
3. **The honest gap** — two explicit, platform-named lists: what it *predicts* (relative robustness / regression-movement of skill text under pressure, Qwen-class) vs what it *does not* (absolute trigger rates on Claude/Cursor/opencode, real-host selection policy, integration/file-state outcomes). One line noting the rung that would close it (frontier / e2e) is P5, API-gated.
4. **Recommended cuts/keeps** — actionable rollup; every cut/merge from §1 is either filed as a handoff entry or marked "keep, because…". Nothing silently dropped.

## Questions to rule on in the session

- Is the **adversarial** lane redundant now the **agentic** lane exists? Same case subset, same pressures, only the metric differs (first-call flip vs eventual convergence) — and the handoff's "rename everywhere" item says adversarial *mis-attributes* that failure. Highest-value cut.
- Does **two-step** still earn its keep, or is it a degenerate agentic case (clean, asserts a specific follow-up command + args vs pressured, asserts which skill is reached)?
- Keep the **reasoning probe** (confounded by Ollama emission stalls — "hypotheses, not a gate") in the routine loop, or mark it documented-optional?

## Relevant files

- `docs/eval-design.md` — the artifact under review; cross-check it against the lane tests, update it if a verdict changes how a lane is described.
- `eval/cases/{trigger,command,two-step,trigger-adversarial,trigger-agentic}.llm.test.ts` + `coverage.test.ts` — the actual lanes.
- `eval/harness/*.ts`, `eval/cases/cases.ts` — the §2 harness-vs-content surfaces.
- `docs/specs/archive/{20260615-adversarial-eval-lane,20260623-local-agentic-trigger-lane}.md` — why the two pressure lanes were added.

## Done-when

- [ ] `docs/eval-readiness.md` exists with §1–§4; every lane in `eval-design.md` has a verdict in §1.
- [ ] Any cut/merge is filed as a `[needs design]` handoff entry or marked "keep, because…".
- [ ] `eval-design.md` cross-linked / updated if a verdict changes a lane's description.
- [ ] Follow-ups filed as handoff entries: an `eval-specialist` agent that encodes this rubric (the audit's output, not a prerequisite); a `/research`-style audit skill (discovered work).
- [ ] handoff.md "Eval-suite readiness audit" entry removed.
- [ ] Spec archived to `docs/specs/archive/` with an Outcome section.

## Outcome

Shipped `docs/eval-readiness.md`. Structured as a behavioral-lane table (setup · claim · speed · false-failure risk · precision · model), split into a fast-feedback tier (canary × simulated) and a gated confidence ceiling (frontier cold-context, Harnessed). Verdicts: merge pressured single-shot into multi-step; the body is never tested under pressure (gap → new lane); demote the reasoning probe; rename adversarial/agentic → pressure + single-shot/multi-step. Prior art noted: Anthropic's `skill-creator`; opencode as the more instrumentable Harnessed host.

Follow-ups in handoff.md: apply-the-verdict (merge/rename/demote, P3); body-under-pressure lane (P3); eval-confidence chain reordered in P5 (cold-context → repeat-N → Harnessed, all API-gated). `eval-design.md` lane-description edits deferred to apply-the-verdict. `eval-specialist` agent and `/research` skill deferred by the user.

Process: added CLAUDE.md Rule 21 (no narrative / flavour / history).
