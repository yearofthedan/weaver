# Unify eval lanes into one sampled rate gate

**type:** change
**date:** 2026-07-25
**tracks:** handoff.md # fold pressure into the agentic lane, retire the temp-0 gates → docs/eval-design.md

---

## Context

The three command-grading lanes gate on temperature-0 greedy decoding, which measures one fixed path, not the model's behaviour: measured on Haiku at 0.7/n=5, `command-replace-text` gates green at a true 2/5 and `command-get-type-errors` gates red at 3/5 — false clears and false alarms in the same lane. A 2026-07-25 raw-response probe also showed the single-shot emission lane structurally blind to a whole behaviour class (a hallucinated native tool call carrying the correct op and args grades as "(no bash call)"). The lanes entangle four independent axes — exposure, pressure, turn structure, sampling — that this change separates into per-case conditions over one table, gated on sampled rates. Design converged in conversation 2026-07-25; decisions recorded under Open decisions (resolved).

## User intent

*As a developer using a coding agent on a TS project, I want weaver's shipped skills validated against realistic agent behaviour, so that my agent actually reaches weaver's compiler-aware operations (with correct arguments) instead of grep/sed/tsc — and a skill edit that would break that steering is caught before it ships.*

## Relevant files

- `eval/harness/call-model.ts` — sends `temperature` unconditionally; discards `finish_reason`/usage. AC1, AC3 reporting.
- `eval/harness/config.ts` — `ModelConfig.temperature` becomes optional; new env vars land here.
- `eval/cases/cases.ts` — `CaseEntry` bag-of-optionals → discriminated union (AC2).
- `eval/cases/trigger-agentic.llm.test.ts` — the surviving lane; becomes the unified gate lane file.
- `eval/cases/command.llm.test.ts`, `pressured-emission.llm.test.ts`, `two-step.llm.test.ts` — retired (AC7); their case content folds into the table.
- `eval/cases/command-prompt.ts` — still the front-loaded prompt builder; now used by the unified lane.
- `eval/harness/agentic-loop.ts` — gains the front-loaded tool-set branch and unknown-tool error feedback path (partially exists via `classifySkillReach`).
- `eval/harness/assertions.ts` — `extractBashCommands` silently drops non-bash tool calls; trial detail must print all calls (AC3).
- `eval/harness/grade.ts`, `outcome.ts`, `case-lane.ts`, `seed.ts`, `clutter.ts` — verdict, tiers, seed depth, pressure; reused as-is or lightly extended.
- `eval/cases/coverage.test.ts`, `cases.test.ts` — invariants updated to the union shape.
- `eval/vitest.llm.config.ts` — lane timeout recomputed for front-loaded budget-3 cases.
- Docs: `docs/eval-design.md`, `docs/eval-baselines.md`, `docs/eval-readiness.md`, `eval/README.md`.

### Red flags

- `extractBashCommands` drops non-bash tool calls invisibly and `callModel` discards `finish_reason` — this hid correct weaver selections as "(no bash call)" (see baselines 2026-07-25 correction). Fixed by AC3's reporting requirement, not worked around.
- **Test hotspots:** the unified lane file absorbs three lanes' wiring — keep case authoring in `cases.ts` and the lane file thin (config + `it.each` + reporting), or it becomes the next oversized file.
- **Layer-fit:** AC1, AC4, AC5 are pure functions (request-body construction, trial verdict, rate/escalation arithmetic) — unit-test in the `test:eval` lane, covered by eval mutation. AC3's loop branching is unit-tested with the fake model; its end-to-end behaviour is verified only by a paid run (Working discipline: a harness change is proven on a real model).

## Value / Effort

- **Value:** the gate stops lying. Today a maintainer can ship a skill edit that `sed`s a user's project 3 runs in 5 while the eval gates green, and can be blocked by a "failure" that passes more often than not. After this change a red means a measured rate fell, a green means it held, and the same harness can point at any model (Sonnet, Gemini) as an env swap — the temperature coupling that 400s on frontier Claude models is gone.
- **Effort:** harness edits (call-model payload, loop branch, verdict/escalation helpers), `cases.ts` union rewrite + folding ~13 case definitions, three lane files deleted, docs restructure. No `src/` changes. Largest risk is case-folding fidelity (each folded case keeps its task text, keyArgs, and fixtures unchanged).

## Behaviour

- [ ] **AC1 — temperature omitted by default.** With `WEAVER_EVAL_TEMP` unset, the JSON body `callModel` sends contains no `temperature` key; with `WEAVER_EVAL_TEMP=0` (or any number) set, the body carries that value. `ModelConfig.temperature` is optional. Unit test asserts on the built payload for both cases. *(pure — unit layer)*
- [ ] **AC2 — one conditioned case table.** `CaseEntry` becomes a discriminated union: every case declares `exposure: "progressive" | "front-loaded"`; a field a variant never reads is a compile error (boundary cases carry no `command`/`keyArgs`; `seed` exists only on front-loaded cases; `expect.skill` only on progressive/boundary). The command, pressured-emission, and two-step case content folds in as front-loaded cases with task text, `keyArgs`, and fixtures unchanged; two-step cases keep their `seed`. `cases.test.ts`/`coverage.test.ts` invariants updated. *(type-level + invariant tests)*
- [ ] **AC3 — one runner.** Every case runs through `runAgenticLoop`, sampled. Front-loaded: skill bodies in context via `commandPrompt`, bash-only tool set, step budget 3, and a tool call naming an undeclared tool gets the host-style "no such tool" error fed back with the trial continuing (a convention stumble costs a turn, not the trial). Progressive: today's behaviour (competing tool set, budget 6). Clutter + per-case `momentumTurns` apply to every gated run. Trial detail prints **every** tool call (name + raw args, bash or not) and the response's `finish_reason` — the "(no bash call)" blindness is removed. *(loop branching — fake-model unit tests + real-run verification)*
- [ ] **AC4 — args gate.** A trial passes only when the expected weaver command is reached with correct `keyArgs` (`matchWeaverCommand` outcome `correct`). Boundary cases keep the all-clean inversion; the mutating-competitor hard-fail is unchanged. *(pure — unit layer)*
- [ ] **AC5 — flat rate gate with escalation, observational escape valve, destructive trials always alarm.** Default n=3 trials; a case below 2/3 auto-escalates to n=6 total and the final verdict alarms below 4/6. **A hard-failed trial (mutating-competitor, already tracked as `failedAtStep`) alarms the case regardless of its rate — including on observational cases.** A soft miss (never reached weaver) and a destructive act are different failure classes: "runs `sed -i` one trial in three" must never gate green on majority vote, and a destructive trial is never merely observational. A case may otherwise be marked `observational: { since: "YYYY-MM-DD", reason: "<reflex> — <rate> at demotion" }`: non-gating on rate, rate printed, load-time guard throws if the marking names no real case, and the run report prints "at ceiling — consider promoting" when an observational case passes every trial. An observational list larger than a couple of cases is a design smell (fix the skills or the case set, not the markers). *(pure rate logic — unit layer)*
- [ ] **AC6 — two diagnostic glasses.** `WEAVER_EVAL_TEMP` (force a temperature, e.g. 0 for deterministic replay of one path) and `WEAVER_EVAL_CLEAN=1` (drop clutter and momentum — separates "body broke" from "loses under pressure"). Both compose with `-t` and `WEAVER_EVAL_TRIALS`. Neither changes gating semantics — they are debugging modes. *(config wiring — unit where pure)*
- [ ] **AC7 — lane retirement.** `command.llm.test.ts`, `pressured-emission.llm.test.ts`, `two-step.llm.test.ts` deleted; `trigger-agentic.llm.test.ts` renamed to `gate.llm.test.ts` (both halves of the old name are now wrong — it is neither trigger-only nor the only agentic lane); `EXPECTED_FALLBACK`/`it.fails` machinery removed (replaced by AC5's observational marking — today's sole member: `command-get-type-errors`). *(wiring — verified by the baseline run)*

## Interface

No CLI/daemon/public `src/` surface changes. The interface is the eval harness's env contract and the case-table type.

- **`WEAVER_EVAL_TEMPERATURE`** — optional number (realistic range 0–2; typical use `0`). Unset = field omitted = model default sampling. Non-numeric value: fail fast at config load (maintainer typo, not user input). Keeps its existing full name; only its semantics change (was: defaulted to 0.7 and always sent).
- **`WEAVER_EVAL_CLEAN`** — optional; `1` disables clutter + momentum seeding. Absent = pressured (the gate condition).
- Existing `WEAVER_EVAL_BASE_URL/MODEL/API_KEY/TRIALS/DEBUG` unchanged.
- **`CaseEntry` union** (sketch — executor refines field placement so illegal states don't compile):

  ```ts
  type Exposure = "progressive" | "front-loaded";
  // progressive op case: expect.skill + command/keyArgs, cannedResults?, momentumTurns?
  // boundary case:       expect.skill: "bash" only — no command, no keyArgs
  // front-loaded case:   command/keyArgs, seed? (two-step), momentumTurns?
  // any op case:         observational?: { since: string; reason: string }
  ```

All values are maintainer-authored (case table + env); there is no untrusted input surface.

## Open decisions

All resolved in the 2026-07-25 design conversation; recorded here for the archive:

- **Sampling: omit `temperature` vs pin a value.** Omitted — measures the model's default (what a real caller gets), and uncouples the harness from temperature-accepting models (frontier Claude slugs 400 on the field; probe 2026-07-25 confirmed Haiku and Sonnet both emit the correct command with the field absent). Temp 0 survives only as a replay glass.
- **Gate statistics: per-case expected-rate bands vs flat rule.** Flat (n=3, <2/3 escalates to n=6, alarms <4/6). Every observed regression mechanism is a step change (knife-edge context coupling, model reflexes), not slow erosion; bands buy resolution nothing needs, at real per-run cost. Revisit only if a real regression slips through the flat rule.
- **Clean condition: standing gate lane vs diagnostic flag.** Flag. Clean lanes have never fired on any model (command lane 11/11 across four models) — a condition that never changes a decision doesn't earn standing cost.
- **Known-weak cases: delete vs observational marking.** Observational, because `get-type-errors` measures a real product gap (Haiku's `tsc` reflex) we want visibility on. The `it.fails` anti-staleness inversion cannot survive sampling (a 0.6-rate case would flap red on ~65% of runs), so staleness is mitigated by the dated reason, the load-time guard, and reading observational rates at periodic full runs.
- **Front-loaded: raw single call vs loop with budget 3.** Loop. A single call cannot distinguish a convention stumble (hallucinated tool call, corrected after one error turn in any real host) from a genuine miss — the 2026-07-25 Gemini probe is the direct evidence.
- **Gate model.** Haiku stays — not as "audience representative" (the audience is coding agents plural) but as the instrument that actually exhibits the shell reflexes the skills exist to displace. Gemini 2.5 Flash is the cheap cross-family sweep; Sonnet is an occasional audience-confidence run (env swap, ~$5–8). Cross-model cells are read by the confidence rubric (see Done-when docs item).
- **Destructive-trial scope: wrong weaver op only, not destructive shell.** AC5's always-alarm rule is scoped to `isMutatingCompetitor` — a `weaver` invocation of a mutating subcommand that is not the expected one. It is deliberately *not* extended to raw destructive shell (`sed -i`, `rm`, `git reset --hard`). Three behaviours were being conflated: (1) a wrong mutating weaver op is the model acting outside the request, is already tracked as `failedAtStep`, and costs one line to gate on; (2) an unsafe-but-on-task shell edit (`sed -i` for a replace task) is a *steering* failure, which is precisely what the sampled rate measures — the `command-replace-text` case gates green today because the retired lane was a single temp-0 call, not because of majority vote, and at a measured 2/5 it alarms under n=3 sampling; (3) gratuitous destruction (`rm -rf` unprompted) is a model-safety property no skill edit can move, so gating on it would make the lane permanently red for reasons weaver cannot fix. Class 2 also needs no new detection to stay visible: `formatCall` already prints every bash call's full command string in the trial detail. Revisit only if a real case is observed sustaining ≥2/3 while its minority failures are destructive.

## Security

- **Workspace boundary:** N/A — eval harness only; no new reads/writes outside `eval/` and its fixtures; no `src/` changes.
- **Sensitive file exposure:** N/A — reads shipped skill files and fixtures only.
- **Input injection:** N/A — all inputs are maintainer-authored case data and env vars; emitted commands are asserted on, never executed.
- **Response leakage:** N/A — trial output goes to the maintainer's terminal/log; no user-facing responses.

## Edges

- **Cost envelope:** full Haiku gate run ≈ $1–2 at n=3; worst-case escalation doubles a failing case's trials, bounded per case. `pnpm check` stays model-free (lane separation is a hard constraint).
- **Timeout budget:** `LANE_TIMEOUT_MS` recomputed per exposure (front-loaded budget 3 vs progressive 6) so a stalled provider doesn't conflate with a regression.
- **`-t` filtering** must keep working against the merged table (`truncateThreshold: 0` gotcha stands).
- **Folded cases keep their fixtures byte-identical** — fixture fidelity rules in eval-design's Working discipline apply; folding is a move, not a rewrite.
- **Eval mutation lane** (`pnpm test:mutate:eval`) must stay green over the new verdict/escalation helpers.

## Done-when

- [ ] All ACs verified by tests; AC3 additionally verified by a real run (see baseline item)
- [ ] Mutation score ≥ threshold for touched `eval/harness/**` files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] **Docs restructure:**
      - `docs/eval-design.md` rewritten to lead with a **Measurement principles** section (rates not single runs; gate on pressure only; instrument vs audience — Haiku has the habit, Gemini is the cheap sweep, Sonnet the occasional audience check; the gate + two glasses; paid-run discipline; case realism vs gaming; **what the gate measures** — a lenient pass@k-style selection floor plus a strict no-destructive-trial rule, deliberately not pass^k reliability, so green ≠ "reliable every run"; **paired A/B reading** — when comparing skill-text variants, read the per-case paired deltas on the same cases and seeds, never two absolute rates side by side), including the **cross-model confidence rubric** (Haiku✓+Sonnet✓+Gemini✓ strongest; Haiku✗+Sonnet✓ canary-specific → observational candidate, low urgency; Haiku✓+Sonnet✗ inverted canary → most alarming, investigate immediately; Gemini-only ✗ → attribute via outcome tiers first) and a **"Reading a red"** ordered diagnostic guide (check timeout/stall → replay with `WEAVER_EVAL_TEMP=0` → isolate with `WEAVER_EVAL_CLEAN=1` → classify via outcome tiers → cross-model if still ambiguous); mechanics below the principles
      - `docs/eval-readiness.md` still-true claims (what the suite does and doesn't predict) folded into `eval-design.md`; file deleted
      - `docs/eval-baselines.md` restructured: current-baseline table (per-case expected rates, updated in place) + dated run history below (absorbs the P4 baseline-vs-run-log entry)
      - `eval/README.md` run instructions updated (env vars, glasses)
      - `docs/handoff.md` current-state section updated (lane layout)
- [ ] **Baseline recorded:** first full Haiku run under the new gate written to `eval-baselines.md` (this is the real-path verification of the harness change), plus a Gemini 2.5 Flash sweep row; the measured `replace-text` rate noted against its standing `[needs investigation]` entry
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the owning doc
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
