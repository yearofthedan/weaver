# Eval command lane: follow precursor steps

**type:** change
**date:** 2026-07-13
**tracks:** handoff.md # Eval command lane: follow precursor steps → docs/eval-design.md

---

## Context

The command lane asserts a single unprimed bash call at temperature 0 — the correctness lane
for `weaver <command> '<json>'` argument fidelity. On tasks that invite a precursor, the model's
first bash call is not the target op, so the single-shot assertion fails: on the 2026-07-13 Haiku
run the lane scored 10/12, with `command-extract-function` `cat`ting the file before extracting.
The lane must follow the precursor and assert the *eventual* weaver call while staying
deterministic, mirroring how the agentic trigger lane already credits a precursor via
`runAgenticLoop`.

## User intent

*As a maintainer tuning skill text, I want the command lane to score a task on the weaver command
the model eventually commits to — not on a benign precursor it takes first — so that a red in this
lane is a real argument-fidelity regression, not an artefact of the model looking before it acts.*

## Relevant files

- `eval/cases/command.llm.test.ts` — the lane being rewritten; today a single `callModel` at
  temp 0 with a "single call" prompt over `BASH_TOOL`.
- `eval/harness/agentic-loop.ts` — `runAgenticLoop` (the multi-step driver, reused unchanged) and
  `cannedToolResult` (resolves the precursor result: a non-weaver bash call → `caseResults?.bash ??
  CANNED_RESULTS.bash`; an unowned `weaver <sub>` → the inert `NEUTRAL_WEAVER_RESULT`).
- `eval/cases/trigger-agentic.llm.test.ts` — the pattern to mirror: `matches` on subcommand reach,
  post-loop segment reconstruction, and the per-trial trail summary with `matchedAtStep`.
- `eval/harness/assertions.ts` — `isWeaverInvocation` (subcommand-only, the `matches` predicate),
  `matchWeaverCommand` (→ `matched` + `outcome` correct/wrong-tool/wrong-args, the gating check),
  `extractBashCommands`.
- `eval/cases/cases.ts` — `CaseEntry.cannedResults`; the precursor-prone case
  (`command-extract-function`) gains a plausible `bash` stub here.
- `eval/harness/tools.ts` — `BASH_TOOL` (the lane's only declared tool; no `Skill` tool, so no
  skill-load hop).
- `docs/eval-design.md` — the command-lane section describes the single-shot shape and must be
  updated to the eventual-call shape.

### Red flags

- `command.llm.test.ts` is a small single-`it.each` file well under threshold — the rewrite
  replaces the `callModel` block with a `runAgenticLoop` block plus post-loop reconstruction; no
  decomposition needed.
- **Layer-fit:** every AC below is LLM behaviour observable only under `pnpm eval` (live model).
  The reusable machinery (`runAgenticLoop`, `cannedToolResult`, `matchWeaverCommand`) is already
  unit-tested in the `test:eval` lane and is not modified. This change adds no new source module,
  so it contributes no `pnpm check` unit tests and no mutation surface (`eval/` is Stryker-excluded).

## Value / Effort

- **Value:** The command lane stops producing false reds on precursor-inviting tasks (2 of 12 on
  the last run). A maintainer editing skill text can trust that a command-lane red is an
  argument-fidelity regression, not the model catting a file first — which is the whole point of a
  deterministic correctness lane distinct from the selection-rate lane.
- **Effort:** One test file rewritten, one case gains a `cannedResults` stub, one doc section
  updated. No source module changes — `runAgenticLoop` and `cannedToolResult` already expose every
  seam. The loop rewrite is mechanical (mirrors the agentic lane). Small.

## Behaviour

- [ ] **Follows a precursor to the eventual op.** Given `command-extract-function` (the model runs
      a non-weaver `cat`/`sed`/`head` bash call before extracting), the lane drives the model
      forward with `runAgenticLoop` and passes when a later bash call is
      `weaver extract-function '<json>'` carrying `functionName: "hashPassword"` — rather than
      failing on the first non-weaver call. The precursor's fed-back result comes from the case's
      `cannedResults.bash` stub.
- [ ] **Argument fidelity stays gating, with wrong-args vs wrong-tool diagnosis.** `matches` stops
      the loop at the first `weaver <expected-subcommand>` bash call (subcommand only, via
      `isWeaverInvocation`); the test then classifies that segment with
      `matchWeaverCommand(segment, subcommand, keyArgs)` and passes **only** when
      `outcome === "correct"`. A trajectory that reaches the expected subcommand with a
      missing/wrong key arg fails with a message reporting `wrong-args` and the offending command; a
      trajectory that never reaches the expected subcommand within the step budget fails with
      `wrong-tool` and the full trail.
- [ ] **Single-shot cases are unchanged.** Given a case where the model emits the weaver command on
      its first call (no precursor — e.g. `command-rename`, `command-search-text`), the lane still
      passes, matching at step 1.

## Interface

No public/product surface changes. This is an internal eval-lane behaviour change. The observable
interface is the test lane's pass/fail contract:

- **`matches` predicate** — `(call) => call.name === "bash" && extractBashCommands([call]).some(
  (cmd) => isWeaverInvocation(cmd, expectedSubcommand))`. Subcommand-only, identical in shape to the
  agentic lane's `matches`. Contains: the reach-the-op condition. Bounds: one `expectedSubcommand`
  per case (from `c.expect.command`). Zero case: a case with no `expect.command` is a table error —
  assert it is defined, as today.
- **Post-loop argument assertion** — after a matched loop, locate the matched bash segment in
  `result.trail` (the first satisfying `isWeaverInvocation(cmd, subcommand)`), run
  `matchWeaverCommand(segment, subcommand, c.expect.keyArgs)`, and assert `outcome === "correct"`.
  Contains: the gating arg check. Adversarial case: a matched trail whose segment has malformed
  JSON → `matchWeaverCommand` returns `matched: false` with a "JSON malformed" reason → the assert
  fails with that reason (surfaced, not swallowed).
- **`cannedResultFor`** — `(call) => cannedToolResult(call, c.cannedResults)`. No `Skill`-tool
  handling (the command lane declares only `BASH_TOOL`), so `isSkillMdRead` is `() => false`.
- **`cannedResults.bash` stub for `command-extract-function`** — a short, plausible TypeScript
  snippet standing in for the `cat` output. Contains: enough code to read as a real file body so the
  precursor does not read as "empty file" and strand the model. Bounds: a handful of lines; it is
  never asserted on. It need not be byte-truthful — the task already states the line range — only
  non-derailing (accepted tradeoff of the canned-stub decision below).

## Open decisions

### RESOLVED — Precursor feedback: canned stubs, not real execution

**Decision:** What result does a precursor call get fed back? **Canned stubs** — reuse the existing
`cannedResults` + `cannedToolResult` path; a precursor-prone case sets a plausible `bash` override.

**Options considered:**
- **A — Canned stubs (chosen).** Reuse today's machinery; set a plausible `bash` stub on the
  precursor-prone case. No real execution; the "eval never runs real commands / no daemon" Non-goal
  stays intact. Cost: a hand-authored stub whose plausibility is a maintenance tax (small — one case).
- **B — Real seeded workspace, plain-shell reads only.** Seed a real scaffold and resolve
  read-only shell precursors (`cat`/`find`/`wc`) against it for real output; every weaver op stays
  asserted/canned. Establishes a real-fixture substrate and needs no daemon, but is a larger build
  (a read-resolver + scaffold) not justified by the one plain-`cat` case this task exists to fix.
- **C — Real world including read-only weaver ops.** B plus a live daemon executing read-only
  weaver ops for real; kills the two-step carry-through fixture-fidelity tax entirely. This is the
  P5 "harnessed end-to-end" item — stands up the daemon in the eval and rewrites the Non-goal.
  Subsystem-sized; out of scope.

**Reasoning:** The failing case (`command-extract-function`) is a plain `cat` on a task that already
states the line range ("Extract lines 10–20"), so the precursor is gratuitous — the fed-back result
needs only to be non-derailing, not truthful. `eval-design.md`'s working discipline is explicit:
*run → observe → debug, never predict-then-carve.* We have observed the single-shot constraint fail;
we have **not** observed a stub cause flailing. B/C are architectural bets justified only after a
stub is seen to fail. B's real-fixture prize (and C's carry-through prize) can be pursued later as
their own tasks; A is the minimal correct fix here.

**Consequences:** Keeps the eval free of real execution and the daemon. Entrenches the canned-stub
pattern and does not touch the two-step lane's fixture-fidelity tax (unchanged, still governed by
"fixtures are the scenario"). If a live run shows the stub cannot hold convergence for a case,
enrich that case's stub first; escalate to B only if stubs demonstrably fail across cases.

### RESOLVED — Step budget

**Decision:** `MAX_STEPS = 3`. The command lane has no skill-load hop (skills are inlined in the
prompt, not loaded via a `Skill` tool), so the budget only spans precursor(s) + the operation. The
common trajectories are 1 step (single-shot) or 2 (one precursor + op); 3 leaves a one-step margin.
Confirm empirically on the first live run — if a case exhausts the budget on benign extra reads,
raise it. Do not set it high: on a deterministic clean-room lane, failing to converge in 2–3 steps
is genuine signal, not something to paper over with budget.

### RESOLVED — Determinism / lane separation

**Decision:** The lane runs a **single trajectory at temperature 0** — no `WEAVER_EVAL_TRIALS`
loop, no clutter prompt, no habit-momentum seed. It reuses `runAgenticLoop` for the multi-step
drive only; it must **not** become a second rate lane. `eval-design.md`'s "selection is a rate;
correctness is deterministic" boundary is preserved: the agentic lane measures selection rate under
pressure (temp 0.7, N trials, subcommand-only), this lane measures deterministic argument
correctness (temp 0, single trajectory, gating args).

## Security

- **Workspace boundary:** N/A — no filesystem reads or writes. Precursor results are static strings
  from `cannedResults`/`CANNED_RESULTS`; the target weaver command is asserted on, never executed.
- **Sensitive file exposure:** N/A — no file content is read; the `bash` stub is a hand-authored
  literal committed to the case table.
- **Input injection:** N/A — no new string parameter reaches the filesystem or a shell. The model's
  emitted command string is parsed by `matchWeaverCommand` and never executed.
- **Response leakage:** N/A — no user-controlled or file-derived content enters responses; the lane
  is a local test against a hosted model with maintainer-supplied fixtures.

## Edges

- **No source-module change.** `runAgenticLoop` and `cannedToolResult` are reused as-is. If the
  rewrite appears to need a change to either, stop and reconsider — the seams already exist.
- **Coverage invariant unaffected.** `eval/cases/coverage.test.ts` checks every operation has a
  command-stage case + fixture; it is independent of how the lane drives the model and must stay
  green in `pnpm check`.
- **`command-move-directory` stray `mv` is out of scope.** A model emitting a bare `mv` instead of
  `weaver move-directory` is a *selection* miss (route to skill text / the pressure-ladder task),
  not a precursor this work fixes. Under the new eventual-call semantics an `mv` *followed by*
  `weaver move-directory` would now pass (mv credited as a precursor); an `mv` the model treats as
  the finished answer still fails. Note the case in the Outcome if its behaviour shifts, but do not
  chase a selection fix here.
- **Live verification only.** Every AC is observable only under `pnpm eval` with the OpenRouter env
  vars set (`WEAVER_EVAL_BASE_URL`/`MODEL`/`API_KEY`). The implementing agent verifies `pnpm check`
  (harness unit tests + coverage invariant, no model needed) and that the file compiles; the
  maintainer runs `pnpm eval` to confirm the behavioural ACs. This is a hard handoff boundary.

## Done-when

- [ ] All ACs verified — `pnpm check` green (harness unit tests + coverage invariant) by the
      implementer; the three behavioural ACs confirmed by the **maintainer** running `pnpm eval`
      (env vars required; unavailable to the implementing agent).
- [ ] Mutation score: N/A — no source module changed; `eval/` is Stryker-excluded.
- [ ] `pnpm check` passes (lint + build + test).
- [ ] No touched file exceeds the hard flag in `docs/code-standards.md`.
- [ ] Docs updated:
      - `docs/eval-design.md` — "The command and two-step lanes (deterministic)" section rewritten
        to describe the command lane's eventual-call, multi-step-but-deterministic shape (precursor
        credited, args still gating, single trajectory at temp 0). The two-step lane description is
        unchanged.
      - handoff.md — remove the "Eval command lane: follow precursor steps" entry; update the
        `Current state` eval blurb if the command-lane description no longer holds.
- [ ] Tech debt discovered added to handoff.md as [needs design] (e.g. command+two-step lane
      unification onto the shared loop, deferred here).
- [ ] Non-obvious gotchas recorded in `docs/eval-design.md` if any surface.
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended.

## Outcome

**Shipped:** extract-function's precursor is a two-step seeded case (`cat` → assert
`extract-function`), not the free-hand `runAgenticLoop` this spec proposed.

**Why the approach changed.** The spec's plan was implemented (ff4cf28) and regressed the live lane
10/12 → 6/12: without the single-call constraint the model does shell-doable tasks in plain shell
(`mv`, `grep`, `npx tsc`) and never reaches weaver. The single call is what isolates argument
fidelity from selection; relaxing it turns the command lane into a selection lane (the agentic
lane's job). Reverted (28d3f0e), refixed by seeding the precursor — the pattern the two-step lane
already uses.

**Result (live `pnpm eval command two-step`):** extract-function green in the two-step lane;
search→rename unregressed; command lane 10/11. The remaining fail, `move-directory`, is a selection
miss (`mv` treated as done), not a precursor — out of scope, routes to skill text / the pressure
ladder.

**Also shipped:** `loadFixture` reads a fixture by filename (no `.json` default), so a non-weaver
precursor result (a `cat` body) lives in a real `.ts` file. Reuse review logged a dedup chore
(readFileOrThrow / FIXTURES_DIR) to handoff.

**Reflection:** The spec accepted the handoff's "follow the precursor, assert the eventual call"
framing without checking whether a free-hand loop keeps the lane deterministic-on-args. It doesn't,
and only running it showed that — as the eval's own discipline says: run → observe → debug, never
predict-then-carve. For the command lane, keep the single-call constraint and handle a precursor by
seeding it, never by opening the budget.

Tests: no new unit tests (LLM cases, verified live). Mutation: N/A (eval Stryker-excluded).
