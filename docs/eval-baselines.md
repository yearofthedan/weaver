# Eval Baselines

**Purpose:** The current per-case baseline for the sampled rate gate, plus the dated run history behind it. What the eval measures and how to read a run: [`eval-design.md`](eval-design.md). How to run it: [`../eval/README.md`](../eval/README.md).
**Audience:** Anyone comparing a new run against history, or evaluating a model as an instrument.
**Status:** Current

---

## Current baseline

Updated **in place** — this table is the reference a new run is read against. Move superseded numbers into the run history below rather than growing columns here.

Conditions: sampled rate gate (`pnpm eval`), 2/3 floor, temperature omitted (model default sampling), pressured (clutter + per-case momentum), fixture-backed, via OpenRouter. Gemini and Luna are fully widened to n=10; Haiku is n=10 where a cell says so and an n=3 draw otherwise.

| Case | Exposure | Haiku 4.5 (gate) | Gemini 2.5 Flash | GPT-5.6-Luna |
|---|---|---|---|---|
| trigger-refactor-rename | progressive | 3/3 | 10/10 | 10/10 |
| trigger-refactor-rename-no-coords-sed-tempting | progressive | 3/3 | 10/10 | 10/10 |
| trigger-refactor-move-file | progressive | 3/3 | 10/10 | 10/10 |
| trigger-search-and-replace-pattern | progressive | 3/3 | 10/10 | 10/10 |
| trigger-search-and-replace-todos-grep-tempting | progressive | 3/3 | 10/10 | 10/10 |
| trigger-search-and-replace-sed-tempting | progressive | 3/3 | 10/10 | 10/10 |
| trigger-code-inspection-find-references | progressive | 3/3 | 10/10 | 10/10 |
| trigger-code-inspection-find-references-delete-intent | progressive | 3/3 | 10/10 | 10/10 |
| trigger-code-inspection-get-type-errors | progressive | 3/3 | 10/10 | 10/10 |
| **pressured-buried-rename** | progressive (3-turn) | **5/10 (n=10)** — false clear at 2/3 | 9/10 | 10/10 |
| pressured-buried-replace-text-passive | progressive (3-turn) | 3/3 | 10/10 | 10/10 |
| pressured-buried-find-references | progressive (3-turn) | 3/3 | 8/10 | 10/10 |
| command-rename | front-loaded | 10/10 (n=10) | 7/10 | 10/10 |
| **command-move-file** | front-loaded | **7/10 (n=10)** | 10/10 | 9/10 |
| command-move-directory | front-loaded | 8/10 (n=10) | 9/10 | 10/10 |
| command-move-symbol | front-loaded | 10/10 (n=10) | 10/10 | 10/10 |
| command-find-importers | front-loaded | 10/10 (n=10) | 10/10 | 10/10 |
| **command-find-references** | front-loaded | 10/10 (n=10) | **3/10 — alarms** | 10/10 |
| command-get-definition | front-loaded | 10/10 (n=10) | 9/10 | 10/10 |
| command-get-type-errors *(observational)* | front-loaded | 6/10 (n=10) | 10/10 — at ceiling | 10/10 — at ceiling |
| command-search-text | front-loaded | 9/10 (n=10) | 10/10 | 9/10 |
| command-delete-file | front-loaded | 10/10 (n=10) | 9/10 | 10/10 |
| command-replace-text | front-loaded | 10/10 (n=10) | 10/10 | 10/10 |
| two-step-search-then-rename | front-loaded (seeded) | 3/3 | 10/10 | 10/10 |
| **two-step-cat-then-extract** | front-loaded (seeded) | **3/6 — alarms** · 8/10 (n=10) | 10/10 | 10/10 |
| boundary-bash-search-non-ts-project | boundary | 3/3 clean | 10/10 clean | **0/10 — over-triggered** |
| boundary-bash-remove-console-log | boundary | 3/3 clean | 10/10 clean | **0/10 — over-triggered** |
| **Cases cleared** (of 27) | | **26** | **26** | **25** |

Boundary cases are judged all-clean, not on the rate floor, so their n=10 column is a materially harder bar than the n=3 it replaced. Haiku's 26 is the gate verdict at n=3; counting the widened `pressured-buried-rename` it is 25.

**Two cases sit at the floor, and n=3 resolves neither.** Widening both to n=10 inverted the gate's verdict on each:

- `two-step-cat-then-extract` alarmed at 3/6 but measures **8/10** widened (pooled 11/16 ≈ 0.69, just above the floor). The alarm was substantially bad luck, not a clean red. It also matches the rubric's *canary-specific* pattern (Haiku marginal, Gemini 3/3), so it is low-urgency rather than an audience risk.
- `pressured-buried-rename` **cleared at 2/3 while truly sitting at 5/10** — a false clear, and the more serious of the two. Its failures are `no attempt`: the model loads the skill, explores with `grep`/`search-text`, and never converges inside the 6-step budget.

`pressured-buried-rename` is tracked in [`handoff.md`](handoff.md); `two-step-cat-then-extract` is not — at a pooled 0.69 with Gemini and Luna both **10/10 widened**, it needs watching on the next sweep, not a work item. The practical rule this run established: **treat any 2/3 or 3/6 as unresolved and widen it before drawing a conclusion** — in either direction. A case at the floor is one draw from either verdict.

**A clean n=3 pass repeatedly failed to survive widening.** On Haiku, `command-move-directory` went 3/3 → **8/10**, `command-move-file` 3/3 → **7/10**, `command-search-text` 3/3 → **9/10**. On Gemini the same thing happened harder: `command-find-references` 2/3 → **3/10** (a red the n=3 draw missed entirely), `command-rename` 3/3 → **7/10**, `pressured-buried-find-references` 3/3 → **8/10** — while `trigger-search-and-replace-sed-tempting` went the other way, 2/3 → **10/10**. Errors ran in both directions on both models.

**Gemini's red is an instrument artifact, not a skill defect.** In `command-find-references` all ten trials open with a hallucinated *native* call — `find_references({"file":…,"line":5,"col":17})` — with correct arguments every time. The harness feeds the "no such tool" error back, and Gemini converts to `weaver find-references` in only 3 of 10; the rest abandon or fall back to `grep`, several stating outright that they cannot reach weaver while holding the bash tool that would run it. The same reflex drives `command-rename` (8 of 10 trials open natively, 5 recover) and appears in 24 of 250 op-case trials overall, almost entirely on the front-loaded exposure. It is the same behaviour as the 2026-07-25 zero-rate correction below; the trail and the error feedback now make it visible instead of silent. What it measures is recovery from a bad tool guess, which the skill body can plausibly influence — see the PATH item in [`handoff.md`](handoff.md).

Two consequences for how the cross-model columns get read. **Haiku is not conservative relative to the audience** — it is 10/10 on the case Gemini fails 3/10, so a green gate does not imply a green audience. And **Luna's boundary failures are settled**: 0/10 on both, not the 0/3 that could have been a draw.

The remaining 14 cases carry an n=3 draw on Haiku only: the nine `trigger-*`, `pressured-buried-replace-text-passive`, `pressured-buried-find-references`, `two-step-search-then-rename`, and both boundary cases. Treat those rates as unresolved, not as ceilings.

## How to record a run

```bash
WEAVER_EVAL_MODEL=anthropic/claude-haiku-4.5 pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
# cross-family sweep
WEAVER_EVAL_MODEL=google/gemini-2.5-flash pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
```

Per-case rates are the ground truth — any aggregate derives from them, so record these even if a summary metric changes. For a **cross-model** run, record the four-tier outcome composition of any non-ceiling case, not just the rate: it separates a body weaver can fix (`content-fail`) from host-exposure noise it cannot (`warned-pass`). Update the table above in place and add a dated entry below.

---

## Run history

### 2026-08-07 — front-loaded `command-*` re-baseline at n=10 (Haiku)

The seven `command-*` cases that had never been widened, run at `WEAVER_EVAL_TRIALS=10`. $0.8385, all seven cleared the floor.

| Case | Recorded (n=3) | Widened (n=10) |
|---|---|---|
| `command-rename` | 3/3 | 10/10 |
| **`command-move-file`** | 3/3 | **7/10** |
| `command-find-importers` | 3/3 | 10/10 |
| `command-find-references` | 3/3 | 10/10 |
| `command-get-definition` | 3/3 | 10/10 |
| `command-search-text` | 3/3 | 9/10 |
| `command-delete-file` | 3/3 | 10/10 |

`command-move-file` clears at 7/10 but sits one trial above the floor, and its three misses share an identical signature: `mkdir -p … && mv …`, then a closing message that *names `weaver move-file` as the tool that should have been used* and explains that `mv` leaves broken imports. The model has the content and the correct conclusion — it emits the shell call first and reasons about it afterwards. This is not a skill-body gap, so rewriting the body is the wrong lever; tracked in [`handoff.md`](handoff.md).

`command-search-text`'s single miss is a grep-exploration loop that burns the 3-step budget without converging. The reflex is visible in the passes too — 5 of 9 matched at step 2, after a `grep -rn` first call. It recovers inside the budget, so the case holds.

### 2026-08-07 — full n=10 sweeps, Gemini 2.5 Flash and GPT-5.6-Luna

All 27 cases at n=10 on both cross-family models, so their columns are no longer n=3 draws. **Gemini $0.2741 (26/27), Luna $0.0667 (25/27).** Both an order of magnitude cheaper per trial than Haiku's $0.012, which is what makes a full widening affordable on them and not on the gate.

Gemini's `command-find-references` fell to **3/10** — a red that the recorded 2/3 had entirely concealed. Mechanism above; it is the native-tool-call reflex, not a body defect, and it makes Haiku the *permissive* model on that case rather than the conservative one.

Luna reproduces its boundary over-triggering at **0/10 on both cases**, confirming a systematic property rather than a draw, and otherwise sits at ceiling: 23 of 25 op cases at 10/10, with `command-move-file` and `command-search-text` at 9/10.

The two cases this sweep was commissioned to settle both came back clean on the other families — `command-move-file` 10/10 Gemini / 9/10 Luna against Haiku's 7/10, and `two-step-cat-then-extract` 10/10 on both. Both Haiku findings are therefore canary-specific, and their low-urgency routing holds.

### 2026-08-01 — GPT-5.6-Luna sweep

25/27 cleared, $0.0317. Clears every op case 3/3, including both cases Haiku sits at the floor on (`pressured-buried-rename`, `two-step-cat-then-extract`). Fails both boundary cases 0/3: on a task with no refactoring or search intent, it calls `weaver search-text` anyway (skill loaded, tool invoked) where the correct behaviour is to stay in plain bash/grep — the only model of the three tested so far that over-triggers rather than under-triggers.

### 2026-08-01 — Gemini 2.5 Flash sweep

27/27 cleared, $0.1653. Notable divergences from Haiku — clears `two-step-cat-then-extract` 3/3 and `pressured-buried-rename` 3/3 (Haiku's two floor cases), but marginal on `trigger-search-and-replace-sed-tempting` (2/3, one no-attempt with raw `sed`) and `command-find-references` (2/3, one no-attempt after hallucinating a native tool call). No case is red on Gemini and green on Haiku, so no inverted-canary alarm.

### 2026-07-26 — first run under the unified sampled rate gate

The baseline above. This run is also the real-path verification of the gate itself: escalation fired for the first time (`two-step-cat-then-extract` went below the floor at n=3, escalated to 6, alarmed at 3/6), observational reporting printed a non-gating rate, and `finish_reason` plus full bash command strings appeared in every trail.

Two standing `[needs investigation]` entries were resolved or corrected by measurement:

- **`replace-text` reaching for `sed` at rate — not reproduced.** The 2026-07-24 record had it at 2/5 with `find … -exec sed -i`. Re-measured at **10/10 with zero `sed`**, meeting the n≥10 bar that entry itself set. Neither obvious confounder explains the gap: the new condition omits `temperature` entirely (so the provider default, *higher* than the old forced 0.7), and every one of the 10 matched on the **first** call, so the wider step budget is not rescuing it. The likeliest reading is that n=5 was thin — which the entry anticipated. Entry removed.
- **`two-step-cat-then-extract` fails by a different mechanism than recorded.** The 2026-07-23 entry describes the model staging extract-function *JSON args* to a temp file. Observed here instead: it rewrites the **source file** with a heredoc (`cat > …/auth.ts << 'EOF'`), performing the extraction by hand, in 2 of 6 trials; a third trial emitted no tool call at all. The entry's mechanism description needs correcting; root cause remains unconfirmed.

The heredoc rewrite also validates the gate's destructive-scope decision: truncating a source file is destructive, the hard-fail rule deliberately does not cover raw shell, and the sampled rate caught it anyway.

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
