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
- `eval/harness/call-model.ts` — no auth header is sent today; the auth header is added
  here (temperature stays hardcoded at 0). Mocked-fetch unit tests already live in
  `call-model.test.ts`.
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
  existing logic. `call-model.ts` is the only existing file with a behaviour change (the
  auth header), and it is narrow.

**Layer-fit per AC** is noted inline below. The pattern throughout: each poison has a
*pure core* (a function from inputs to a tool array / prompt string / message array) that
is unit-tested in the `test:eval` lane (runs in `pnpm check`); the actual model-calling
wiring lives in the new `*.llm.test.ts` and runs only under `pnpm eval`. No poison should
be tested only through a live model.

## Value / Effort

- **Value:** Today a skill that wins the clean lane can still silently lose in a real host
  — exactly what happened when a frontier agent skipped the skills in this repo. The
  maintainer currently has no instrument that distinguishes "the description is weak" from
  "no description survives this much pressure." This lane is that instrument: it turns a
  vague worry ("the clean lane reads optimistic") into a per-case, repeatable signal that
  *decides the next action* — reword the skill, or build a host hook. It is also the gate
  that the separately-queued "agent-host hooks" work is explicitly waiting on.
- **Effort:** Contained to `eval/`. Four additive units (competing tools, clutter prompt,
  grep-priming seed, auth header) plus one new `.llm.test.ts` lane and a doc update. No
  production `src/` code, no daemon, no engine. The auth header is the only change touching
  a shared harness function with existing tests.

## Behaviour

The poisoned lane reuses the **skill-expecting** trigger cases only (those whose
`expect.tool` is a skill, not `"bash"`). Boundary/over-trigger cases stay in the clean lane
— under added tool competition, over-triggering is *less* likely, so they add no signal
here. The lane lives in `eval/cases/trigger-adversarial.llm.test.ts` and runs only under
`pnpm eval`. It runs at **temperature 0, single-shot, pass/fail** — identical decoding to
the clean lane, with the three poisons (AC1–AC3) as the *only* variable. This keeps the
comparison a controlled A/B: any clean-pass/poisoned-fail difference is attributable to the
poison, not to sampling luck. (Quantifying sub-flip *fragility* with repeat-N rates is
deliberately deferred — see Open decisions.)

- [ ] **AC1 — Competing realistic toolset.** `tools.ts` exports `COMPETING_TOOLS`: tool
  definitions for `Edit`, `Grep`, `Glob`, and `Read` with plausible host-style
  descriptions (e.g. Grep: "Search file contents with a regex across the project"). The
  poisoned lane declares `[...skillTools(), BASH_TOOL, ...COMPETING_TOOLS]`. When a case
  fails, the failure message names which competitor won (the first tool call's name) so a
  loss is diagnosable — e.g. "expected weaver-search-and-replace, got Grep" — not just a
  bare fail. *(Layer-fit: `COMPETING_TOOLS` is a static value → a unit test asserts the
  four tool names and that none collides with a skill name or `bash`. Selection behaviour
  is the `.llm` lane.)*

- [ ] **AC2 — Cluttered system prompt.** A pure builder produces a multi-thousand-token
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

- [ ] **AC3 — Grep-primed habit-momentum seed.** A `buildHabitMomentumSeed(task)` helper
  (mirroring `buildSeedMessages`' plain-text-turn approach, since Ollama drops seeded tool
  calls) returns: a user turn with an *unrelated* search request, an assistant turn that
  used grep successfully (`grep -rn ...`), a user turn with canned grep output, then the
  real trigger task. The lane prepends this so the model has already succeeded with grep
  before the skill-eligible task arrives. *(Layer-fit: the builder is pure → unit test
  asserts the four-turn shape, that the assistant turn contains a grep invocation, and that
  the final turn is the passed task. The behavioural effect is the `.llm` lane.)*

- [ ] **AC4 — `WEAVER_EVAL_API_KEY` auth header.** `ModelConfig` gains an optional
  `apiKey` sourced from `WEAVER_EVAL_API_KEY`. When set, `callModel` sends
  `Authorization: Bearer <key>`; when unset, no `Authorization` header is sent (preserving
  local Ollama, which has no auth). The `global-setup.llm.ts` probe forwards the same
  header. This makes the existing `WEAVER_EVAL_MODEL`/`WEAVER_EVAL_BASE_URL` override point
  at a hosted 32B/72B endpoint for an on-demand calibration run when a uniform 7B collapse
  needs disambiguating. *(Layer-fit: header construction is verifiable with the existing
  mocked-fetch unit tests in `call-model.test.ts` — assert the header present when the key
  is set, absent when not. No live hosted call in CI.)*

## Interface

No production/CLI surface changes — this is eval-harness-internal. `callModel` is reused
**unchanged** (temperature stays hardcoded at 0). Surfaces:

- **`ModelConfig.apiKey?: string`** — an opaque bearer token, e.g. a Together/Fireworks
  key. Empty/absent ⇒ no auth header (the common local case). Never logged or echoed (see
  Security).
- **`COMPETING_TOOLS: ToolDefinition[]`** — fixed length 4 (`Edit`, `Grep`, `Glob`,
  `Read`). Names must not collide with any `SKILL_NAMES` entry or `"bash"`.
- **`buildClutterSystemPrompt(): string`** — deterministic; length > the documented
  clutter floor.
- **`buildHabitMomentumSeed(task: string): ChatMessage[]`** — four plain-text turns ending
  in the verbatim `task`.

Env vars (all optional, documented in `docs/eval-design.md`): `WEAVER_EVAL_API_KEY`
(default unset).

## Open decisions

> **Decision (resolved): does the poisoned lane measure a selection *rate*
> (temperature > 0 + repeat-N) or a deterministic *pass/fail* (temperature 0,
> single-shot)?**
> **Chosen:** temperature 0, single-shot pass/fail — the same decoding as the clean lane.
> **Reasoning:** the poisons are deterministic prompt changes, and the failures that matter
> most — a poison flipping the model's top choice from skill to grep — are fully visible at
> temperature 0 with one run. Temperature > 0 uniquely detects only *sub-flip erosion*
> (P(skill) drops but the top choice holds); buying that costs N× runtime, and on a 7B
> canary the *absolute* rate is untrustworthy anyway (only movement matters, which a temp-0
> flip already provides for the loud cases). Holding temperature at 0 also keeps
> clean-vs-poisoned a controlled A/B with the poison as the single variable — adding
> temperature would inject sampling variance that repeat-N then exists only to average back
> out. **Consequence:** this lane will *not* catch a poison that erodes a skill's
> selection probability without flipping the top choice. That sub-flip fragility signal is
> deferred to a follow-up (`[needs design]` in handoff) that runs repeat-N on the **hosted
> larger model** reachable via AC4's auth header — where the probability is trustworthy and
> quantifying fragility is the actual goal. Revisit when that hosted path exists.

> **Decision (resolved): execution target.** Local Ollama (qwen2.5:7b) stays the default;
> AC4 adds the auth header so a hosted larger model is reachable on demand for calibration.
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

- `callModel` is reused unchanged; the clean lane, command lane, and two-step lane must be
  byte-for-byte unchanged in behaviour.
- The poisoned lane runs **only** the skill-expecting trigger cases; boundary cases
  (`expect.tool === "bash"`) are excluded. A guard/assertion documents this so a future
  contributor doesn't "fix" the lane by adding them.
- The coverage invariant in `pnpm check` must stay green — no new operations are added, so
  no new fixtures are required.
- Competing tool names must not shadow skill names or `bash` (a collision would make a
  pass/fail ambiguous). Enforced by the AC1 unit test.
- Lane runtime: 9 skill trigger cases, single-shot (one call each), within the lane's
  existing per-test timeout budget.
- **Known gap (intentional):** a poison that erodes a skill's selection probability without
  flipping the top choice will pass this lane. Detecting that requires repeat-N rates on a
  trustworthy model — deferred to the hosted follow-up (see Open decisions).

## Done-when

- [x] All ACs verified by tests (pure cores unit-tested in `test:eval`; lane wiring in the
      new `.llm.test.ts`, validated by manual `pnpm eval`)
- [x] Mutation score — N/A: Stryker's `ignorePatterns` excludes `eval/`, so no `eval/` file
      is mutated. All touched source is eval infrastructure.
- [x] `pnpm check` passes (lint + build + test) — and runs without a model server
- [x] A manual `pnpm eval` run of the poisoned lane against local Ollama is sanity-checked;
      clean-vs-poisoned results recorded in the Outcome below
- [x] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
      (`clutter.ts` is ~324 lines but cohesive prose data, not tangled logic)
- [x] `docs/eval-design.md` updated: consumer-fidelity ladder + poisoned-lane section
- [x] `docs/handoff.md`: old entries retired; deferred repeat-N fragility-rates and
      Agent-SDK rungs filed; current-state eval section updated
- [x] Tech debt discovered during implementation added to handoff.md as `[needs design]`
      (substitution-vs-sequencing metric blind spot folded into the Agent-SDK rung entry)
- [x] Non-obvious gotchas added to `docs/eval-design.md`
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

**Shipped:** the adversarial trigger lane (`eval/cases/trigger-adversarial.llm.test.ts`)
plus its four harness building blocks (competing toolset, clutter prompt, grep-primed seed,
`WEAVER_EVAL_API_KEY` bearer auth), the consumer-fidelity ladder + lane docs in
`eval-design.md`, and — as the first dogfood-driven improvement the lane produced — a
sharpened `weaver-code-inspection` type-error description.

**Tests added:** 17 harness unit tests in the `test:eval` lane (tools 2, clutter 2,
habit-momentum seed 2, callModel auth 4, global-setup probe 7; net +16 after trimming one
duplicate `buildSeedMessages` test). 9 LLM cases in the adversarial lane (`pnpm eval` only).
Mutation testing N/A (Stryker excludes `eval/`).

**Manual `pnpm eval` (qwen2.5:7b-instruct, `OLLAMA_CONTEXT_LENGTH=16384`):**
- Clean trigger lane: 14/14.
- Adversarial lane: 7/9, stable across 3 runs (temp-0, byte-identical). Failures:
  - `get-type-errors → tsc` — a clean clean-pass/poisoned-fail; **fixed** by sharpening the
    description, now passes under pressure with no regression in any lane.
  - `refactor-rename → weaver-code-inspection` — skill-vs-skill; find-references before a
    rename is a reasonable *precursor*, not a substitute. The single-shot first-call metric
    cannot tell precursor from substitution — feeds the Agent-SDK/multi-step rung.
  - `rename-no-coords → no tool call` — qwen narration/no-emission quirk, not a selection.

**Reflection:**
- *Went well:* clean pure-core / lane-wiring split (every poison unit-tested in `pnpm
  check`; lane wiring isolated to the `.llm` file). The lane earned its keep on first use —
  surfaced a real description gap, and the edit→both-lanes→read loop confirmed a defensible
  fix flipped it without regression.
- *Detours and lessons:*
  - The repeat-N rate metric was specced, then dropped mid-slice once we pressure-tested
    whether it was load-bearing (temp-0 A/B is the cleaner experiment). Only a partial AC
    was reverted. Pressure-test "is this metric load-bearing" during `/spec`, not after.
  - The first execution-agent dispatch over-tested constant data (asserting literals and
    TypeScript-guaranteed properties); needed a trim pass (26→12 tests on the new files).
  - **Truncation confound:** the first `pnpm eval` ran against Ollama's 4096 default,
    truncating the clutter and producing a misleading flip. *Verify the server's
    `OLLAMA_CONTEXT_LENGTH` before interpreting any clutter result.*
  - **Don't edit the test on an unverified hypothesis:** neutralizing the clutter's
    behavioral directives (believed to cause two confound failures) proved completely inert
    — identical failures — and was reverted. Measure the cause before tuning the instrument;
    editing the test toward an expected result is gaming.
- *For the next agent:*
  - The macOS Ollama app starts `serve` at the 4096 default regardless of shell env — set
    `OLLAMA_CONTEXT_LENGTH` in its launch environment (or run `ollama serve` from a
    terminal) before a clutter run.
  - Clutter *content* had no measurable effect on selection here; the poison acts through
    volume/presence. Don't over-engineer clutter wording.
  - The substitution-vs-sequencing blind spot is the strongest motivation yet for the
    multi-step/Agent-SDK rung.
