# Eval Baselines

**Purpose:** The current per-case baseline for the sampled rate gate, plus the dated run history behind it. What the eval measures and how to read a run: [`eval-design.md`](eval-design.md). How to run it: [`../eval/README.md`](../eval/README.md).
**Audience:** Anyone comparing a new run against history, or evaluating a model as an instrument.
**Status:** Current

---

## Current baseline

Updated **in place** — this table is the reference a new run is read against. Move superseded numbers into the run history below rather than growing columns here.

Conditions: sampled rate gate (`pnpm eval:gate`), 2/3 floor, temperature omitted (model default sampling), pressured (clutter + per-case momentum), fixture-backed, via OpenRouter. **All three models gate** — a skill edit must clear Haiku at n=3, Gemini at n=10 and Luna at n=10. Anything short of a clean sweep escalates to 6 where there is headroom. Cells marked **D** are demoted for that model (measured and printed, never gating); the per-model cap is 2.

| Case | Exposure | Haiku 4.5 (n=3) | Gemini 2.5 Flash (n=10) | GPT-5.6-Luna (n=10) |
|---|---|---|---|---|
| trigger-refactor-rename | progressive | 3/3 | 10/10 | 10/10 |
| trigger-refactor-rename-no-coords-sed-tempting | progressive | 3/3 | 10/10 | 8/10 |
| trigger-refactor-move-file | progressive | 3/3 | 10/10 | 10/10 |
| trigger-search-and-replace-pattern | progressive | 3/3 | 10/10 | 10/10 |
| trigger-search-and-replace-todos-grep-tempting | progressive | 3/3 | 10/10 | 10/10 |
| trigger-search-and-replace-sed-tempting | progressive | 3/3 | 10/10 | 10/10 |
| trigger-code-inspection-find-references | progressive | 3/3 | 10/10 | 10/10 |
| trigger-code-inspection-find-references-delete-intent | progressive | 3/3 | 10/10 | 10/10 |
| trigger-code-inspection-get-type-errors | progressive | 3/3 | 10/10 | 10/10 |
| **pressured-buried-rename** | progressive (3-turn) | **5/6 — D** | 10/10 | **6/10, 7/10 re-run** |
| pressured-buried-replace-text-passive | progressive (3-turn) | 3/3 | 10/10 | 10/10 |
| pressured-buried-find-references | progressive (3-turn) | 3/3 | 9/10 | 10/10 |
| command-rename | front-loaded | 3/3 | 10/10 | 10/10 |
| command-move-file | front-loaded | 5/6 | 10/10 | 10/10 |
| command-move-directory | front-loaded | 4/6 | 10/10 | 10/10 |
| command-move-symbol | front-loaded | 3/3 | 9/10 | 10/10 |
| command-find-importers | front-loaded | 3/3 | 10/10 | 10/10 |
| command-find-references | front-loaded | 3/3 | 10/10 | 10/10 |
| command-get-definition | front-loaded | 3/3 | 10/10 | 10/10 |
| command-get-type-errors | front-loaded | 3/3 — D | 10/10 | 10/10 |
| command-search-text | front-loaded | 3/3 | 10/10 | 10/10 |
| command-delete-file | front-loaded | 3/3 | 10/10 | 10/10 |
| command-replace-text | front-loaded | 3/3 | 10/10 | 10/10 |
| two-step-search-then-rename | front-loaded (seeded) | 3/3 | 10/10 | 10/10 |
| two-step-cat-then-extract | front-loaded (seeded) | 3/3 | 10/10 | 10/10 |
| boundary-bash-search-non-ts-project | boundary | 3/3 clean | 10/10 clean | **0/10 — D** |
| boundary-bash-remove-console-log | boundary | 3/3 clean | 10/10 clean | **0/10 — D** |
| **Cases cleared** (of 27) | | **27** | **27** | **27** |
| **Demoted** (cap 2) | | 2 | 0 | 2 |

**D** = demoted for that model: measured and printed, never gating. Boundary cases are judged all-clean, not on the rate floor, so an n=10 column is a materially harder bar than an n=3 one. Luna's boundary failures are settled at 0/10 on both, not a 0/3 draw. Haiku's n=3 cells that read `x/6` escalated under the "escalate unless clean" rule.

**`pressured-buried-rename` is the case to watch, and it is now marginal on two models.** Demoted on Haiku (5/6 here, 6/10 recorded at demotion), and on Luna it drew 6/10 then 7/10 — straddling the floor, with the pooled 13/20 below it. Its failures are unchanged in shape: the model calls `weaver search-text`, gets the answer, then re-confirms it with `grep`/`cat` and never converts inside the 6-step budget, against an explicit `weaver-refactor` instruction not to. It is deliberately **not** demoted for Luna — Luna is already at the cap of 2, and the invariant refusing a third is the signal to fix or delete the case rather than widen the exemption. Tracked in [`handoff.md`](handoff.md).

**A clean n=3 pass repeatedly failed to survive widening.** On Haiku, `command-move-directory` went 3/3 → **8/10**, `command-move-file` 3/3 → **7/10**, `command-search-text` 3/3 → **9/10**. On Gemini the same thing happened harder: `command-find-references` 2/3 → **3/10** (a red the n=3 draw missed entirely), `command-rename` 3/3 → **7/10**, `pressured-buried-find-references` 3/3 → **8/10** — while `trigger-search-and-replace-sed-tempting` went the other way, 2/3 → **10/10**. Errors ran in both directions on both models. The practical rule: **treat any 2/3 or 3/6 as unresolved and widen it before drawing a conclusion**, in either direction.

**A single model's green does not imply a green audience, and this is measured rather than argued.** Haiku held 10/10 on `command-find-references` while Gemini failed the same case 3/10 — the best-evidenced skill defect the project has found, invisible to a Haiku-only gate by construction. No trial count on a model that does not exhibit a failure will surface it. This is why all three models now gate.

**Cost, measured 2026-08-08 on a full roster run:** **$2.03** total — per trial, Haiku **$0.0160**, Gemini **$0.0020**, Luna **$0.00027**. Haiku and Gemini are both up on the $0.0109 / $0.0012 recorded a day earlier while Luna held exactly; no cause isolated. The gate model remains ~8× Gemini and ~60× Luna, so a full Gemini sweep at n=10 still costs less than Haiku at n=3. Failing trials run ~3× the cost of passing ones, because an abandonment burns the whole step budget and a step-1 match does not.

## How to record a run

```bash
# the whole roster — what a skill edit must clear
pass-cli run --env-file .env -- pnpm eval:gate
# one model, e.g. to widen a single case
WEAVER_EVAL_MODEL=google/gemini-2.5-flash WEAVER_EVAL_TRIALS=10 \
  pass-cli run --env-file .env -- pnpm eval --disable-console-intercept -t <case-regex>
```

Per-case rates are the ground truth — any aggregate derives from them, so record these even if a summary metric changes. For a **cross-model** run, record the four-tier outcome composition of any non-ceiling case, not just the rate: it separates a body weaver can fix (`content-fail`) from host-exposure noise it cannot (`warned-pass`). Update the table above in place and add a dated entry below.

---

## Run history

### 2026-08-11 — spike: does the lane see a generic search win over a symbol lookup?

Commissioned by the handoff entry on symbol-specific routing, after a live `/slice` session where an agent asked for a symbol's callers reached for a generic grep-based subagent instead of `find-references`. Six throwaway cases against the shipped `find-references` target, three asks × two arms — plain (today's lane) and *delegation* (the host's agent roster in the system prompt plus a callable `Task` tool returning a competent grep-shaped prose summary). **$1.4896** — Haiku $1.2219 (60 trials over three runs), Gemini $0.2493 (60), Luna $0.0184 (60).

| Ask | Arm | Haiku | Gemini | Luna |
|---|---|---|---|---|
| plain ("Where is `authenticate` used?", coords given) | plain | 10/10 | 10/10 | 10/10 |
| exploration-framed, coords given | plain | 10/10 | 10/10 | 10/10 |
| **exploration-framed, no coords** | plain | 10/10 | **1/10** | 10/10 |
| plain | delegation | 10/10 | 10/10 | 10/10 |
| exploration-framed, coords given | delegation | 10/10 | 10/10 | 10/10 |
| **exploration-framed, no coords** | delegation | 9/10 | **0/10** | 10/10 |

**Exploration framing is a null; the missing coordinates are the driver.** Rewording a symbol question as broad codebase exploration moved nothing on any model at any arm. Removing the coordinates dropped Gemini from 10/10 to 1/10 against its own comparator, holding phrasing and model fixed.

**Delegation is an amplifier that only bites once coordinates are gone, and only on Gemini.** `Task` call counts: Gemini 16, Haiku 0, Luna 0. With coordinates present the roster changed nothing (10/10 both arms, every model). Without them Gemini's failure mode switched from grep-fallback to delegate-and-stop — 8 of 10 trials called `Task` on turn one, never loaded the skill (`never-reached 8`), accepted the summary and answered. The summary omits an aliased re-export by construction, which is the real artifact's real failure mode. The 1/10 → 0/10 rate delta is not established (both arms red, tiny n on the difference); the mechanism switch from 0 to 16 delegation calls is.

**Mechanism.** Missing coordinates reframe a symbol question as an exploration task, and the skill body offers no way back: it documents only the `line`/`col` form and never says how to obtain a position. Gemini's misses split between answering from `Glob`/`Read`/`grep` without reaching weaver, and inventing a symbol-name API — `weaver find-references '{"file": "…", "symbol": "authenticate"}'`, and the same shape on `get-definition`.

**A `keyArgs` set that omits the args under test lets an invented API false-pass.** One Gemini trial scored `matched` on the `symbol`-argument form above, because the case asserted only `file`. Any durable version of this case must assert `line`/`col` — which first requires the lane's generic `Read` result to become a coherent multi-line file, since it returns a single line today and "line 1" is the correct read of what the model was shown. The Haiku and Luna passes on the no-coords asks are partly that artifact.

**`trigger-code-inspection-find-references` widened 3/3 → 10/10 on Haiku**, one of the few clean n=3 results that has survived widening.

### 2026-08-08 — first full roster run under `pnpm eval:gate`

The gate now requires Haiku (n=3), Gemini 2.5 Flash (n=10) and GPT-5.6-Luna (n=10) to clear. **$2.03** for 580 trials — Haiku $1.4380 (90), Gemini $0.5365 (270), Luna $0.0591 (220).

**Haiku PASS, Gemini PASS, Luna FAIL on the first invocation** — but six of Luna's seven failures were `Test timed out in 900000ms`, not rate failures. Re-run alone at n=10 all six came back **10/10** (`command-get-definition`, `command-delete-file`, `command-get-type-errors`, `command-search-text`, `command-replace-text`, `two-step-cat-then-extract`), confirming provider stall rather than signal, exactly as *Reading a red* step 1 anticipates.

The seventh, `pressured-buried-rename`, is a genuine marginal on Luna: **6/10** on the first run, **7/10** on the re-run. 7/10 clears the floor and 6/10 does not, so the case sits on the boundary — pooled **13/20 is below the floor**. Combined with Haiku's demoted 6/10, this case is now marginal on two of three models, which sharpens rather than resolves its `[needs investigation]` entry. It is *not* demoted for Luna: Luna already carries two demotions (both boundary cases) and the per-model cap of 2 refuses a third. That refusal is the invariant working — the answer is to fix or delete the case, not to widen the exemption.

Three cases escalated on Haiku under the new "escalate unless clean" rule — `pressured-buried-rename` 5/6, `command-move-file` 5/6, `command-move-directory` 4/6 — with 22 cases clean at 3/3.

**Per-trial cost has drifted up on two of three models.** Haiku measured **$0.0160** against the $0.0109 recorded a day earlier, Gemini **$0.0020** against $0.0012, while Luna held exactly at $0.00027. The escalation rule biases toward failing trials, which cost more, but that does not account for the whole gap and no cause has been isolated. Price a run from a measured total, not a carried-forward per-trial figure.

### 2026-08-07 — `## Running weaver` section added to the skill bodies

Nine paid runs, ~1,000 trials, **$2.14** total. Full method and negative results: [spike](specs/archive/20260807-weaver-is-a-shell-command-framing.md).

Telling the model that weaver is an installed npm package run from the shell moved four cases and broke none:

| Case | Model | Before | After |
|---|---|---|---|
| `command-find-references` | Gemini | 3/10 | **30/30** |
| `command-rename` | Gemini | 7/10 | **30/30** |
| `command-get-type-errors` | Haiku | 6/10 | **20/20** |
| `command-move-file` | Haiku | 7/10 | **18/20** |

The failure shape disappeared rather than thinning: the hallucinated native `find_references({…})` opener fired in 8 of 10 baseline trials and **0 of 30** after, with every post-change trial matching at step 1. Rewording the paragraph from a PATH conditional to a positive statement changed nothing, so the fact carries it, not the phrasing.

Two things the spike ruled out. **Raw frontmatter in the front-loaded prompt is not the cause** — stripping it gave byte-identical rates on both target cases, killing the leading pre-measurement theory. And **PATH doubt was never observed**: across 40 baseline trials no model questioned whether the binary was installed, only whether the capability existed.

Full sweeps under the new text: **Gemini 27/27** (a single `boundary-bash-remove-console-log` over-trigger on the first sample, 10/10 clean on recheck), **Luna 25/27** (both failures the pre-existing 0/10 boundaries). Haiku's seven ceiling `command-*` cases held 10/10; its remaining cells are unmeasured and carry **†** above.

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
