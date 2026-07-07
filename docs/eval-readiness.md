# Eval-suite readiness verdict

**Status:** Current
**Date:** 2026-06-24
**Companion to:** [`eval-design.md`](eval-design.md) (mechanics). This doc is the verdict — what each lane claims, what it costs, what earns its keep, and what the suite does and doesn't predict.

---

> **Status note (2026-07-07).** The pressured multi-step lane has been rebuilt as a **hosted-model trigger-*rate* lane** (OpenRouter, temp 0.7, N trials) per archived spec `20260707-hosted-model-trigger-rate`. This partly actions the fast-tier verdict below (the repeat-N / hosted-calibration items) but the lane table's "7B canary" rows no longer describe the rate lane. The first baseline surfaced a **framing** failure (the hosted model doesn't invoke the CLI under the `<available_skills>` framing); a `[needs investigation]` in `docs/handoff.md` gates further eval work. Full reconciliation of this table waits on that.

## What this measures

The object under test is the **skill files** (`description` + body). The suite asks: given these files, does an agent select weaver and emit the right command? It does **not** test engine correctness (unit/integration tests do) or the eval machinery itself (the structural invariants, below).

Under all of it sit the **structural invariants** — coverage parity (every operation has a case + fixture) plus harness unit tests (assertion parser, agentic-loop branching, driven by a fake model). No model, deterministic, run in `pnpm check`. They keep the behavioral lanes measuring correctly; they are not a skill-eval lane and are not in the comparison below.

## 1. The behavioral lanes

Each lane is a standing hypothesis: **given** the setup, **when** a targeted prompt arrives, **then** the claim holds. A red run falsifies the claim — that is the signal.

| Lane | Setup (Tools · Context · Turns) | Claim — holds when green | Speed | False-failure risk | Precision | Model |
|---|---|---|---|---|---|---|
| **Clean trigger** | WEAVER · clean · single | the description alone wins selection (vs bash + sibling skills) | 1 call | low — deterministic (temp 0) | medium — mis-credits precursors | 7B canary (weak = stress floor) |
| **Command** | NONE · clean · single | the body produces the right `weaver` command + args | 1 call | medium — JSON-emission parse noise | high — classified failure reasons | 7B canary |
| **Two-step** | NONE · clean · multi | the body chains one command's output into the next | 1 call (+seed) | low–medium — emission parse on seeded turn | high — exact follow-up cmd | 7B canary |
| **Pressured single-shot** | COMPETING · pressured · single | the description wins the opening move under host pressure | 1 call | high — silent CTX truncation; precursor mis-credit | low — first-call mis-attributes | 7B canary (hosted 32B+ for calibration) |
| **Pressured multi-step (canary)** | COMPETING · pressured · multi | the skill is reached under host pressure, precursors tolerated | ≤3 calls | high — CTX truncation + multi-turn drift | high — trail names the culprit | 7B canary (robustness floor) |
| **Pressured multi-step (frontier)** — cold-context | COMPETING · pressured · multi | the *real audience* reaches the skill under pressure, cold | ≤3 API calls (costly) | medium — frontier steadier; new transport surface | high — trail names the culprit | frontier via API transport *(gated: key + adapter)* |
| **Harnessed** | real host · real context · real exec | the skill works end-to-end in a real agent host | slow / costly | high — real-model + real-exec nondeterminism | highest on outcome; lower on text-vs-host attribution | **frontier (real Claude / Cursor / opencode)** *(gated, not built)* |

**Two tiers.** The canary lanes are the **fast-feedback loop** — cheap, near-deterministic, run in the edit→eval cycle; a *proxy* regression signal. The frontier and Harnessed rows are the **confidence ceiling** — the real audience, gated, not built. The loop is unvalidated against the audience until cold-context runs: canary movement is *assumed* to predict frontier behaviour, never checked.

### Findings

- **Merge — drop pressured single-shot.** Same Tools (COMPETING) and Context (pressured) as multi-step; differs only in Turns. Single-shot is multi-step at budget 1, and the multi-step loop already records the first call (`matchedAtStep === 1`). Single-shot's precision is lower (first-call mis-attributes a precursor). Retire `trigger-adversarial.llm.test.ts`; read first-call wins off the multi-step lane.
- **Gap — the body is never tested under pressure.** No lane pairs **NONE** (body) with **pressured** context. We claim the *description* survives a cluttered, habit-primed context; we make no claim the *body* (emission, sequencing) does. The empty cell is a missing lane, not a covered one.
- **Naming.** "Adversarial" is wrong on two counts: the pressure is realistic host conditions, not a crafted attack; and "adversarial" vs "agentic" name different axes (pressure vs turn-structure) while the lanes differ only in turns. This doc uses **pressure** + **single-shot / multi-step**. Test filenames stay until the merge lands.

## 2. Overfit vs generality

**Harness (`eval/harness/*`) — reusable.** `call-model.ts` is a plain OpenAI-compatible `fetch` with full config swap (`baseUrl` / `model` / `apiKey`), so a hosted frontier model is an env change. `agentic-loop.ts`, `seed.ts`, `clutter.ts`, `tools.ts` are generic host simulation; the clutter prompt is weaver-free. Weaver coupling is isolated to three points — `matchWeaverCommand` parses `weaver <sub>`, `CANNED_RESULTS`/`COMPETING_TOOLS` name the skills, `context.ts` reads `.claude/skills/`. Re-targeting to another tool is a swap of those, not a rebuild.

**Case content (`cases.ts` + seeds) — general in intent, thin and canary-shaped in specifics.** The tempting cases and grep-momentum seed encode real observed failure modes (appropriate). But the exact seed (import-grep) and phrasings are calibrated to one 7B's quirks, and the handoff already carries two refinements. `coverage.test.ts` guarantees breadth across *operations*, not across *task phrasings*.

**Verdict:** generic harness, appropriately-specific-but-thin cases, single canary. Tailored as a stress test, which is the stated design — not misleading, provided the absolute score is never read (§3).

**Prior art.** Anthropic ships [`skill-creator`](https://github.com/anthropics/skills) — a skill that evaluates a skill: runs it with vs without on test cases, grades outputs against assertions, and optimizes the description for triggering. It runs through the real host (Claude Code / claude.ai) via subagents, so it's effectively a productized **Harnessed** approach (it infers selection from outputs; it doesn't instrument the host's selection internals). Evaluate it before building our own real-host harness.

## 3. The honest gap — what we predict, for which platforms

The suite measures **robustness of skill text under local selection pressure**, not cross-platform integration outcomes.

**Predicts (canary, temp 0):**
- Relative movement — an edit that drops a lane's pass-rate is a regression; one that flips a red case green confirms a fix.
- A robustness floor — text that wins on a weak 7B under pressure is robust; stronger models are an easier audience.
- Body → command correctness; over-triggering (boundary cases); convergence under pressure.

**Does NOT predict:**
- Absolute trigger rates on **Claude Code / Cursor / opencode**. The harness is one generic tool-calling host (declared tools + synthetic clutter), not any real host's prompt or selection policy.
- Whether a real host's selection policy picks weaver — vendor policies differ; Qwen ≠ Claude.
- Integration / file-state correctness — commands are asserted as strings, never executed.
- Sub-flip erosion — temp-0 pass/fail catches a poison only when it *flips* the top choice (needs repeat-N at temp > 0 on a trustworthy model — P5, gated).

**The ceiling that would close it** is the **Harnessed** row: a real agent host running real commands against a live daemon with file-state assertions, plus the cheaper cold-context probe (frontier model in our loop, no real execution). Both are Anthropic-API-gated and not built (P5). Until then the named platforms are explicitly unpredicted; the only platform approximated is a generic tool-calling host.

## 4. Recommended cuts / keeps

**Fast tier — do now (cheap, in the edit loop):**
- **Merge** — retire pressured single-shot into pressured multi-step (canary); surface first-call via `matchedAtStep`. → follow-up handoff entry.
- **Fill the gap** — new lane: body under pressure (NONE × pressured), still canary. → `[needs design]` handoff entry.
- **Demote** — the reasoning probe (qwen3) from "rung" to optional, non-gating model-swap; failures are hypotheses (emission stalls). Reword in `eval-design.md`.
- **Rename** — adopt pressure + single-shot/multi-step in docs now; rename the test file when the merge lands. → folded into the merge follow-up.
- **Keep** — structural invariants (foundation), clean trigger (+ boundary), command, pressured multi-step (canary).
- **Keep & grow** — two-step: thin (2 cases) but the only weaver→weaver chaining lane; add cases, don't cut.

**Confidence — next (leave the canary cell):**
- **Try cold-context** — build the Anthropic transport adapter + key, run Pressured multi-step (frontier). Cheapest real-audience signal; the only check that canary movement tracks the frontier.
- **Harnessed only when justified** — real host, real execution; evaluate `skill-creator` first (Anthropic ships ~this). Consider **opencode** as the alternative host: open-source, so it can likely expose the tool-call trail directly and close the observability gap Claude Code's headless mode has (file-state inference only). A pre-release gate, never the edit loop.
- **Cross-references, no new design** — repeat-N fragility rates (P5); Harnessed e2e (P5).

These verdicts are the rubric a future `eval-specialist` agent should encode — filed as a follow-up; validate the rubric in use before freezing it.
