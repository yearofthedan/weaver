# Eval Baselines

**Purpose:** The current per-case baseline for the sampled rate gate, plus the dated run history behind it. What the eval measures and how to read a run: [`eval-design.md`](eval-design.md). How to run it: [`../eval/README.md`](../eval/README.md).
**Audience:** Anyone comparing a new run against history, or evaluating a model as an instrument.
**Status:** Current

---

## Current baseline

Updated **in place** — this table is the reference a new run is read against. Move superseded numbers into the run history below rather than growing columns here.

Conditions: sampled rate gate (`pnpm eval`), n=3 base trials escalating to 6 below the 2/3 floor, temperature omitted (model default sampling), pressured (clutter + per-case momentum), fixture-backed, via OpenRouter.

| Case | Exposure | Haiku 4.5 (gate) | Gemini 2.5 Flash |
|---|---|---|---|
| trigger-refactor-rename | progressive | 3/3 | 3/3 |
| trigger-refactor-rename-no-coords-sed-tempting | progressive | 3/3 | 3/3 |
| trigger-refactor-move-file | progressive | 3/3 | 3/3 |
| trigger-search-and-replace-pattern | progressive | 3/3 | 3/3 |
| trigger-search-and-replace-todos-grep-tempting | progressive | 3/3 | 3/3 |
| trigger-search-and-replace-sed-tempting | progressive | 3/3 | 3/3 |
| trigger-code-inspection-find-references | progressive | 3/3 | 3/3 |
| trigger-code-inspection-find-references-delete-intent | progressive | 3/3 | 3/3 |
| trigger-code-inspection-get-type-errors | progressive | 3/3 | 3/3 |
| **pressured-buried-rename** | progressive (3-turn) | 2/3 · **5/10 (n=10)** — false clear | 2/3 (1 content-fail) |
| pressured-buried-replace-text-passive | progressive (3-turn) | 3/3 | 3/3 |
| pressured-buried-find-references | progressive (3-turn) | 3/3 | 3/3 |
| command-rename | front-loaded | 3/3 | 3/3 |
| command-move-file | front-loaded | 3/3 | 3/3 |
| command-move-directory | front-loaded | 3/3 | 3/3 |
| command-move-symbol | front-loaded | 2/3 · 10/10 (n=10) | 3/3 |
| command-find-importers | front-loaded | 3/3 | 3/3 |
| command-find-references | front-loaded | 3/3 | 3/3 |
| command-get-definition | front-loaded | 3/3 | 3/3 |
| command-get-type-errors *(observational)* | front-loaded | 2/3 · 6/10 (n=10) | 4/6 |
| command-search-text | front-loaded | 3/3 | 2/3 |
| command-delete-file | front-loaded | 3/3 | 3/3 |
| command-replace-text | front-loaded | 3/3 · **10/10 (n=10)** | 3/3 |
| two-step-search-then-rename | front-loaded (seeded) | 3/3 | 3/3 |
| **two-step-cat-then-extract** | front-loaded (seeded) | **3/6 — alarms** · 8/10 (n=10) | 3/3 |
| boundary-bash-search-non-ts-project | boundary | 3/3 clean | 3/3 clean |
| boundary-bash-remove-console-log | boundary | 3/3 clean | 3/3 clean |
| **Cases cleared** (of 27) | | **26** | **27** |

**Two cases sit at the floor, and n=3 resolves neither.** Widening both to n=10 inverted the gate's verdict on each:

- `two-step-cat-then-extract` alarmed at 3/6 but measures **8/10** widened (pooled 11/16 ≈ 0.69, just above the floor). The alarm was substantially bad luck, not a clean red. It also matches the rubric's *canary-specific* pattern (Haiku marginal, Gemini 3/3), so it is low-urgency rather than an audience risk.
- `pressured-buried-rename` **cleared at 2/3 while truly sitting at 5/10** — a false clear, and the more serious of the two. Its failures are `no attempt`: the model loads the skill, explores with `grep`/`search-text`, and never converges inside the 6-step budget.

Both are tracked in [`handoff.md`](handoff.md). The practical rule this run established: **treat any 2/3 or 3/6 as unresolved and widen it before drawing a conclusion** — in either direction. A case at the floor is one draw from either verdict.

## How to record a run

```bash
pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
# cross-family sweep
WEAVER_EVAL_MODEL=google/gemini-2.5-flash pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
```

Per-case rates are the ground truth — any aggregate derives from them, so record these even if a summary metric changes. For a **cross-model** run, record the four-tier outcome composition of any non-ceiling case, not just the rate: it separates a body weaver can fix (`content-fail`) from host-exposure noise it cannot (`warned-pass`). Update the table above in place and add a dated entry below.

---

## Run history

### 2026-07-26 — first run under the unified sampled rate gate

The baseline above. This run is also the real-path verification of the gate itself: escalation fired for the first time (`two-step-cat-then-extract` went below the floor at n=3, escalated to 6, alarmed at 3/6), observational reporting printed a non-gating rate, and `finish_reason` plus full bash command strings appeared in every trail.

Two standing `[needs investigation]` entries were resolved or corrected by measurement:

- **`replace-text` reaching for `sed` at rate — not reproduced.** The 2026-07-24 record had it at 2/5 with `find … -exec sed -i`. Re-measured at **10/10 with zero `sed`**, meeting the n≥10 bar that entry itself set. Neither obvious confounder explains the gap: the new condition omits `temperature` entirely (so the provider default, *higher* than the old forced 0.7), and every one of the 10 matched on the **first** call, so the wider step budget is not rescuing it. The likeliest reading is that n=5 was thin — which the entry anticipated. Entry removed.
- **`two-step-cat-then-extract` fails by a different mechanism than recorded.** The 2026-07-23 entry describes the model staging extract-function *JSON args* to a temp file. Observed here instead: it rewrites the **source file** with a heredoc (`cat > …/auth.ts << 'EOF'`), performing the extraction by hand, in 2 of 6 trials; a third trial emitted no tool call at all. The entry's mechanism description needs correcting; root cause remains unconfirmed.

The heredoc rewrite also validates the gate's destructive-scope decision: truncating a source file is destructive, the hard-fail rule deliberately does not cover raw shell, and the sampled rate caught it anyway.

**Gemini 2.5 Flash sweep, same day:** 27/27 cleared. Notable divergences from Haiku — it clears `two-step-cat-then-extract` 3/3 and `command-move-symbol` 3/3, but is marginal where Haiku is clean (`command-search-text` 2/3) and escalated on `command-get-type-errors` (4/6). No case is red on Gemini and green on Haiku, so no inverted-canary alarm.

**Widening the four ambiguous cases (Haiku, n=10).** Two of four gate verdicts inverted:

| Case | Gate verdict (n=3) | Widened (n=10) |
|---|---|---|
| `two-step-cat-then-extract` | 3/6 — alarmed | **8/10** |
| `pressured-buried-rename` | 2/3 — cleared | **5/10** |
| `command-move-symbol` | 2/3 — cleared | 10/10 |
| `command-get-type-errors` | 2/3 — observational | 6/10 |

`pressured-buried-rename` was **11/12** at the 2026-07-24 spike, so 5/10 is a real drop. The sampling condition does not account for it: forcing the old `WEAVER_EVAL_TEMPERATURE=0.7` gives **8/10** against **5/10** omitted — directionally consistent but underpowered (two-tailed Fisher p = 0.35 at n=10 per arm), and still short of 11/12 either way. Tracked as `[needs investigation]` in [`handoff.md`](handoff.md), framed as a gate-or-delete question about the case rather than a harness one.

### Superseded conditions

Everything below was measured under the retired lane structure — temperature-0 single-shot command, pressured-emission, and two-step lanes, plus a temp-0.7 agentic lane. **Rates are not directly comparable to the table above:** the current gate samples at the model's default temperature, requires correct `keyArgs` on the progressive exposure (the old trigger lane gated on subcommand alone), and runs every case under pressure.

#### 2026-07-24 — pressured emission, temp 0 vs temp 0.7

The measurement that motivated retiring temperature-0 gating. Read the temp-0 column as a fingerprint, not a rate.

| Case | Haiku, temp 0, n=1 (what gated) | Haiku, temp 0.7, n=5 |
|---|---|---|
| rename, move-symbol, find-importers, find-references, get-definition, search-text, delete-file | held | 5/5 |
| move-file | held | 4/5 (`mkdir` + `mv`) |
| move-directory | held | 4/5 (`mv`) |
| **replace-text** | held — gated green | **2/5** (`find … -exec sed -i`) |
| **get-type-errors** | **fell back → `npx tsc`** (4/4) | **3/5** |

The two bolded rows invert: one gated green at a true 2/5, the other gated red while passing more often than not. Both directions of error in one lane — the direct evidence for sampling.

#### 2026-07-24 — buried-case routing spike (Haiku, n=6)

Routed each `pressured-buried-*` case gate-or-delete; a case gated only if it converged comfortably above the floor *and* the trail showed convergence.

| Case | Spike | Routing |
|---|---|---|
| `pressured-buried-rename` | 11/12 (n=12) | gate |
| `pressured-buried-replace-text-passive` | 6/6 | gate |
| `pressured-buried-find-references` | 6/6 | gate |
| `pressured-buried-replace-text-active` | 6/6, **args wrong** | delete (kept passive — cleaner args) |
| `pressured-buried-search-text` | 4/6, 2 fails explore with grep/find/awk | delete (knife-edge; measures task ambiguity, not skill text) |

#### 2026-07-23 — cross-model run (retired lane structure)

| Case group | Haiku 4.5 | DeepSeek V3 | Gemini 2.5 Flash | Gemini 3.5 Flash Lite |
|---|---|---|---|---|
| Command lane (11 single-shot) | 11/11 | 10/11 | 11/11 | 11/11 |
| Cases passed (of 29) | 28 | 21 | 27 | 27 |
| Run cost (USD) | $0.962 | $0.247 | $0.0986 | $0.252 |

Cost tracks tokens, not wall time. DeepSeek ran ~2.5× slower than Haiku yet cost ~4× less. Gemini 3.5 Flash Lite is dominated — same nominal $/token as 2.5-flash but ~2.5× the run cost (likely hidden reasoning tokens billed at the output rate) *and* lower quality.

**DeepSeek V3** showed two behaviours, neither a skill defect: it calls skill *names as tools* rather than loading them (host-integration artifact the harness now absorbs), and after that error it **fabricates a result and reports fake success** without running weaver — a confabulation weakness Claude does not share. Not a compelling instrument swap.

**The 2026-07-25 Gemini zero-rate correction.** An earlier record had Gemini at 0/10 on `rename`/`move-symbol` and 1/10 on `find-references`. That was an instrument artifact: Gemini selected the correct op with correct args every time, expressed as a hallucinated *native* tool call (`weaver_refactor_rename({...})`, `native_finish_reason: UNEXPECTED_TOOL_CALL`). The retired single-shot lane's `extractBashCommands` dropped non-bash calls silently and reported "(no bash call)", with no turn in which to feed back the "no such tool" error a real host returns. Both holes are closed in the current gate — the trail prints every call and `finish_reason`, and the loop feeds the error back. This is the origin of the front-loaded exposure's 3-step budget.
