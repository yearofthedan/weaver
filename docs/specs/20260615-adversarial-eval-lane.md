# Adversarial trigger lane for the eval

**type:** change
**date:** 2026-06-15
**tracks:** handoff.md # Adversarial trigger lane for the eval → docs/eval-design.md

---

## Context

The eval's current trigger stage is a clean room: each shipped skill competes against a
single `bash` tool in a near-empty prompt, so the pass rate reads optimistic — a frontier
agent working in this very repo skipped the skills entirely under real context pressure.
This change adds a second, *poisoned* trigger lane that intentionally reduces skill
selection **without changing the skill files** (the skills are the constant, the pressure
is the variable), so the maintainer can separate description problems from pressure
problems: clean-pass + poisoned-fail ⇒ a pressure problem (the case for host hooks);
both-fail ⇒ a text problem. The clean lane stays exactly as-is, as the regression
baseline. This spec also documents the eval as a *consumer-fidelity ladder* in
`docs/eval-design.md` (consolidating the overlapping "layered skill-interface eval tiers"
handoff entry), pinning each rung's metric and naming where the poisoned lane sits.

## User intent

*As the maintainer of weaver's skill files, I want a pressured eval lane that mimics a
real agent host's competing tools, cluttered prompt, and prior shell habits, so that when
a skill description loses to grep I learn whether the fix is better wording (both lanes
fail) or a host-level forcing mechanism (only the pressured lane fails) — instead of
trusting a clean-room pass rate that hides the failure.*

## Relevant files

- `eval/cases/trigger.llm.test.ts` — the clean trigger lane; the poisoned lane is a
  sibling test file with the same cases but pressured wiring. Read to mirror structure.
- `eval/cases/cases.ts` — `CaseEntry` table + `triggerCases` filter; the poisoned lane
  reuses the *skill-expecting* trigger cases (those whose `expect.tool` is a skill).
- `eval/harness/tools.ts` — `skillTools()` + `BASH_TOOL`; competing tools are added here.
- `eval/harness/call-model.ts` — temperature is hardcoded to 0 and no auth header is sent;
  both change here. Mocked-fetch unit tests already live in `call-model.test.ts`.
- `eval/harness/config.ts` — `ModelConfig` (baseUrl, model); gains `apiKey`.
- `eval/harness/context.ts` — `SkillName`/`SKILL_NAMES` and prompt builders; the clutter
  prompt builder fits here or in a sibling module.
- `eval/harness/seed.ts` — `buildSeedMessages` (plain-text turns, deliberately not
  tool_call/tool messages because Ollama drops them); the grep-priming seed mirrors this.
- `eval/global-setup.llm.ts` — probes the model server before the lane runs; the probe
  must forward the auth header so a hosted endpoint is reachable.
- `docs/eval-design.md` — the ladder-framing section and the poisoned-lane docs land here.

### Red flags

- (none) — the eval harness files are small and single-purpose. New poisons are additive
  pure functions (tool arrays, prompt strings, message arrays) rather than edits to
  existing logic. `call-model.ts` is the only existing file with behaviour changes
  (temperature param, auth header), both narrow.

**Layer-fit per AC** is noted inline below. The pattern throughout: each poison and the
rate metric have a *pure core* (a function from inputs to a tool array / prompt string /
message array / rate number) that is unit-tested in the `test:eval` lane (runs in
`pnpm check`); the actual model-calling wiring lives in the new `*.llm.test.ts` and runs
only under `pnpm eval`. No poison should be tested only through a live model.

## Value / Effort

- **Value:** Today a skill that wins the clean lane can still silently lose in a real host
  — exactly what happened when a frontier agent skipped the skills in this repo. The
  maintainer currently has no instrument that distinguishes "the description is weak" from
  "no description survives this much pressure." This lane is that instrument: it turns a
  vague worry ("the clean lane reads optimistic") into a per-case, repeatable signal that
  *decides the next action* — reword the skill, or build a host hook. It is also the gate
  that the separately-queued "agent-host hooks" work is explicitly waiting on.
- **Effort:** Contained to `eval/`. Five additive units (competing tools, clutter prompt,
  grep-priming seed, repeat-N rate metric, auth header) plus one new `.llm.test.ts` lane
  and a doc update. No production `src/` code, no daemon, no engine. The auth header is the
  only change touching a shared harness function with existing tests.

## Behaviour

The poisoned lane reuses the **skill-expecting** trigger cases only (those whose
`expect.tool` is a skill, not `"bash"`). Boundary/over-trigger cases stay in the clean lane
— under added tool competition, over-triggering is *less* likely, so they add no signal
here. The lane lives in `eval/cases/trigger-adversarial.llm.test.ts` and runs only under
`pnpm eval`.

- [ ] **AC1 — Repeat-N selection-rate metric at temperature > 0.** `callModel` accepts an
  optional `temperature` (default `0`, preserving the clean lane and command lane
  unchanged). A pure helper `computeSelectionRate(selections, isCorrect)` takes the N
  tool-selections from N runs and returns the fraction where `isCorrect` holds — for a
  skill case `isCorrect` = "first tool call name === the expected skill"; for the
  degenerate empty-N input it returns `0`. The lane samples each case N times
  (`WEAVER_EVAL_REPEAT_N`, default `5`) at temperature `WEAVER_EVAL_TEMPERATURE`
  (default `0.7`), logs the per-case rate and the winning competitor distribution, and
  asserts only a **collapse floor**: rate `> 0` (the skill was selected at least once in
  N). Rationale: the eval is relative-signal-only and knife-edge cases flap at temp > 0, so
  the *rate movement between runs/edits* is the signal the maintainer reads — not an
  absolute threshold to chase. A per-case rate of 0 across the whole lane is the
  both-fail / 7B-collapse alarm; a single case at 0 is a description that fully lost under
  pressure. *(Layer-fit: `computeSelectionRate` is pure → unit test in `test:eval`
  including the empty-N=0 case and a mixed-selections case. The N-loop + live model is the
  `.llm` lane.)*

- [ ] **AC2 — Competing realistic toolset.** `tools.ts` exports `COMPETING_TOOLS`: tool
  definitions for `Edit`, `Grep`, `Glob`, and `Read` with plausible host-style
  descriptions (e.g. Grep: "Search file contents with a regex across the project"). The
  poisoned lane declares `[...skillTools(), BASH_TOOL, ...COMPETING_TOOLS]`. When a case
  fails, the logged winning-competitor distribution names which habit won (e.g. "Grep 3/5,
  weaver-search-and-replace 2/5") so a loss is diagnosable, not just a number.
  *(Layer-fit: `COMPETING_TOOLS` is a static value → a unit test asserts the four tool
  names and that none collides with a skill name or `bash`. Selection behaviour is the
  `.llm` lane.)*

- [ ] **AC3 — Cluttered system prompt.** A pure builder produces a multi-thousand-token
  system prompt of plausible agent scaffolding (persona, unrelated tool-use rules, style
  guidance) that wraps — but does not alter — the decision surface; the skill tool
  descriptions remain the only weaver-specific text. The builder's output length is
  asserted to exceed a documented floor (≈ 3000 tokens of clutter). The lane sends this as
  the system prompt. Because Ollama's OpenAI endpoint ignores `num_ctx` and defaults to
  4096, `docs/eval-design.md` documents that this poison requires
  `OLLAMA_CONTEXT_LENGTH` raised (≈ 16384) and that on a 16 GB host the 7B model fits that
  context. *(Layer-fit: the builder is pure → unit test asserts the clutter floor and that
  no skill description string leaks into the scaffolding. Truncation behaviour under a low
  context limit is environmental, documented, not unit-tested.)*

- [ ] **AC4 — Grep-primed habit-momentum seed.** A `buildHabitMomentumSeed(task)` helper
  (mirroring `buildSeedMessages`' plain-text-turn approach, since Ollama drops seeded tool
  calls) returns: a user turn with an *unrelated* search request, an assistant turn that
  used grep successfully (`grep -rn ...`), a user turn with canned grep output, then the
  real trigger task. The lane prepends this so the model has already succeeded with grep
  before the skill-eligible task arrives. *(Layer-fit: the builder is pure → unit test
  asserts the four-turn shape, that the assistant turn contains a grep invocation, and that
  the final turn is the passed task. The behavioural effect is the `.llm` lane.)*

- [ ] **AC5 — `WEAVER_EVAL_API_KEY` auth header.** `ModelConfig` gains an optional
  `apiKey` sourced from `WEAVER_EVAL_API_KEY`. When set, `callModel` sends
  `Authorization: Bearer <key>`; when unset, no `Authorization` header is sent (preserving
  local Ollama, which has no auth). The `global-setup.llm.ts` probe forwards the same
  header. This makes the existing `WEAVER_EVAL_MODEL`/`WEAVER_EVAL_BASE_URL` override point
  at a hosted 32B/72B endpoint for an on-demand calibration run when a uniform 7B collapse
  needs disambiguating. *(Layer-fit: header construction is verifiable with the existing
  mocked-fetch unit tests in `call-model.test.ts` — assert the header present when the key
  is set, absent when not. No live hosted call in CI.)*

## Interface

No production/CLI surface changes — this is eval-harness-internal. Surfaces:

- **`callModel(messages, tools, config?, temperature?)`** — `temperature: number`, default
  `0`. Realistic bounds 0–1; the poisoned lane uses 0.7. Zero case (`0`) is the existing
  deterministic behaviour. Adversarial case: values > 1 are passed through to the server
  (the server clamps/errors); not validated here.
- **`ModelConfig.apiKey?: string`** — an opaque bearer token, e.g. a Together/Fireworks
  key. Empty/absent ⇒ no auth header (the common local case). Never logged or echoed (see
  Security).
- **`COMPETING_TOOLS: ToolDefinition[]`** — fixed length 4 (`Edit`, `Grep`, `Glob`,
  `Read`). Names must not collide with any `SKILL_NAMES` entry or `"bash"`.
- **`computeSelectionRate(selections: (string | undefined)[], isCorrect): number`** —
  returns `[0,1]`. Empty input ⇒ `0`. `selections[i]` is the first tool-call name from run
  `i`, or `undefined` if that run emitted no tool call (counts as not-correct).
- **`buildClutterSystemPrompt(): string`** — deterministic; length > the documented
  clutter floor.
- **`buildHabitMomentumSeed(task: string): ChatMessage[]`** — four plain-text turns ending
  in the verbatim `task`.

Env vars (all optional, documented in `docs/eval-design.md`): `WEAVER_EVAL_REPEAT_N`
(default 5), `WEAVER_EVAL_TEMPERATURE` (default 0.7), `WEAVER_EVAL_API_KEY` (default unset).

## Open decisions

> **Decision (resolved): does the poisoned lane gate on a fixed pass threshold, or
> report rates with only a collapse floor?**
> **Chosen:** report-first with a `rate > 0` collapse floor (AC1). **Reasoning:** the eval
> is explicitly relative-signal-only and the docs warn knife-edge cases flap at temp > 0;
> a fixed threshold (e.g. 0.8) would be a score to chase, contradicting the project's
> stated philosophy and producing flaky failures. The maintainer reads *rate movement*
> across edits/runs as the signal; the floor exists only to make a degenerate uniform
> collapse (every case at 0 ⇒ 7B fell over, or the descriptions all lost) surface as a
> loud failure rather than a silent "lane passed." **Consequence:** the lane will not
> auto-fail on a meaningful-but-partial regression (e.g. 0.8→0.4); that is intentional —
> partial movement is read from the logged rates, not gated. Revisit if a hosted larger
> model makes rates stable enough to justify a real per-case threshold.

> **Decision (resolved): execution target.** Local Ollama (qwen2.5:7b) stays the default;
> AC5 adds the auth header so a hosted larger model is reachable on demand for calibration.
> No rented-box dependency. Driven by the maintainer's 16 GB host (cannot run 32B/72B
> locally) and a "small spend acceptable, not constant" budget.

## Security

- **Workspace boundary:** N/A — the eval reads `.claude/skills/` and `eval/fixtures/` and
  sends prompts to a model server; it writes no workspace files and touches no
  `isWithinWorkspace` path.
- **Sensitive file exposure:** N/A — no new file reads beyond the skill files already read
  by the clean lane. The clutter prompt is synthetic and contains no repo content.
- **Input injection:** N/A — no new string parameter reaches the filesystem or shell; the
  grep command in the habit-momentum seed is canned text in a chat turn, never executed.
- **Response leakage / secret handling:** `WEAVER_EVAL_API_KEY` is a secret. It must never
  appear in log output, error messages, or the `global-setup` probe's failure text.
  `callModel` already throws with the *response body* on HTTP error (not the request
  headers), so the key is not leaked there; the probe must mirror this — surface status
  text, not the outgoing header. A regression test asserts the key value does not appear in
  the probe's thrown error message.

## Edges

- The clean lane (`trigger.llm.test.ts`), command lane, and two-step lane must be
  byte-for-byte unchanged in behaviour: `callModel`'s `temperature` defaults to `0`, so
  every existing caller keeps single-shot determinism.
- The poisoned lane runs **only** the skill-expecting trigger cases; boundary cases
  (`expect.tool === "bash"`) are excluded. A guard/assertion documents this so a future
  contributor doesn't "fix" the lane by adding them.
- The coverage invariant in `pnpm check` must stay green — no new operations are added, so
  no new fixtures are required.
- Competing tool names must not shadow skill names or `bash` (a collision would make a
  pass/fail ambiguous). Enforced by the AC2 unit test.
- Lane runtime: 9 skill trigger cases × N=5 ≈ 45 calls; must complete within the lane's
  existing per-test timeout budget. Repeat-N is opt-in to the poisoned lane only — the
  clean lane is not multiplied.

## Done-when

- [ ] All ACs verified by tests (pure cores unit-tested in `test:eval`; lane wiring in the
      new `.llm.test.ts`)
- [ ] Mutation score ≥ threshold for touched files (`call-model.ts`, `tools.ts`,
      `config.ts`, and any new harness module)
- [ ] `pnpm check` passes (lint + build + test) — and runs without a model server
- [ ] A manual `pnpm eval` run of the poisoned lane against local Ollama is sanity-checked
      (rates logged, no crash); record the observed rates in the spec Outcome
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] `docs/eval-design.md` updated: (a) the consumer-fidelity ladder section naming the
      rungs and pinning each rung's metric (consolidates the "layered tiers" entry); (b)
      the poisoned-lane section — its purpose, the three poisons, the repeat-N rate metric,
      the `OLLAMA_CONTEXT_LENGTH` requirement, the auth-header calibration path, and the
      clean-vs-poisoned reading guide (clean-pass+poisoned-fail ⇒ hooks; both-fail ⇒ text)
- [ ] `docs/handoff.md`: remove the adversarial-trigger-lane entry and the "layered tiers"
      entry; add a thin `[needs design]` entry for the deferred Agent-SDK tier-3
      (frontier cold-context) repeatability rung; update the current-state eval section if
      the file layout changed
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/eval-design.md` (it already hosts the local-model
      gotchas) — e.g. anything learned about clutter + context truncation
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
