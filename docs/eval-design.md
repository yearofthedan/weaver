# CLI Eval Design

**Purpose:** What the skill-file eval measures, the principles that make a run readable, and the mechanics underneath. To run it, see [`eval/README.md`](../eval/README.md); for recorded rates, [`eval-baselines.md`](eval-baselines.md).
**Audience:** Anyone who edits the skills the eval guards, changes the harness, or interprets a run.
**Status:** Current

---

## What this measures

The object under test is the **shipped skill files** (`.claude/skills/*/SKILL.md` — frontmatter description plus body). The question is: given these files, does a coding agent reach weaver at all, and does it emit the correct `weaver` command with the right arguments — instead of grep, sed, `npx tsc`, or a hand-rolled edit?

Agents reach weaver exclusively through bash (`weaver <command> '<json>'`), discovered via the skill files. Skill content is read from `.claude/skills/` at run time, so the eval can never drift from what ships.

One lane gates: `eval/cases/gate.llm.test.ts`, run by `pnpm eval`. Every case runs through the same sampled agentic loop and differs only by **condition** — the per-case fields in `eval/cases/cases.ts`.

---

# Measurement principles

Read this section before interpreting any run. The mechanics below are subordinate to it.

## Rates, not single runs

A single trial is a coin flip you watched once. The gate samples every case (default n=3) and judges the **rate**, because every question worth asking — did this skill edit help? is this case fragile? — is a question about a distribution, not about one path.

This replaced an earlier temperature-0 design, and the reason is worth keeping: greedy decoding measures one fixed path chosen token-by-token, which is not the model's most likely *response*. It produced false clears and false alarms in the same lane — one case gated green at a true 2/5 while another gated red at 3/5. **A temp-0 verdict is a fingerprint, not a rate.**

## What the gate actually measures

The pass condition is deliberately **lenient on selection** and **strict on destruction**:

- **Selection** is judged pass@k-style: the case clears if the model reaches the right command with correct args in *enough* trials (the 2/3 floor). It is explicitly **not** pass^k — the gate does not claim the skill works every time.
- **Destruction** is judged absolutely: a single trial that reaches a *different mutating* weaver op fails the case regardless of its rate.

So **green means "the skill steers well enough, often enough" — not "reliable every run."** Do not quote a green gate as a reliability claim. The asymmetry is deliberate: a soft miss (used grep instead of search-text) costs the user a worse answer, while a destructive miss costs them their working tree, and those must never average together on a majority vote.

Scope note on the destructive rule: it fires on a wrong *weaver* mutating op, not on raw destructive shell (`sed -i`, `rm`, a truncating heredoc). That is a considered limit, not an oversight. An on-task-but-unsafe shell edit is a *steering* failure, which is exactly what the sampled rate already measures; and gratuitous destruction is a model-safety property no skill edit can move, so gating on it would make the lane permanently red for reasons weaver cannot fix. The trail prints every bash command in full, so such behaviour stays visible without being gated. (Borne out on 2026-07-26: `two-step-cat-then-extract` rewrote a source file with a heredoc in 2 of 6 trials and the rate gate caught it at 3/6 anyway.)

## Gate on pressure, and only on pressure

Every gated run is **pressured**: a cluttered host system prompt plus a habit-momentum seed of true-shell work. An unpressured "clean" condition is available as a diagnostic but never gates.

The reason is empirical: clean lanes never fired. The retired clean command lane passed 11/11 on four different models across its whole life. A condition that has never once changed a decision does not earn standing cost on a paid run.

## Instrument vs audience

**No single model is the audience.** Haiku earns a gate slot because it exhibits the shell reflexes the skills exist to displace (`tsc` for type errors, `sed` for bulk replace, `mv` for moves), and an instrument that never shows the defect cannot measure whether you fixed it. But a weakest-model canary only works if models are ordered by weakness, and they are not. Haiku held 10/10 on `command-find-references` while Gemini failed the same case 3/10 — the best-evidenced skill defect the project has found, invisible to the gate by construction. No trial count on a model that does not exhibit a failure will surface it.

**Saturation is a property of a model × defect-class × text-version, not of a model.** Gemini reads as "too strong to discriminate" today because it sits at ceiling on the current skill text — but it was 3/10 on that same text's predecessor, and went to 30/30 once the defect was fixed. A model at ceiling becomes discriminating the moment a defect lands in its family, and you cannot know in advance which family a future edit's defect will land in. That is what the roster buys: not three complementary detectors today, but coverage of a failure class you cannot predict, at a price where breadth is cheaper than depth.

| Model | Base trials | Role |
|---|---|---|
| Haiku 4.5 | 3 | Shell-reflex canary — the only model still showing gradients on the current text |
| Gemini 2.5 Flash | 10 | Cross-family breadth; has shown the native-tool-call reflex Haiku never exhibits |
| GPT-5.6-Luna | 10 | Cross-family breadth; the only model that *over*-triggers rather than under-triggers |
| Sonnet | — | Audience-confidence run (env swap, ~$5–8), occasionally before a release |

All three roster models must clear before a skill edit ships — `pnpm eval:gate` runs them in sequence. Depth is set per model by cost: a full Gemini sweep at n=10 costs $0.32 and Luna $0.07 against $0.88 for Haiku at n=3, so the cheap models run at a depth the gate model cannot afford. The roster lives in `eval/harness/config.ts` and is the only place the model list is written.

**A case that is a known red on one model is demoted for that model, not for all.** An `observational` marker names the models it applies to, so a case can gate on Gemini while being measured-but-not-gated on Haiku. Without this a permanently-red case on any one model makes the whole gate unusable. Pointing the harness at a single model is still an env swap; nothing in the cases or assertions is model-specific.

## Cross-model confidence rubric

When a case disagrees across models, the *pattern* of disagreement says what to do:

| Pattern | Reading | Action |
|---|---|---|
| Haiku ✓ + Sonnet ✓ + Gemini ✓ | Strongest confidence available | Ship |
| Haiku ✗ + Sonnet ✓ | Canary-specific weakness — the audience is fine | Observational candidate; low urgency |
| **Haiku ✓ + Sonnet ✗** | **Inverted canary — the gate is blind to a real audience failure** | **Most alarming; investigate immediately** |
| Gemini ✗ only | Usually host-exposure or family quirk | Attribute via outcome tiers before touching skill text |

The inverted case is the dangerous one precisely because the gate is green: the instrument says fine while the audience fails.

## Reading a red

A red is a *finding*, not automatically a regression. Work this order and stop when it explains the failure:

1. **Timeout or stall?** Check for `Test timed out in …` rather than a rate failure. A slow provider or a sleeping host fails the lane on exit code with clean completed trials. Re-run; not signal.
2. **Escalate, then widen.** The gate escalates any case short of a clean sweep from 3 to 6 trials automatically, so a borderline *pass* is widened for you. If the result is still ambiguous — 3/6 tells you almost nothing, the true rate could be 0.2 or 0.8 — re-run *that case alone* at `WEAVER_EVAL_TRIALS=10` or more. Do this before theorising about causes; a real rate estimate is cheap and most theories die on contact with it.

   **A clean 3/3 is a draw, not a ceiling.** At n=3, a case whose true rate is 0.7 passes cleanly about a third of the time, so a perfect score carries far less information than it reads as. Measured, not theorised: of the eleven front-loaded `command-*` cases, three recorded a clean 3/3 that did not survive widening to n=10 (8/10, 7/10, 9/10). Quote a rate as established only at the n it was measured at, and do not treat an un-widened case as a held one — including when comparing before/after a skill edit, where a 3/3-to-3/3 pair says almost nothing.
3. **Replay one path.** `WEAVER_EVAL_TEMPERATURE=0` pins greedy decoding so a single trajectory is reproducible while you read it.
4. **Isolate pressure from content.** `WEAVER_EVAL_CLEAN=1` drops clutter and momentum. Red under pressure but green clean = the body loses under pressure. Red in both = the body itself is broken.
5. **Classify the mechanism via the outcome tiers** (below) — `never-reached` is a description problem, `content-fail` is a body problem. Read the trail, not just the rate.
6. **Cross-model** if still ambiguous, then apply the rubric above.

Mechanism-specific tells: *never-reached* → the frontmatter description lost the trigger (quote the losing task phrasing into it); *loaded-but-didn't-convert* → the body lacks an "Instead of: `<shell command>`" contrast for the habit it displaces; *prose-stall* (`abandonedText` shows the giving-up turn) → body length or framing; *oracle-loop* (repeated calls to the skill itself with query args) → the skill name reads like an endpoint.

**YAML trap:** a `description:` starting with `"` is truncated by real hosts' frontmatter parsers. The harness's regex parser masks this — start descriptions with a plain word.

## Paired A/B reading

When comparing skill-text variants, read **per-case paired deltas on the same cases**, never two absolute rates side by side. A whole-lane score moving from 25/27 to 26/27 is noise at n=3; the same cases flipping in a consistent direction is signal. Before attributing a red to a text edit, A/B against the unedited text (`git stash`) rather than reasoning about it.

**Compute the statistic before recording a cause.** A/B rates at these sample sizes are far weaker than they look: 5/10 against 8/10 — a difference that reads as obvious — is two-tailed Fisher p = 0.35, indistinguishable from chance. Separating a true 0.5 from a true 0.8 at p<0.05 needs roughly n=40 per arm. An underpowered A/B is evidence for a *theory*, never a confirmed driver, and must be written down as one.

**Before spending on a powered run, ask whether any outcome changes what you do.** An investigation whose every result leads to the same action is curiosity, not signal — and each one costs a real run.

## Case realism, not instrument tuning

**Every case must be a task a real user would plausibly ask.** Before adding, removing, or rewording one, ask: *is this reasonable to ask?* That is the line between a legitimate clarity fix and tuning the instrument to pass — a phrasing kept or cut for any reason other than realism is gaming, however much the rate moves.

The same rule binds skill edits. **Hardening a body must generalize, not encode the case:** new wording, and especially examples, may never echo a failing case's own target (its filename, its pattern, its symbol). An example mirroring the case teaches pattern-matching on that one task; a green run then proves nothing. If generic strengthening does not move the gate model, the honest conclusion may be that wording alone cannot hold that case — not a licence to encode it.

## Paid-run discipline

Runs cost real money. A full `pnpm eval:gate` across the roster measured **$2.03** on 2026-08-08 — Haiku $1.44 (90 trials), Gemini $0.54 (270), Luna $0.06 (220). Escalation bounds the worst case per case rather than per run. Failing trials run ~3× the cost of passing ones, so a red suite is dearer than a green one.

**Price a run from a measured total, never from a per-trial figure carried forward.** Per-trial cost drifts — it moved ~50% on two of three models inside a day, enough to under-project a full run by 60%. Per-trial history is in [`eval-baselines.md`](eval-baselines.md).

- **Scope the run to the question.** `-t <regex>` for a case subset, `WEAVER_EVAL_TRIALS` for depth.
- **Never waste a run.** Always pass `--disable-console-intercept`, or vitest swallows the per-case rate and trail output on *passing* tests and a green run prints nothing.
- **A harness change is proven on a real model.** The `test:eval` lane and eval mutation prove the logic in isolation; they cannot prove a grading change behaves correctly against a live model. Drive it on `pnpm eval` before calling it done.
- **A dropped assertion costs an observation, not a thought bubble.** "This might be fragile" is a hypothesis you test by running, not a licence to delete.

---

# Mechanics

## Architecture

Plain vitest + `fetch` against an OpenAI-compatible hosted endpoint. No eval framework.

```
eval/cases/cases.ts            ← the conditioned case table (discriminated union; see Exposures)
eval/cases/gate.llm.test.ts    ← the one gate lane; `pnpm eval` only (vitest.llm.config.ts)
eval/cases/coverage.test.ts    ← invariant: every operation has a case + fixture (runs in pnpm check)
eval/harness/case-lane.ts      ← buildTrialConfig: per-exposure messages, tools, predicates, budget
eval/harness/run-case.ts       ← runTrial + runCaseTrials (sampling and escalation)
eval/harness/verdict.ts        ← the 2/3 floor, escalation, alarm, observational ceiling
eval/harness/agentic-loop.ts   ← runAgenticLoop + canned-result resolution
eval/harness/assertions.ts     ← matchWeaverCommand + matchesExpectedCommand (the args gate)
eval/harness/grade.ts          ← SUBCOMMAND_MUTABILITY + isMutatingCompetitor (hard-fail verdict)
eval/harness/outcome.ts        ← four-tier trial classification (reporting)
eval/harness/seed.ts           ← momentum pre-steps + two-step scripted exchange
eval/harness/command-prompt.ts ← the front-loaded prompt (skill bodies in the user turn)
eval/fixtures/                 ← canned tool stdout, embedded as tool results
```

**Lane separation is a hard constraint.** `pnpm check` runs the harness unit tests, the case invariants, and `typecheck:eval` — and never needs a model server. The live lane runs only under `pnpm eval`.

`eval/` *is* typechecked by `pnpm check` via `tsconfig.eval.json` (`pnpm typecheck:eval`), including the `.llm.test.ts` lane file, so a type error in lane wiring surfaces before you spend on a run. It is not *executed* there.

## Exposures

Every case declares an `exposure`, which selects its whole condition. The case table is a discriminated union, so a field a variant never reads is a compile error.

| | progressive | front-loaded | boundary |
|---|---|---|---|
| Skill delivery | `<available_skills>` block; body loaded on demand | full bodies already in the user turn | as progressive |
| Tools | `Skill` + bash + Grep/Glob/Read | bash only | as progressive |
| Step budget | 6 | 3 | 6 |
| Passes when | reaches the right command with right args | same | never reaches a skill *or* any weaver op |

- **Progressive** models the real discovery path: only the one-line description is in context when the model decides whether to load the skill. If the description loses against shell habit, the body may as well not exist. A skill load feeds back the real SKILL.md and is tracked without entering the trail — it is navigation toward the operation, not the operation.
- **Front-loaded** assumes discovery succeeded and isolates emission: can the body produce a correct invocation, including arguments carried from a prior tool result? Budget 3 rather than 1 because a single call cannot distinguish a *convention stumble* (a hallucinated tool call, which any real host corrects with one error turn) from a genuine miss. An undeclared tool call gets the host-style "no such tool" error fed back and the trial continues — a stumble costs a turn, not the trial.
- **Boundary** cases invert the pass condition, guarding against an over-broad description stealing legitimate shell work. Clean = neither a skill load nor *any* weaver invocation across every trial. They are epistemically weak ("never triggers weaver" has unbounded scope) and cost paid trials, so keep them minimal: one earns a place only if a plausible description error would flip it — the task must sit on a description's decision boundary. A task no description could claim (list files, tail a log) can only fail by hallucination, buying no signal.

**Two-step** is a condition, not an exposure: a front-loaded case with a `seed` (a scripted step-1 assistant call plus its fixture result). Seeding the precursor is how a case handles a task the model won't do in one shot while keeping a single asserted follow-up. Two shapes exist — *result-derived carry-through* (search→rename, where the `line`/`col` exist only in the seeded result) and *read-then-act* (cat→extract, where the seed carries the read so the asserted call is the extract itself).

## The gate

Per case: run the model's base trial count (3 on Haiku, 10 on the cross-family models). **Anything short of a clean sweep escalates** to `ESCALATED_TRIALS` (6), whether or not it cleared the floor — a 2/3 escalates just as a 1/3 does. The floor itself is **inclusive** — exactly 2/3 clears — and compared as integers (`passed * 3 < total * 2`) so it is exact at any n. 4/6 is the same fraction as 2/3: **escalation buys resolution, not a higher bar.**

Escalating an unresolved pass is what the record demands, not caution: Gemini's `command-find-references` cleared as a recorded 2/3 and was truly 3/10 when widened. A case already at or past 6 trials has no headroom and does not escalate, so the cross-family models at n=10 are unaffected. Zero trials counts as below the floor, so a harness fault that runs nothing alarms rather than passing silently.

A trial passes only on `matchWeaverCommand` outcome `correct` — the right subcommand *and* every declared key arg. Reaching the right op with wrong args is not a pass.

**Path key args match by trailing segment, not exact string.** A model legitimately `cd`s into the workspace and passes a relative path; `cd /ws && weaver move-directory '{"oldPath":"src/utils"}'` targets the same directory as the absolute form. Path-typed keys (`oldPath`, `newPath`, `file`, `sourceFile`, `destFile`) accept a trailing-segment suffix; a different directory still fails. Non-path keys stay exact — `replacement` can contain `/`, so suffix-matching it would be wrong.

**Hard fail.** A *different mutating* weaver op stops the trial immediately (`failedAtStep`, printed `competitor@<step>`) and alarms the case regardless of rate — including on observational cases, so the marker can never launder a destructive act. A read-only op or non-weaver call is a **precursor**, credited toward a later match. `&&`-chains are split before inspection.

**Observational cases.** A case may carry `observational: { since, reason, models }` to be measured and printed but not gated — on the models `models` names, and only those. An op case is exempted from the rate floor; a boundary case is exempted from the all-clean judgement. This exists for a case that tracks a real product gap we want visibility on rather than a bug to fix now, and it is what keeps one model's permanent red from making the whole roster unusable. It replaced an `it.fails` inversion, which cannot survive sampling — a case with a true rate near 0.6 would flap red on most runs.

Staleness is resisted by the dated `since`, load-time validation of the marker's shape, and an "at ceiling — consider promoting" line printed when a demoted case passes every trial. `models` is required and every id must be in the roster, so a typo fails the run at load rather than silently demoting nothing. **More than a couple of these on any one model is a design smell** — fix the skills or the case set, not the markers; an invariant test caps each model at 2.

## Outcome tiers: content vs exposure

Alongside the gating rate, each op case prints a four-tier composition, separating the signal weaver owns from host noise it does not:

- **`clean-pass`** — matched with no tool-style reach. Description and body both worked.
- **`warned-pass`** — matched, but the model called a skill *directly as a tool* rather than loading it. The body guided it; the host's exposure was noisy.
- **`content-fail`** — the body was in front of the model and did not guide it to the op. **This is the miss weaver owns.**
- **`never-reached`** — the model never read the skill. A description or shell-habit problem, not a body problem.

`clean-pass + warned-pass = matched`, so a warned pass still counts toward the gate; the composition is reporting-only. Read the tiers as counts plus trail evidence, not as gated conditional rates — the denominators are far too small at n=3. **Do not tune the harness's exposure per model family to move these** — past a point that measures scaffolding, not skills.

Two host-behaviour gotchas the lane absorbs: (1) models sometimes reach a skill as a direct tool call (`weaver-refactor({...})`, or the underscore-normalised `weaver_code_inspection` some providers emit). How a host exposes a skill is host integration, not skill content — so the harness feeds back the real body and flags the trial, measuring content regardless of phrasing. (2) Hosted models occasionally emit tool calls with malformed JSON arguments; the loop feeds back an invalid-arguments error rather than crashing.

## Scenario-owned results

The result fed back for a call is resolved per case. A case owns results for specific subcommands or tools via `cannedResults`. A `weaver <sub>` call the case does *not* own resolves to an inert stub ("No results for this call.") — never another operation's fixture, and never the generic bash file list.

`cannedResults` is therefore the *only* source of scenario content: a multi-hop case must own a coherent result for every on-path hop (a replace case that searches first owns `search-text`), or the neutral stub reads as "nothing to do" and strands the model. The inert default is deliberate — an unanticipated hop gets nothing to act on rather than another scenario's data that would derail it. A *declared* tool with no canned result throws, since that is real drift: the map falling behind the tool set.

**Standard tool exchange.** Completed turns are replayed as a real tool-use conversation — the model's own assistant message with its `tool_calls`, then a `tool`-role result for every call. The model is stateless, so this faithful history is what lets it advance across hops; a lossy echo strands multi-hop trajectories on their first call forever.

## Running and diagnosing

```bash
WEAVER_EVAL_MODEL=anthropic/claude-haiku-4.5 pass-cli run --env-file .env -- pnpm eval --disable-console-intercept
```

`WEAVER_EVAL_MODEL` must be set on the command line, never in `.env` — see [`eval/README.md`](../eval/README.md#setup) for why.

| Knob | Effect |
|---|---|
| `-t <regex>` | filter to a case subset (full case names in titles via `truncateThreshold: 0`) |
| `WEAVER_EVAL_TRIALS` | base trial count (default 3); escalation still targets 6 |
| `WEAVER_EVAL_TEMPERATURE` | **glass** — force a temperature; unset omits the field entirely |
| `WEAVER_EVAL_CLEAN=1` | **glass** — drop clutter and momentum |
| `WEAVER_EVAL_DEBUG=1` | dump the full turn-by-turn exchange |
| `WEAVER_EVAL_MODEL` | swap the model (cross-family sweep) |

Neither glass changes gating semantics; both are debugging modes.

**Temperature is omitted by default.** With `WEAVER_EVAL_TEMPERATURE` unset the request carries no `temperature` field at all, so the model samples at its own default — what a real caller gets. This also decouples the harness from temperature-accepting models: frontier Claude models reject the field, so a pinned temperature would 400 and made the harness unable to point at its own audience.

The trail prints every tool call with raw arguments and the response's `finish_reason`. Both matter: a name-only trail cannot distinguish "never ran weaver" from a matcher false-negative, and a missing `finish_reason` once hid a whole behaviour class — a model emitting the correct op as a hallucinated *native* tool call was reported as "(no bash call)".

## Working discipline

- **Run → observe → debug. Never predict-then-carve.** Write the assertion for the real flow, run it, watch what the model emits, debug from the result. Reading engine source to *fix an expected model output* is the anti-pattern tell. (Distinct from verifying the world the model acts in, below, which does require reading source.)
- **`keyArgs` must assert the arguments the case is about, or an invented API passes it.** A case declaring only `file` credits any call naming that file — including one whose other arguments do not exist in the schema, like a `symbol` key the CLI never accepted. The trial reads as a clean match while the model demonstrated exactly the defect under test. Assert the arguments that distinguish a real invocation from a plausible-looking hallucination, and check that the lane's canned results can actually carry them: a stub too thin to derive an argument from makes the wrong value the *correct* read of what the model was shown.
- **Fixtures are the scenario.** The eval never runs real commands, so a fixture that diverges from real CLI stdout tests a fiction — silently. Fidelity is to the *scenario*, not just the format: a result contradicting the task's stated scope (too few hits for a "whole project" ask) reads as incomplete and drives the model to re-verify in shell, confounding the trail. Worked example: the search→rename carry-through asserts `line: 12, col: 9`, correct only because `search-text` emits 1-based `col = m.index + 1` and `rename` consumes 1-based col. Had they disagreed, the red would have been a *product* bug, not fragility to design around.
- **A momentum seed primes a habit, not a substitution precedent.** Every seeded pre-step must be work weaver does **not** own — grep a log, `git log --grep`, `find` by name. It must never be a task a skill claims (`grep` of source → `search-text`, `mv` → `move-file`). A weaver-shaped pre-step manufactures the fallback instead of measuring the body's weakness. (Specific to momentum seeds; a two-step case's precursor deliberately *is* a weaver op — that is the point there.)
- **A pressured task carries no pre-step the harness cannot satisfy.** Context a task wants gathered first belongs in the momentum seed, where the harness authors a satisfying result — not in the live task string, where it runs against canned stubs and loops until the budget is gone. The rung then measures "can the model find a nonexistent file," not conversion under pressure. **An own-file inspect step is the exception with no home — remove it:** it cannot move to the seed (weaver-owned inspection is not a valid habit pre-step) and cannot be made satisfiable, since even a *coherent* read lets the model answer from the file and skip the mutating op. Keep the burial in framing and a trailing post-op ask.
- **An embedded secondary step gates the metric on that step, not the tool.** A task asking the model to report or inspect *before* acting can read low with sound skill text: the model does the sub-step, then stops or over-verifies until the budget is gone. Diagnose by removing *only* the suspected step and re-measuring. Removing a confounding step is a fair clarity fix; lifting a rate by rewording until the model complies is instrument tuning — the tell is a rate that moves only under a multi-change rewrite, not a single isolated removal.
- **Skill bodies share one context.** A front-loaded prompt concatenates all three bodies, so a case's hold depends on the *total* context, not just its own skill's section: removing one reinforcement line from `weaver-code-inspection` once tipped `search-text` (in a different skill) from held back to `grep`. After editing any `SKILL.md`, re-run the full lane, never just the case you aimed at.
- **Frontmatter feeds the front-loaded prompt too.** The whole SKILL.md including frontmatter goes into the prompt, so a description edit aimed at *discovery* also lands in every emission prompt — a trigger-routing fix can silently regress command args.

## What this predicts, and what it does not

**Predicts:**
- Relative movement — an edit that drops a case's rate is a regression; one that flips a red green confirms a fix.
- A robustness floor — text that steers the model that *has* the shell reflex is robust text.
- Body → command correctness, argument fidelity, over-triggering, and convergence under pressure.

**Does not predict:**
- Absolute trigger rates in **Claude Code, Cursor, or opencode**. The harness is one generic tool-calling host with synthetic clutter, not any real host's prompt or selection policy.
- Whether a specific host's selection policy picks weaver — vendor policies differ.
- Integration or file-state correctness — commands are asserted as strings, never executed. No daemon is involved.

**The gap that would close it** is a harnessed end-to-end lane: a real agent host running real commands against a live daemon with file-state assertions. Queued in [`handoff.md`](handoff.md); evaluate Anthropic's [`skill-creator`](https://github.com/anthropics/skills) first, which productizes much of this shape (with/without runs, output grading, description optimization) — and consider **opencode** as the host, since being open-source it can likely expose the tool-call trail directly, closing the observability gap Claude Code's headless mode has (file-state inference only).

**Harness reusability.** Weaver coupling is isolated to three points — `matchWeaverCommand` parses `weaver <sub>`, the competing tool set and canned results name the skills, and `context.ts` reads `.claude/skills/`. Re-targeting the harness at another tool is a swap of those, not a rebuild. The clutter prompt is deliberately weaver-free.

## Adding a new operation

The coverage invariant (`eval/cases/coverage.test.ts`, runs in `pnpm check`) fails until:

1. A front-loaded case for the operation exists in `eval/cases/cases.ts` (kebab-case subcommand, a task whose text determines the key arguments).
2. `eval/fixtures/<operationName>.json` exists (camelCase, matching `OPERATION_NAMES`) — model it on an existing fixture; it must look like real CLI stdout.

Progressive cases are not per-operation — add one only when a new *skill*, or a materially new task category, ships.
