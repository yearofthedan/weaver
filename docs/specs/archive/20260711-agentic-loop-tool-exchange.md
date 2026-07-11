# Agentic loop fabricates a lossy history instead of a standard tool exchange

**type:** bug
**date:** 2026-07-11
**tracks:** handoff.md # Agentic loop standard tool-use exchange

---

## Symptom

Any agentic-lane trial that needs two weaver hops (search for a position, then act on it) never converges — the model loops on the first hop. Reproduced on the Haiku lane, `trigger-refactor-rename-no-coords-sed-tempting`, 0/3:

```
input:    "Rename the variable userId to accountId across all TypeScript files
           in /tmp/weaver-eval/src. I don't have the line numbers."
actual:   model runs `weaver search-text` → gets the position back → runs the
          identical `weaver search-text` again → again → never advances to a
          rename/replace. 0/3.
expected: the model runs the search once, sees it already has the position in
          its own history, and advances to the next hop.
```

The single-hop cases (8/9) are unaffected because they converge on their first weaver call and the loop returns before echoing anything back — so this defect was invisible until a genuine multi-hop case (the scenario-owned `search-text` stub) exercised the echo path for the first time.

## Value / Effort

- **Value:** The multi-hop path is a first-class agent workflow (an agent rarely has line/col to hand). While it's broken, the lane cannot measure multi-hop convergence at all, and the same defect is the true cause of the two-step lane's long-standing false negative (previously mis-attributed to its degenerate seed). Fixing it makes multi-hop trajectories measurable and removes the last Ollama-era workaround from the sole trigger lane.
- **Effort:** Root cause confirmed (reproduced red + mechanism observed via `WEAVER_EVAL_DEBUG` trace). The fix is localised to `runAgenticLoop`'s echo and the habit-momentum seed. No new transport machinery — `call-model.ts` already supports `tool_calls`/`tool`-role messages and id round-tripping. Lane-wide behavioural risk (it changes every trial's history), so verification is a full-lane re-run.

## Expected

After each model turn, the conversation the harness sends on the *next* turn faithfully represents what the model just did: an `assistant` message carrying the model's real text and its real `tool_calls`, followed by a `tool`-role result message for each call. The model can then read its own prior action and advance.

## Root cause

`eval/harness/agentic-loop.ts`, the echo in `runAgenticLoop`: after the model responds, the loop discards `response.text` and the real tool call and pushes a fabricated pair —

```ts
{ role: "assistant", content: `I'll use ${call.name}.` },   // e.g. "I'll use bash."
{ role: "user", content: `Output of ${call.name}:\n${result}\n\nContinue.` },
```

The model is stateless, so the history the harness constructs is all it knows. That history omits both the model's reasoning and the actual command (collapsed to the tool *name*, "bash"). Confirmed from the `WEAVER_EVAL_DEBUG` trace: every turn the model restates the same plan ("I'll search… then replace") and re-runs step 1, because its own record of step 1 was never put in the messages. This is a harness history-construction bug, not a model limitation.

The plain-text placeholder existed for one reason — Ollama silently drops seeded `tool_call`/`tool`-role messages (assertion-audit spike #3). Ollama is no longer a target lane, so the constraint is gone.

## Fix

`eval/harness/agentic-loop.ts` — replace the fabricated echo with a standard simulated tool exchange:

- Push the model's actual assistant turn: `{ role: "assistant", content: response.text || null, tool_calls: calls }`.
- Push one `{ role: "tool", tool_call_id: <call id>, content: resultTextFor(call) }` per call in `calls`. An OpenAI-compatible endpoint requires a `tool` response for **every** `tool_call` in the preceding assistant message — so respond to all calls, not just `calls[0]`.
- Normalise ids: ensure each call has a concrete `id` before echoing so the assistant `tool_calls` and the `tool` responses reference the same id (some providers omit ids). Do the id assignment in one place so the two sides cannot drift.
- Apply the same to the skill-load branch (the `Skill`/`Read` call and its SKILL.md-body result).
- Delete the plain-text-echo rationale comment and the Ollama justification.

`eval/harness/seed.ts` — `buildHabitMomentumSeed`: convert to the same format so the seed is a coherent tool-use conversation (assistant `bash` tool_call + `tool` result for the primed grep turn), not a plain-text pseudo-turn followed by real tool turns.

Keep `WEAVER_EVAL_DEBUG` (added during the investigation) and render its per-turn trace in tool form.

**Adjacent inputs to guard:** a turn with multiple tool calls (every id must get a `tool` response, or the next request 400s); a turn with empty `response.text` (assistant content is `null`, tool_calls still carry the action); the skill-load turn (same faithful echo, large SKILL.md body as the tool result).

**Out of scope (leftover Ollama sweep):** the command lane's text-emission ("reply with ONLY the command") and the two-step lane's degenerate `'{}'` seed are the other two Ollama accommodations. The command lane works single-shot; the two-step lane is slated for rebuild on the scenario-owned-results infra and will be tool-format then. Neither is patched here — noted in handoff.

## Security

- **Workspace boundary:** N/A — eval harness only; no file writes, no path handling changes.
- **Sensitive file exposure:** N/A — results fed back are author-controlled stub content, unchanged by this fix.
- **Input injection:** N/A — the model's tool-call arguments are already captured by `call-model.ts`; this only changes which messages are appended to the in-memory array.
- **Response leakage:** N/A — no error messages or response fields change; the exchange is model-under-test ↔ harness, no user secrets.

## Edges

- **The 8 single-hop cases must hold.** They converge on the first weaver call and never reach the echo, so behaviour should be unchanged — but the seed conversion touches their starting context, so a full-lane re-run is required, not just the no-coords case.
- **Boundary cases** (`expect.skill === "bash"`) run to the step budget echoing bash results; they must stay clean under the new format.
- **Finding B is not fixed here.** With faithful history the no-coords case will advance, but it selects `weaver-search-and-replace` for "rename this variable" and would converge on `replace-text`, not the `rename` the case expects. That is a skill-text/grader question routed to the grader spec — this fix is verified by the multi-hop *mechanism* working (the model advancing past the search), not by this specific case going green.

## Done-when

- [ ] The multi-hop echo produces a standard `assistant(tool_calls)` + `tool(result)` exchange, unit-tested in `agentic-loop.test.ts` (assert the appended messages' roles, `tool_calls`, and matching `tool_call_id`s; a multi-call turn gets a `tool` response per id)
- [ ] `buildHabitMomentumSeed` emits tool-format messages, unit-tested in `seed.test.ts`
- [ ] Full agentic lane re-run on the Haiku env: the 8 single-hop cases still pass; the no-coords case now *advances past the repeated search* (records the observed behaviour — likely `replace-text`, surfacing Finding B) — record rates in the Outcome
- [ ] Mutation score ≥ threshold for `agentic-loop.ts` and `seed.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `docs/eval-design.md` updated: the agentic lane simulates a standard tool exchange (no plain-text echo); note Ollama is no longer a target and the plain-text workaround is retired
- [ ] Leftover Ollama-sweep note (command lane text-emission, two-step seed) added to handoff.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Fixed and verified — the mechanism works; the target case is still red for reasons downstream of this fix.**

`runAgenticLoop` now replays each turn as a standard tool exchange (assistant message with real `tool_calls`, a `tool`-role result per call, ids normalised inside the echo so `trail` keeps the model's original call objects). `buildHabitMomentumSeed` is the same format. `WEAVER_EVAL_DEBUG` (the trace that root-caused this) is kept as harness tooling.

**Verification (Haiku lane):** the full agentic lane held — 8 single-hop skill cases 3/3, 5 boundary cases 3/3 clean, no regression from the format change. The `WEAVER_EVAL_DEBUG` trace confirmed the fix directly: before, the model ran the *identical* `weaver search-text` 3–4× and never advanced; after, it progresses through distinct reasoned hops (search → reasons about the result → find-references → reads the file → re-searches) and even articulates the scope-aware-rename argument. The no-coords case is still 0/3, but now because it explores without landing `rename` in the 6-step budget and because an unanticipated `find-references` hop got the generic `authenticate` fixture — both downstream of this fix (Finding B / grader).

**Reflection:**
- *The transport already supported the fix.* `call-model.ts` had `tool`-role messages, `tool_calls`, and id round-tripping all along — the loop just wasn't using them. This was removing a workaround (Ollama's dropped tool messages), not building machinery. The "why it's lossy" was a stale comment, not a real constraint.
- *Reframing dissolved the problem.* The first-instinct fix was a "faithful plain-text echo." The user's "Ollama is out — do a standard simulation exchange" was simpler and correct; don't preserve a workaround's shape once its reason is gone.
- *Multi-hop working surfaces the next gap.* The moment trajectories converge, every hop needs a scenario-coherent stub — the generic per-operation fixture derails the model. Logged for the grader/pressure-ladder work.
- *id normalisation belongs in the echo, not at the top of the loop* — normalising `response.toolCalls` up front would replace the objects `trail` reports on and break reference identity a test relied on.

**Tests added:** `test:eval` 276 → 280 (standard-exchange replay incl. multi-call id-matching and text-vs-null content; malformed-arg error now asserted on the `tool` message; `buildHabitMomentumSeed` tool-format shape). **Mutation:** N/A — `eval/` is outside Stryker scope (tracked separately in handoff).
