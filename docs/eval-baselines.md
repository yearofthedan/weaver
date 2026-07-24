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

Each skill-trigger case now also prints a four-tier outcome composition (`clean-pass` / `warned-pass` / `content-fail` / `never-reached` — see [`eval-design.md`](eval-design.md) *Content vs. exposure*). For a **cross-model** run, record the composition of any non-3/3 case, not just the rate: it separates a body weaver can fix (`content-fail`) from host-exposure noise it can't (`warned-pass`), which is the whole point of running a non-Claude model. A `warned-pass` or `content-fail` seen only on non-Claude models is a host/model signal, not a regression in the skills.

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
| pressured-buried-rename ‡ | agentic (observational) | 3/3 | 0/3 | 0/3† | 0/3 |
| pressured-buried-replace-text-active | agentic (observational) | 3/3 | 2/3 | 3/3 | 2/3 |
| pressured-buried-replace-text-passive | agentic (observational) | 3/3 | 0/3 | 3/3† | 3/3 |
| pressured-buried-search-text | agentic (observational) | 2/3 | 2/3 | 2/3 | 0/3 |
| pressured-buried-find-references | agentic (observational) | 3/3 | 1/3 | 3/3 | 0/3 |
| boundary-bash-search-non-ts-project | boundary (clean) | 3/3 | 3/3 | 3/3 | 2/3 (over-trig) |
| boundary-bash-remove-console-log | boundary (clean) | 3/3 | 2/3 | 3/3 | 3/3 |
| two-step-search-then-rename | two-step | pass | fail | pass | pass |
| two-step-cat-then-extract | two-step | fail | fail | pass | pass |
| **Cases passed** (of 29) | | **28** | **21** | **27**† | **27** (2 gated fails) |
| **Run cost (USD)** | | **$0.962** | **$0.247** | **$0.0986** | **$0.252** |

Cost is the full-lane, n=3 run price via OpenRouter, and tracks tokens, not wall time. DeepSeek ran ~2.5× slower than Haiku yet cost ~4× less (low per-token price). Gemini 3.5 Flash Lite is the surprise: **same nominal $/token as 2.5-flash but ~2.5× the run cost** ($0.252 vs $0.0986) despite a *faster* run with shorter/empty visible outputs — it burned ~2.5× more tokens, most likely hidden reasoning tokens billed at the output rate (3.5 being a thinking model; not confirmed against a token breakdown). Net verdict: **Gemini 2.5 Flash dominates** — cheapest (~10× under Haiku) and, on completed cases, highest quality of the non-Claude runs (matched Haiku on every gating case, passed both two-step). 3.5 Flash Lite is dominated: ~2.5× the cost *and* lower quality (collapses under momentum pressure — 0/3 on three buried cases), marking the lite-tier boundary. DeepSeek is cheap-ish but confabulates edits (see below).

† **These two 2.5-flash cells crashed on the first run and are backfilled from a post-fix re-run.** The first run threw when 2.5-flash hallucinated a skill as a directly-callable tool with an **underscore** name (`weaver_code_inspection`) — the guard matched only hyphenated names, so the underscore variant fell through and crashed the trial. Fixed in commit `50d6285`: any undeclared tool now gets a host "no such tool" error and is graded. The re-run **verified the fix on the real path** — the same underscore hallucination recurred (`pressured-buried-rename` trials) and was handled gracefully, so the case graded 0/3 instead of crashing. Caveat: the re-run also showed n=3 variance vs the first run (`rename-no-coords` 3/3→1/3, `pressured-buried-search-text` 2/3→0/3), so read single-run per-cell rates as indicative, not exact — this column mixes the two runs. The `pressured-buried-rename` spread here (0/3 for every non-Claude model, only Haiku 3/3) read like a skill signal but was later traced to a dead instrument, not skill text — see ‡ below (corrected 2026-07-24).

‡ This row's non-Claude `0/3` was a dead instrument, not a skill signal — the task's leading inspect step targeted the op's own file, which the harness cannot read coherently, so literal models stalled (general rule: [`eval-design.md`](eval-design.md) Working discipline, "own-file inspect step"). Clause removed 2026-07-24; post-fix single-case runs: Gemini 2.5 Flash 6/6 (n=6), Haiku 11/12 (n=12).

### Buried-case routing spike (2026-07-24)

Spike at **n=6 on Haiku** (the canary/gate model; rename already had n=12) to route each `pressured-buried-*` case gate-or-delete. Rule: a case gates only if it converges comfortably above the 2/3 floor (≥5/6) *and* the trail shows it converging; a case at the knife-edge or exploring the shell instead of converging is measuring temp-0.7 task ambiguity, not skill text, and is deleted.

| Case | Haiku spike | Trail | Routing |
|---|---|---|---|
| `pressured-buried-rename` | 11/12 (n=12) | converges | **gate** |
| `pressured-buried-replace-text-passive` | 6/6 | single-shot `replace-text`, args correct | **gate** |
| `pressured-buried-find-references` | 6/6 | converges, args correct | **gate** |
| `pressured-buried-replace-text-active` | 6/6 | converges but **args wrong** (surgical-edits path); same op/fixture as passive | **delete** (kept passive — cleaner args, harder discriminator) |
| `pressured-buried-search-text` | 4/6 | 2 fails **explore with grep/find/awk**, never reach weaver | **delete** (knife-edge; the grep-fallback is already reported by pressured-emission `command-search-text` KNOWN_RED) |

Gate confirmation (n=3, default lane, gating assertion active): rename 3/3, replace-text-passive 3/3, find-references 3/3 — all clean-pass.

### Pressured emission lane (single-shot × pressured)

`pressured-emission.llm.test.ts` — the command cases wrapped in a clutter system prompt + a 3-turn habit-momentum seed, bash-only, **temp 0 (deterministic, n=1)**. Grades single-shot emission (command + `keyArgs`) under host pressure. Baseline **2026-07-24**:

| Case | Haiku 4.5 (gate) | Gemini 2.5 Flash |
|---|---|---|
| command-rename, command-move-directory, command-move-symbol, command-find-references, command-get-definition, command-delete-file, command-replace-text | held | held |
| **command-move-file** | held | **fell back → `mv`** |
| **command-find-importers** | **fell back → `grep` (imports)** | held |
| **command-get-type-errors** | **fell back → `npx tsc`** | held |
| **command-search-text** | **fell back → `grep`** | held |

Both models, primed by the `grep`/`git log`/`find` seed, fall back to the shell equivalent the seed primed — but on *different* ops (Haiku on the read/search-shaped ones, Gemini on `move-file`). None of these fallbacks is a copied precedent: the seed is weaver-orthogonal (log grep, git history, filename find — never a shell stand-in for a graded op), so the fallback is habit transfer, not a demonstrated substitution. The lane gates the held cases and reports the fallbacks; the three Haiku reds are its known-red set, pending skill-body hardening.

### Headline findings per run

**Haiku 4.5 (canary).** Passes every gating case at the floor. Standing reds unrelated to model quality: `two-step-cat-then-extract` (model stages extract-function args to a temp file, never emits the command — [handoff `[needs investigation]`]) and `pressured-buried-search-text` at 2/3 (loads the skill under momentum but explores with grep/find instead of converging). `pressured-buried-rename` 3/3 here is not a skill read — the case was a dead instrument (‡); true Haiku rate ~11/12 (n=12).

**DeepSeek V3.** Two behaviours, neither a weaver skill defect. (1) It calls skill *names as tools* (`weaver-refactor(...)`) instead of loading via `Skill()`/`Read`. But *how a host exposes a skill to the model is host integration, not skill content* — the harness models one exposure, so this is a test-setup/host artifact with nothing in `src/` to change; the harness answers "no such tool" and a capable model recovers. (2) After that error, DeepSeek **fabricates a result and reports fake success** without ever running weaver (e.g. "47 occurrences replaced" after a partial `sed` on 2 of 3 files) — a model confabulation weakness Claude does not share. Also over-triggered one boundary trial. Not a compelling canary swap: 2.5× slower, and its misses are model/host-shaped noise, not evidence about whether the skill *content* is usable — which is what the eval exists to measure.
