# Spike: assertion audit of the OSS-era eval workarounds against Haiku

**type:** spike (research — no ACs; findings and decisions only)
**date:** 2026-07-10
**tracks:** handoff.md # Grader refinement + assertion audit + single-shot lane retirement (Part 2)

---

## Question

Three eval-harness workarounds were introduced for local-Ollama / small-OSS-model
quirks. The primary lane is now a Claude-family model (Haiku 4.5 via OpenRouter). For
each: is the workaround still needed, and does flipping it to the faithful form help,
hurt, or do nothing? Keep or flip per what the hosted model actually does — do not
assume.

| # | Workaround | Location | OSS rationale |
|---|---|---|---|
| 1 | Text emission ("reply with ONLY the command") instead of a declared bash tool | `command.llm.test.ts`, `two-step.llm.test.ts` | Ollama silently drops tool calls whose args embed JSON |
| 2 | The two-step "reply with ONLY the single shell command to run next" seed protocol | `seed.ts` `buildSeedMessages` | same drop |
| 3 | Plain-text echo of completed turns instead of `tool_call`/`tool` messages | `agentic-loop.ts` | Ollama silently drops *seeded* tool messages |

## Method

`pnpm eval` against `anthropic/claude-haiku-4.5` (OpenRouter, no provider pin), the
shipped skill text, 3 trials/case for the agentic lane. Baselines: the `command`,
`two-step`, and `trigger-agentic` lanes as shipped. One flip experiment: a throwaway
tool-format-echo variant of the agentic loop (assistant `tool_calls` + `tool` messages)
over the same nine skill-trigger cases, deleted after the run.

## Results

**Baselines (Haiku, shipped harness):**

| Lane | Result | Note |
|---|---|---|
| `command` (single-shot, text emission) | 12/12 | text emission works |
| `two-step` (text emission + seed protocol) | 0/2 | both cases red |
| `trigger-agentic` (plain-text echo) | 8/9 | only `rename-no-coords-sed-tempting` red (0/3) |

**Flip experiment — tool-format echo on the agentic lane:** 7/9. Identical to the
plain-text baseline except `todos-grep-tempting` dropped 3/3 → 1/3 (two trials fell to
raw `Grep`/`grep` and never loaded the skill). No case improved.

## Findings

**#1 — text emission is no longer needed on the primary lane.** The `command` lane is
green under text emission, and the agentic lane independently shows Haiku emitting
`bash(weaver rename '{…json…}')` as tool calls with JSON-embedded args on every trail.
The Ollama drop-rationale does not apply to the hosted Claude transport. The workaround
is not *broken*, but it is legacy — a declared bash tool works.

**#2 — the two-step lane is a false negative on all models, root cause found.**
`buildSeedMessages` seeds step-1 as `weaver <subcommand> '{}'` — **empty args**. The
model reads the degenerate empty-arg search as an incomplete call and redoes it with
real args (`search-text` again) instead of advancing to `rename`; likewise
`find-references` again instead of `move-symbol`. This reproduces on Haiku identically
to the documented 70B symptom, confirming it is lane-construction-shaped, not
model-shaped or skill-text-shaped. The handoff's stated hypothesis is confirmed.

**#3 — keep the plain-text echo.** Tool-format echo gave no benefit (7/9 vs 8/9) and a
marginal knife-edge regression on `todos-grep`. Plain-text echo elicits correct
multi-step tool-calling from Haiku (a fresh tool call each turn) and stays uniform across
both the Haiku and 70B lanes. Flipping adds per-format complexity for zero measured gain.

**Bonus — a shared canned-result fidelity gap (feeds Part 1 grader + the pressure
ladder).** Both no-coords cases fail because the harness never feeds back search results
carrying the `line:col` a positional `rename` needs: the agentic lane returns a bare
file-list canned result for a `search-text` bash call, and the two-step seed is
degenerate. Under tool-format echo the no-coords rename even reaches for `replace-text` —
a semantically-wrong mutating substitute a grader would have to classify. Not fixed here.

## Decisions

- **#3 plain-text echo:** keep as-is (surviving primary lane is already correct).
- **#1 text emission** and **#2 two-step seed protocol:** do not flip in place — both live
  in single-shot lanes slated for retirement. The audit collapses into the lane
  retirement (Part 3): `trigger`, `trigger-adversarial`, `command`, and `two-step`
  retire; `skillTools()` goes with them; the boundary over-trigger guard and the
  command lane's key-arg assertions move onto the agentic lane. Part 2 and Part 3 are one
  changeset.
- The canned-result fidelity gap is logged for the grader / pressure-ladder work, not
  fixed here.
