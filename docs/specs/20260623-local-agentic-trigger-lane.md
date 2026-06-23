# Local agentic trigger lane (eventual-operation metric)

**type:** change
**date:** 2026-06-23
**tracks:** handoff.md # Agent-SDK frontier cold-context eval rung → docs/eval-design.md

---

## Context

The adversarial trigger lane (`eval/cases/trigger-adversarial.llm.test.ts`) asserts only on the
model's *first* tool call. For a sequencing-sensitive task this scores a legitimate *precursor* as
a loss: a rename task where the model first reaches for `weaver-code-inspection` (find-references)
and would rename next fails, even though it never left weaver's skills. The original handoff entry
framed the fix as an Anthropic-API-gated "frontier cold-context" rung, but the load-bearing
instrument — *check the operation the model converges on across several steps, not just its first
call* — is buildable on the existing local Ollama harness with no API access. This spec builds that
local multi-step lane; the frontier-fidelity and real-execution pieces are spun off to the handoff
as still-gated items.

## User intent

*As a weaver maintainer editing skill descriptions, I want the adversarial eval to credit the skill
when the model reaches it after a sensible precursor step, so that I get a true sequencing signal
instead of false losses that punish correct multi-step behaviour.*

## Relevant files

- `eval/cases/trigger-adversarial.llm.test.ts` — the single-shot lane this complements; keep it as
  the immediate-win baseline. The gap between the two lanes is itself signal (red there, green here
  = a precursor case, not a regression).
- `eval/harness/call-model.ts` — `callModel` and the `ChatMessage`/`ToolCall`/`ModelResponse` types;
  the loop's per-step call has the shape `callModel` already satisfies.
- `eval/harness/seed.ts` — `buildHabitMomentumSeed` (the pressure seed) and the plain-text-turn
  convention; the loop's step echo follows it (see Open decisions).
- `eval/harness/tools.ts` — `skillTools()`, `COMPETING_TOOLS`, `BASH_TOOL`; the lane's tool set is
  the same as the adversarial lane, and the canned-result source must cover every tool in it.
- `eval/harness/clutter.ts` — `buildClutterSystemPrompt()` for host-like pressure.
- `eval/cases/cases.ts` — `CASES`; the lane runs the `stage === "trigger" && expect.tool !== "bash"`
  subset, same as the adversarial lane.
- `eval/cases/two-step.llm.test.ts` — reference for wiring fixtures into a multi-turn prompt as
  plain-text turns.
- `docs/eval-design.md` — the consumer-fidelity ladder and adversarial-lane sections need updating
  for the new lane (Done-when).

### Red flags

- No oversized files in the touched set; `eval/harness/` files are small and single-purpose.
- **Test hotspots:** none — the loop logic lands in a new unit test file; the LLM lane is its own
  file. Nothing existing is pushed toward threshold.
- **Layer-fit:** AC1–AC4 are pure functions of injected inputs → unit-tested with a fake step
  function, no model server, run in `pnpm check`. AC5 is the only model-touching case → one wiring
  smoke, runs only under `pnpm eval`.

## Value / Effort

- **Value:** The adversarial lane is the one instrument telling the maintainer whether a skill
  description survives host pressure. Today a green→red flip is ambiguous — "I weakened the
  description" or "the model picked a reasonable precursor" — which makes the lane untrustworthy for
  exactly the sequencing-sensitive cases it exists to stress. The eventual-operation metric removes
  the false negatives so a red result means a real regression.
- **Effort:** Contained. Reuses `callModel`, the tool sets, the clutter and habit-momentum builders,
  and the existing fixtures. New surface: one loop helper + one canned-result source, their unit
  tests, and one LLM lane file. No daemon, no API, no new infrastructure.

## Behaviour

- [ ] **AC1 — converge after precursor (unit).** Given a model that calls `weaver-code-inspection`,
      then `weaver-refactor`, for an expected tool of `weaver-refactor`, the loop reports a match and
      records both calls in order. A match on the first call is also reported as a match.
- [ ] **AC2 — non-convergence by exhaustion (unit).** Given a model that keeps calling
      non-expected tools (e.g. `Grep`, then `Edit`), the loop reports no match once the step budget
      is spent, and calls the model no more than the budget allows.
- [ ] **AC3 — early give-up (unit).** Given a model whose response carries no tool call before the
      budget is reached, the loop stops there, reports no match, and does not call the model again.
      (Distinct path from AC2: abandoning tools vs. exhausting the budget.)
- [ ] **AC4 — canned result source (unit).** The source returns a non-empty canned result for every
      tool in the lane's set (each skill, each competing tool, `bash`), and throws for an unknown
      tool name rather than returning an empty string that would silently corrupt the next step.
- [ ] **AC5 — the local agentic lane (integration, `pnpm eval`).** A new lane runs the skill-trigger
      cases (boundary/bash excluded) through the loop under clutter + habit-momentum + competing-tools
      pressure, feeding canned results between steps. Pass = the case's expected skill is reached
      within the step budget. On failure the message reports the full trail of tool calls so the
      maintainer sees what the model converged on instead.

## Interface

N/A — internal eval harness, no public surface.

## Open decisions

**How to echo each completed step back into the conversation history.**

- **Options:** (a) real OpenAI tool-loop messages (assistant `tool_calls` + a `tool` result
  message); (b) plain-text turns (an assistant text turn + a user turn carrying the canned result).
- **Tradeoffs:** Ollama silently drops *seeded* `tool_call`/`tool` messages — the documented reason
  `seed.ts` and the two-step lane already use plain text. Option (a) would put tool-format messages
  into the history sent on the next step, risking a silent drop that makes the loop measure nothing,
  the same invisible failure class as the `OLLAMA_CONTEXT_LENGTH` truncation gotcha. Option (b) keeps
  every sent history in plain text while the model still emits a fresh tool call each step, read
  straight from the response.
- **Resolution: (b) plain-text turns**, mirroring `buildSeedMessages`. We only *read* tool calls out
  of each response; we never *send* tool-format messages back. Recorded so the executor doesn't
  default to the OpenAI tool-loop shape and regress the lane silently.

## Security

- **Workspace boundary:** N/A — reads only repo-local skill files and fixtures; outbound HTTP to the
  configured local model server; no workspace writes.
- **Sensitive file exposure:** N/A — canned results are static in-repo strings; no extra file content
  enters the prompt beyond already-committed skill files and fixtures.
- **Input injection:** N/A — no new user-supplied strings reach the filesystem or shell; the loop
  only assembles in-memory message arrays.
- **Response leakage:** N/A — failure messages contain the model's own tool-call trail, not file
  content or secrets.

## Edges

- **Step budget of 1 ≡ single-shot.** With the budget at 1 the lane must produce the same verdict as
  the adversarial first-call assertion for the same case — a guard that the loop adds steps without
  changing the base semantics.
- **The match is on the model's emitted tool calls, never on the canned text we inject** — a canned
  result that mentions a skill name must not be read as a tool call.
- **Lane parity with the adversarial subset.** Both lanes run the identical case subset, so the gap
  between them is interpretable.
- **Local-model sustain risk.** Whether qwen2.5:7b reliably sustains a 2–3 step loop is unverified;
  the deterministic guarantee lives in AC1–AC4. Done-when requires running the lane and recording
  observed behaviour, not asserting a convergence rate.

## Done-when

- [ ] All ACs verified by tests (AC1–AC4 run in `pnpm check`; AC5 lane runs under `pnpm eval`)
- [ ] Mutation score ≥ threshold for the new loop helper
- [ ] `pnpm check` passes (lint + build + test) — the LLM lane stays out of `pnpm check`
- [ ] `pnpm eval` run once with `OLLAMA_CONTEXT_LENGTH=16384`: lane executes end-to-end without
      stalls; the motivating precursor case (rename task that takes find-references first) is
      observed, and its behaviour recorded in the Outcome section
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] `docs/eval-design.md` updated: add the agentic lane to the consumer-fidelity ladder /
      adversarial-lane sections, note the eventual-operation metric, the plain-text echo convention,
      and how to read the gap between the single-shot and agentic lanes
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
