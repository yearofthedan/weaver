# Eval Baselines

**Purpose:** Run log of the hosted skill-file eval across models and dates, for regression and cross-model comparison. What the eval measures and why: [`eval-design.md`](eval-design.md). How to run: [`../eval/README.md`](../eval/README.md).
**Audience:** Anyone comparing a new run against history, or evaluating a model as a canary/host.
**Status:** Current

---

## How to record a run

Run the full lane and capture per-case rates:

```bash
pass-cli run --env-file .env -- env WEAVER_EVAL_MODEL=<slug> pnpm eval --disable-console-intercept
```

Add a column to the table below with the per-case trial rate (`matched/total`, or `clean/total` for boundary rows). Per-case rates are the ground truth — any aggregate score derives from them, so record these even if a summary metric changes. Note the run's headline failure modes under the table.

All runs below: **n=3 trials**, temperature 0.7 (agentic) / 0 (command + two-step), fixture-backed, via OpenRouter.

---

## Runs

| Case | Lane | Haiku 4.5 | DeepSeek V3 | Gemini 2.5 Flash |
|---|---|---|---|---|
| _date_ | | 2026-07-23 | 2026-07-23 | 2026-07-23 | 2026-07-23 |
| _slug_ | | `anthropic/claude-haiku-4.5` | `deepseek/deepseek-chat` | `google/gemini-2.5-flash` | `google/gemini-3.5-flash-lite` |
| Command lane (11 single-shot) | command | 11/11 | 10/11 | 11/11 | 11/11 |
| trigger-refactor-rename | agentic (gating) | 3/3 | 1/3 | 3/3 | 3/3 |
| trigger-refactor-rename-no-coords-sed-tempting | agentic (gating) | 3/3 | 3/3 | 3/3 | 1/3 |
| trigger-refactor-move-file | agentic (gating) | 3/3 | 3/3 | 3/3 | 3/3 |
| trigger-search-and-replace-pattern | agentic (gating) | 3/3 | 1/3 | 3/3 | 3/3 |
| trigger-search-and-replace-todos-grep-tempting | agentic (gating) | 3/3 | 1/3 | 3/3 | 3/3 |
| trigger-search-and-replace-sed-tempting | agentic (gating) | 3/3 | 3/3 | 3/3 | 3/3 |
| trigger-code-inspection-find-references | agentic (gating) | 3/3 | 2/3 | 3/3 | 3/3 |
| trigger-code-inspection-find-references-delete-intent | agentic (gating) | 3/3 | 3/3 | 3/3 | 3/3 |
| trigger-code-inspection-get-type-errors | agentic (gating) | 3/3 | 1/3 | 3/3 | 3/3 |
| pressured-buried-rename | agentic (observational) | 3/3 | 0/3 | harness err† | 0/3 |
| pressured-buried-replace-text-active | agentic (observational) | 3/3 | 2/3 | 3/3 | 2/3 |
| pressured-buried-replace-text-passive | agentic (observational) | 3/3 | 0/3 | harness err† | 3/3 |
| pressured-buried-search-text | agentic (observational) | 2/3 | 2/3 | 2/3 | 0/3 |
| pressured-buried-find-references | agentic (observational) | 3/3 | 1/3 | 3/3 | 0/3 |
| boundary-bash-search-non-ts-project | boundary (clean) | 3/3 | 3/3 | 3/3 | 2/3 (over-trig) |
| boundary-bash-remove-console-log | boundary (clean) | 3/3 | 2/3 | 3/3 | 3/3 |
| two-step-search-then-rename | two-step | pass | fail | pass | pass |
| two-step-cat-then-extract | two-step | fail | fail | pass | pass |
| **Cases passed** (of 29) | | **28** | **21** | **27** (2 crashed†) | **27** (2 gated fails) |
| **Run cost (USD)** | | **$0.962** | **$0.247** | **$0.0986** | **$0.252** |

Cost is the full-lane, n=3 run price via OpenRouter, and tracks tokens, not wall time. DeepSeek ran ~2.5× slower than Haiku yet cost ~4× less (low per-token price). Gemini 3.5 Flash Lite is the surprise: **same nominal $/token as 2.5-flash but ~2.5× the run cost** ($0.252 vs $0.0986) despite a *faster* run with shorter/empty visible outputs — it burned ~2.5× more tokens, most likely hidden reasoning tokens billed at the output rate (3.5 being a thinking model; not confirmed against a token breakdown). Net verdict: **Gemini 2.5 Flash dominates** — cheapest (~10× under Haiku) and, on completed cases, highest quality of the non-Claude runs (matched Haiku on every gating case, passed both two-step). 3.5 Flash Lite is dominated: ~2.5× the cost *and* lower quality (collapses under momentum pressure — 0/3 on three buried cases), marking the lite-tier boundary. DeepSeek is cheap-ish but confabulates edits (see below).

† **Gemini 2.5 Flash's two failures are harness crashes, not model misses.** It hallucinated a skill as a directly-callable tool using an **underscore** name (`weaver_code_inspection`, `weaver_search_and_replace`); the hallucination guard in `cannedResultForCall` matches only the hyphenated `SKILL_NAMES`, so the underscore variant falls through to `cannedToolResult` and *throws*, crashing the test mid-trial. **The crash is non-deterministic: it did NOT reproduce on the 3.5-flash-lite run** (42 agentic trials, no crash), so the underscore hallucination is occasional model behaviour, not a reliably-triggered path. The bug is real by code inspection (separator-sensitive guard) but latent. See the handoff `[needs design]` entry — a deterministic unit repro (synthetic underscore `ToolCall`) is the evidence to gather before fixing, not a re-run hoping to catch a model.

### Headline findings per run

**Haiku 4.5 (canary).** Passes every gating case at the floor. Standing reds unrelated to model quality: `two-step-cat-then-extract` (model stages extract-function args to a temp file, never emits the command — [handoff `[needs investigation]`]) and `pressured-buried-search-text` at 2/3 (loads the skill under momentum but explores with grep/find instead of converging). `pressured-buried-rename` scored 3/3 here, but at n=3 that does not revise the P3 entry's n=6 finding of ~3–4/6.

**DeepSeek V3.** Dominant failure mode is **hallucinating skill names as callable tools** — it calls `weaver-refactor(...)` / `weaver-code-inspection(...)` directly instead of loading via `Skill()`/`Read`, gets a "no such tool" error, then **fabricates a result and reports fake success** without ever running weaver (e.g. "47 occurrences replaced" after a partial `sed` on 2 of 3 files). This is a model/format weakness, not a skill-text fault — Claude never does it. The generalization signal: the available-skills prompt leans on the Claude host's `Skill()` convention, which does not travel to non-Claude models. Also over-triggered one boundary trial (ran `sed` correctly, then also fired `weaver search-text`). Not a compelling canary swap: 2.5× slower and its failures are model-shaped noise rather than skill signal.
