# Hosted-model trigger-rate lane

**type:** change
**date:** 2026-07-07
**tracks:** handoff.md # Apply the eval-readiness verdict to the lanes → docs/eval-design.md, docs/eval-readiness.md

---

## Context

The skill-trigger eval runs against a local Ollama 7B, which the maintainer's hardware cannot sustain, and measures single-shot pass/fail at temperature 0 — which cannot see the sampling variance in tool selection that is the phenomenon of interest. This spec pivots the trigger lane to a hosted OSS model (OpenRouter Llama 3.3 70B) over the existing `fetch`-based `callModel`, reports a per-scenario trigger **rate** over N trials, and reframes the lane as the two-hop Claude Code chain (`<available_skills>` description → Read SKILL.md → `weaver` bash call) so it exercises the real selection surface. Grader refinements (read-only/mutating/shadowing classifiers, search/replace differentiator rule) and the retirement of the local single-shot lanes are spec 2 (`[needs design]`, depends on this baseline).

## User intent

*As a weaver maintainer iterating on skill descriptions, I want the trigger eval to run on a hosted model I can actually drive and report a trigger rate under realistic Claude-style framing, so that I get a stable, meaningful signal on whether a description edit helps or hurts.*

## Relevant files

- `eval/harness/call-model.ts` — `callModel`; temperature is hardcoded `0` at line 83. `toWireMessage` already serialises `tool_calls` correctly, so real tool-loop messages are transport-supported — the plain-text echo is a downstream Ollama workaround, not a transport limit (relevant to spec 2, not here).
- `eval/harness/config.ts` — `modelConfig()` reads `WEAVER_EVAL_BASE_URL`/`WEAVER_EVAL_MODEL`/`WEAVER_EVAL_API_KEY`; defaults to local Ollama. Temperature needs adding here.
- `eval/harness/agentic-loop.ts` — `runAgenticLoop` + `AgenticResult` + `cannedToolResult`. The loop this spec extends: framing swap, Read-hop handling, `skill_md_read`/`read_turn`.
- `eval/harness/tools.ts` — `skillTools()` (one-hop skill-as-tool, retired *from the rate lane* here; still used by the single-shot lanes until spec 2), `COMPETING_TOOLS`, `BASH_TOOL`.
- `eval/harness/context.ts` — `skillFrontmatters()` (name+description) and `skillContext()`/`readSkillFile` (full SKILL.md body); the `<available_skills>` builder and the SKILL.md fixtures read through these.
- `eval/harness/clutter.ts` — `buildClutterSystemPrompt()`; the pressure context the framing block slots into.
- `eval/harness/assertions.ts` — `matchWeaverCommand`; accepts `weaver` and `pnpm exec weaver`, needs `npx weaver` for AC5's pass rule.
- `eval/cases/trigger-agentic.llm.test.ts` — the lane this spec evolves (framing + rate). `MAX_STEPS` budget lives here.
- `eval/global-setup.llm.ts` — fail-fast when server/model missing; extend for the hosted-model path.
- `docs/eval-design.md`, `docs/eval-readiness.md` — mechanics + verdict; both need the rate-lane update.

### Red flags

- `eval/harness/clutter.ts` is 323 lines but is a static prompt string — not a cohesion problem; do not extend it with logic, only slot the framing block in.
- **Test hotspots:** none at threshold. New pure helpers (temperature config, `<available_skills>` builder, rate aggregation) land in their own small unit files; the LLM lane is its own file.
- **Layer-fit:** AC1, AC3, AC4 are pure functions of injected inputs → unit-tested with fakes, run in `pnpm check`. AC2's rate aggregation is pure (unit); its lane wiring is one smoke under `pnpm eval`. AC5 is model-touching → one wiring smoke under `pnpm eval`. No AC needs a real workspace or daemon.

## Value / Effort

- **Value:** The maintainer cannot currently run the eval at all (hardware) and, when it ran, could not distinguish "description got weaker" from sampling noise. A hosted model removes the hardware wall; a rate over N trials at temperature > 0 measures the actual selection stability; the two-hop framing means the number reflects the real Claude-style trigger chain, not a one-hop proxy that a 70B trivially passes. Concretely: edit a description → `pnpm eval` → read the rate delta.
- **Effort:** Plumbing through existing patterns, zero new dependencies. One config field, one prompt builder, one loop extension, an aggregation helper, and lane rewiring. No new infrastructure, no daemon, no SDK — OpenRouter is OpenAI-compatible and `callModel` already speaks it.

## Behaviour

- [ ] **AC1 — per-lane temperature (unit).** Given `WEAVER_EVAL_TEMPERATURE` set, `modelConfig()` returns that value; unset, it returns the documented default. `callModel` sends the configured temperature in the request body (not a hardcoded `0`), and accepts an explicit override so the command and two-step lanes pass `0` and keep their exact-command determinism. *Laziest wrong impl:* reading the env but still sending `0` — the fetch-body assertion in `call-model.test.ts` must pin the sent value for both a hot lane value and an explicit `0`. *Layer-fit: unit (config pure fn + fetch-mock body assertion).*

- [ ] **AC2 — N-trial rate (unit + smoke).** Given N completed trial verdicts for a scenario, the aggregator reports `passed/N` as a rate and flags any scenario below 2/3 as an informal alarm; N defaults to 3, configurable. The rate-lane test runs each scenario N times and asserts on the aggregated rate, surfacing per-trial trails on failure. *Laziest wrong impl:* pass if *any* trial passes (rate collapses to boolean) — the aggregator test must distinguish 2/3 from 3/3 from 0/3. *Layer-fit: unit for the aggregator (fake trial results); one lane smoke under `pnpm eval`.*

- [ ] **AC3 — two-hop `available_skills` framing (unit + smoke).** The rate lane's system prompt contains an `<available_skills>` block listing each shipped skill's `name`, its **verbatim** frontmatter `description` (from `skillFrontmatters()`), and its SKILL.md `location`, plus a "read the SKILL.md at its location, then act — skills are not callable tools" instruction. The declared tool surface is Bash/Glob/Grep/Read only; no skill is a callable tool in this lane. *Laziest wrong impl:* paraphrasing the description or declaring skills as tools — the builder test must assert the description substring is byte-identical to the shipped frontmatter and that no skill name appears in the tool list. *Layer-fit: unit (prompt builder is a pure fn of `skillFrontmatters()`); lane smoke.*

- [ ] **AC4 — SKILL.md fixture + read tracking (unit).** When the model calls Read on a skill's SKILL.md location, the loop feeds back that skill's real SKILL.md body (via `readSkillFile`) and records `skill_md_read: true` with `read_turn` set; a Read of a skill location is never added to the competing-tool trail. A straight-to-Bash `weaver` call with no prior Read still matches (`skill_md_read: false`). A run that Reads the SKILL.md but never invokes weaver within budget is a non-match with `skill_md_read: true` (the diagnostic: description triggered, body did not convert). *Laziest wrong impl:* returning an empty/placeholder body, or matching on the Read as if it were the operation — the loop test must script Read→Bash, Read-only (no weaver), and Bash-only, asserting the three distinct verdicts. *Layer-fit: unit (scripted fake step).*

- [ ] **AC5 — hosted two-hop pass rule (smoke + config).** Pass = a bash call matching `^(npx\s+|pnpm\s+exec\s+)?weaver\s+<expected-command>\b` reached within the step budget under the AC3 framing; `matchWeaverCommand` accepts the `npx weaver` prefix in addition to the existing forms. The lane runs against the env-configured hosted model (OpenRouter Llama 3.3 70B via `WEAVER_EVAL_BASE_URL`/`WEAVER_EVAL_MODEL`/`WEAVER_EVAL_API_KEY`), with `global-setup.llm.ts` failing fast with OpenRouter setup instructions when the endpoint/key is absent. Zero new dependencies. *Layer-fit: assertions unit-tested for the `npx` form; one lane wiring smoke under `pnpm eval`.*

## Interface

N/A — internal eval harness. No public CLI, socket, or MCP surface changes. New env var `WEAVER_EVAL_TEMPERATURE` and `WEAVER_EVAL_TRIALS` (or equivalent) documented in `docs/eval-design.md`; not part of the shipped product interface.

## Open decisions

*All resolved 2026-07-07 (slice kickoff, user-confirmed).*

- **Rate-lane temperature → pin `0.7` as the `WEAVER_EVAL_TEMPERATURE` default.** A known sampling regime keeps trigger rates comparable across runs, so a rate delta between two description versions is attributable to the text rather than a drifting provider default. Satisfies "never temperature 0". Watch: if 0.7 proves too hot to separate signal from noise, lower it — the env var makes that a config change, not a code change. Rules out relying on OpenRouter's unspecified server default.

- **Config default when no hosted endpoint is set → fail fast requiring explicit env.** `global-setup.llm.ts` asserts a hosted endpoint is configured and prints the exact OpenRouter env to set (base URL + model + key) when unset, mirroring the existing ollama-pull fail-fast. The dead local-Ollama `DEFAULT_BASE_URL` no longer reflects how the eval runs and would produce a confusing localhost connection error. Never hardcode a key. Watch: the command/two-step lanes may also key off `modelConfig()` — the fail-fast must live in the rate lane's setup path, not globally break lanes that could still run against a different endpoint.

- **Trial loop and rate → a shared pure `runTrials`/aggregation helper the lane calls.** Keeps aggregation a unit-testable pure function and the lane self-contained, with a rich per-trial failure message. A run-level custom vitest reporter is a later nicety, not this slice. Rules out (for now) a cross-run summary view.

## Security

- **Workspace boundary:** N/A — reads only repo-local skill files and fixtures; no workspace writes.
- **Sensitive file exposure:** N/A for the workspace — but note a **trust-boundary change**: the eval now sends repo-local skill files + fixtures to a third-party (OpenRouter) instead of staying on-device. These files are already public in the repo; no user workspace content or secrets are sent. The API key is env-provided and must never be committed or logged.
- **Input injection:** N/A — no new user-supplied strings reach the filesystem or shell; the loop assembles in-memory message arrays.
- **Response leakage:** N/A — failure messages contain the model's own tool-call trail, not file content or secrets.

## Edges

- **Command and two-step lanes stay temperature 0, single-shot** — their verdicts must not change. AC1's per-lane temperature must leave them passing `0` explicitly.
- **Step budget accommodates the Read hop.** The two-hop trajectory can consume Read (SKILL.md) → optional precursor → operation, so the rate lane's budget rises from 3 to **6**; the single-shot lanes are unaffected.
- **`skillTools()` is not deleted here** — the one-hop single-shot lanes (`trigger.llm.test.ts`, `trigger-adversarial.llm.test.ts`) still use it. Their retirement is spec 2.
- **Harness unit tests stay green in `pnpm check`.** The LLM rate lane runs only under `pnpm eval`; acceptable tuning reds there never break CI.
- **`coverage.test.ts` invariant unchanged** — this spec adds no operation.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched harness helpers (config, `available_skills` builder, rate aggregator, loop extension, `matchWeaverCommand`)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] **Baseline captured, not green.** Run the rate lane against OpenRouter Llama 3.3 70B, record the per-scenario baseline rates, and classify every below-alarm scenario as either (a) a legitimate skill-text gap (leave red, queue tuning in handoff) or (b) a test problem (fix the fixture/framing/assertion before baselining). A red rate that is a classified skill-text gap is an acceptable outcome; an unclassified red is not.
- [ ] `docs/eval-design.md` updated: rate lane mechanics, two-hop framing, OpenRouter env, temperature/trials vars; mark the local-model sections superseded.
- [ ] `docs/eval-readiness.md` updated: the fast-tier lane table reflects the hosted-model rate lane.
- [ ] handoff.md reconciled: retire the subsumed eval entries (see spec commit), add spec 2 (`[needs design]`) for grader refinement + assertion audit + single-shot lane retirement.
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas (e.g. OpenRouter tool-call behaviour vs Ollama) added to `docs/eval-design.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended

---

## Outcome

**Shipped.** The trigger lane pivoted off local Ollama to a hosted OSS model (OpenRouter Llama 3.3 70B) over the existing fetch `callModel`, with: per-lane temperature (`WEAVER_EVAL_TEMPERATURE`, default 0.7; command/two-step stay 0), an N-trial (`WEAVER_EVAL_TRIALS`, default 3) trigger-*rate* metric with a 2/3 alarm floor, the two-hop `<available_skills>` framing + SKILL.md read tracking (`skillMdRead`/`readTurn`), a `computeRate` aggregator, and an `isWeaverInvocation` pass rule. Fail-fast setup requires the hosted endpoint be configured. **Zero new dependencies** — OpenRouter is OpenAI-compatible; `callModel` already spoke it.

**Baseline finding — the important result, and why "trusted baseline" (Done-when) is deliberately NOT met.** Two hosted runs both scored **0/9** (every scenario below the floor), but classification shows this is a **framing** result, not a skill-text one:

| | Run 1 | Run 2 |
|---|---|---|
| Model behaviour | hallucinated tool calls named after skills (`weaver-refactor`, `weaver-search-and-replace`) | raw shell (`bash`/`Grep`/`Glob`) |
| Outcome | 0/9 | 0/9 |

The model **never executed the two-hop chain** (Read SKILL.md → bash `weaver <cmd>`) in either run. The outcome (~zero correct CLI invocation) was stable; the *path* swung completely run-to-run — too large for temp 0.7 alone, so OpenRouter provider routing is the suspected extra variance. Presenting weaver as an `<available_skills>` block leads a hosted model to treat skills as callable tools (or ignore them for shell), not to run the CLI. A right-skill tool call is credited as a **stopgap proxy** (`matches` accepts a call named `expect.skill`) — this is *skill selection*, not correct weaver usage (weaver is a CLI); the real fix is queued.

**Decision (user-confirmed):** close spec 1 here; the framing fix gates spec 2 and runs first as a `[needs investigation]` (see handoff). Spec 2's grader/audit work is meaningless until the lane actually produces weaver invocations.

**Reflection.**
- *Went well:* the pivot was pure env config (zero deps) as predicted; the generic `callModel`/loop absorbed it cleanly. Unit-test discipline held — note **mutation is N/A here: `eval/` is in stryker `ignorePatterns`**, so unit-test assertions were the only quality gate (scrutinised each batch accordingly).
- *Didn't:* the two-hop premise didn't survive contact with the model. The single-shot lanes declared skills *as tools* precisely because small models can't do skill indirection; the pivot assumed a 70B would do the two-hop chain — it doesn't, it calls skills as tools too, non-deterministically.
- *Slower than needed:* two full baseline runs to see the path variance. **A raw-bash-command log would have shown it in one — do that first next time.**
- *For the next agent (cold start):* the trail records only tool *names*, so "the model never emitted `weaver` via bash" is **unverified vs a matcher false-negative**. Step zero of the framing investigation is to log the raw bash command strings and re-run once to confirm, before any framing change.

**Tests added:** batch 1 — 17 (config, call-model temperature, global-setup, assertions `npx`); batch 2 — 16 (context builder, `rateLaneTools`, loop predicates/read-tracking, cases invariant); batch 3 — 15 (`isWeaverInvocation`, `computeRate`). Eval unit lane totals 208 tests in `pnpm check`. **Mutation:** N/A (`eval/` stryker-excluded). The LLM rate lane runs only under `pnpm eval` and is not counted.

**Dogfooding note:** the `CaseEntry.expect` field rename (`tool`→`skill`, `subcommand`→`command`) was done with `weaver rename` across 8 files — the tool renaming its own eval harness.
