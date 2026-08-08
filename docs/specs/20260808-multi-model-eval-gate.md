# Multi-model eval gate

**type:** change
**date:** 2026-08-08
**tracks:** handoff.md # The gate cannot see failures the audience hits → docs/eval-design.md, docs/eval-baselines.md

---

## Context

The gate runs one model, Haiku 4.5, chosen as a weakest-model canary on the premise that a model
exhibiting the shell reflexes the skills displace will surface any defect the audience hits. That
premise is falsified by measurement: Haiku held 10/10 on `command-find-references` while Gemini 2.5
Flash failed the same case 3/10, and the defect behind it was worth four cases across two models
once fixed. No trial count on a model that does not exhibit a failure will surface it. The gate is
also already red — `pressured-buried-rename` alarms at 6/10 on Haiku — so "green" currently
describes no state the suite reaches.

## User intent

*As a developer whose coding agent reaches weaver through its skill files, I want a skill-file
change to be blocked when it breaks any model family's ability to reach the right command, so that
my agent doesn't silently fall back to `grep`/`sed`/`mv` because of a regression the gate's single
model happened not to exhibit.*

## Relevant files

- `eval/harness/verdict.ts` — `belowFloor`, `decideEscalation`, `caseAlarms`, `isAtCeiling`; the
  escalation trigger and the new per-model gating predicate both land here
- `eval/harness/verdict.test.ts` — unit tests for the above, in the `test:eval` lane
- `eval/harness/config.ts` — `ModelConfig` and `modelConfig()`; the roster's natural home, since
  this file already owns "which model is this run pointed at"
- `eval/cases/cases.ts` — `ObservationalMarker`, `CaseBase`, `BoundaryCase`, `validateObservational`,
  the case table. 459 lines
- `eval/cases/cases.test.ts` — the case invariants, including the observational count cap at line 37
- `eval/cases/gate.llm.test.ts` — the gate lane; `gateOpCase` and the boundary `describe` block read
  the marker and assert. Runs only under `pnpm eval`
- `package.json` — `eval` script; the new runner script hangs alongside it
- `docs/eval-design.md`, `docs/eval-baselines.md`, `eval/README.md` — the docs that describe the
  gate's model policy and knobs

### Red flags

- `eval/cases/cases.ts` is 459 lines, past the 300-line "worth asking" mark and approaching 500.
  It is a cohesive data table plus its load-time validation, so it does not want splitting — but the
  roster must **not** land here. It belongs in `config.ts`, which already owns model configuration.
- The boundary gate's pass/fail decision is written inline in `gate.llm.test.ts`, a file that
  executes only under `pnpm eval`. Any per-model gating logic added there is untestable in
  `pnpm check`. Extract the decision into `verdict.ts` as a pure function before adding to it.

**Layer-fit:** ACs 1–6 and 8 are pure functions of their inputs — unit tests in the `test:eval`
lane (`verdict.test.ts`, `cases.test.ts`), which runs under `pnpm check`. AC 7's runner is a thin
process-spawning adapter over a pure plan builder; unit-test the plan builder, smoke the script by
running it.

## Value / Effort

- **Value:** A skill-file edit currently ships on the word of one model that demonstrably cannot see
  defects the audience hits. The developer's agent then falls back to `grep`/`sed`/`mv` on tasks
  weaver owns, silently — which is the exact failure the skills exist to prevent, and the exact
  failure a green gate claimed was absent. This makes the cross-family check mandatory rather than
  "periodic", so the class of miss that took a discretionary sweep to find is caught by the gate that
  runs anyway. It also makes a cleared case mean something: today a 2/3 clears, and the record has a
  2/3 that was truly 3/10.
- **Effort:** Small and contained to `eval/`. One new constant, one new field on an existing marker,
  one predicate extracted from a test file, one escalation-rule change, one runner script, three
  markers recorded. No new infrastructure — `tsx` is already a devDependency, so the runner imports
  the roster directly rather than duplicating it in shell. Cost per skill edit moves from ~$0.88 to
  ~$1.28.

## Behaviour

- [ ] **AC1 — Model roster.** A single exported roster in `eval/harness/config.ts` names the three
      gating models with their base trial counts: `anthropic/claude-haiku-4.5` (3),
      `google/gemini-2.5-flash` (10), `openai/gpt-5.6-luna` (10). It is the only place the model
      list is written; the runner and the marker validation both read it.

- [ ] **AC2 — Escalation trigger.** `decideEscalation(passed, total)` escalates when
      `total < ESCALATED_TRIALS` **and** the case either fell below the floor or did not sweep
      clean. `additionalTrials` is `ESCALATED_TRIALS - total` when escalating and never negative.
      - Given 2/3 → `{ escalate: true, additionalTrials: 3 }` (cleared the floor but unresolved)
      - Given 3/3 → `{ escalate: false, additionalTrials: 0 }`
      - Given 1/3 → `{ escalate: true, additionalTrials: 3 }`
      - Given 9/10 → `{ escalate: false, additionalTrials: 0 }` (already past the escalated total)
      - Given 5/10 → `{ escalate: false, additionalTrials: 0 }` (below floor, but no headroom)
      - Given 0/0 → `{ escalate: true, additionalTrials: 6 }` (unchanged: a harness fault that ran
        nothing must not gate green)

- [ ] **AC3 — Marker names its models.** `ObservationalMarker` gains a required non-empty
      `models: readonly string[]`, and `observational` moves from the two op-case interfaces up to
      `CaseBase` so a boundary case can carry one. A marker demotes its case only on the models it
      names; on every other model the case gates normally.

- [ ] **AC4 — Gating decision is a pure function.** `verdict.ts` exposes the "is this case gated on
      this model?" decision, and both `gateOpCase` and the boundary block in `gate.llm.test.ts` call
      it instead of reading `c.observational` inline.
      - Given an op case demoted for the active model and a below-floor rate → does not alarm, and
        its rate still prints
      - Given the same case with a different active model → alarms below the floor
      - Given a boundary case demoted for the active model and a dirty trial → does not fail, and
        its clean count still prints
      - Given a boundary case not demoted for the active model and a dirty trial → fails

- [ ] **AC5 — Validation at load.** `validateObservational` rejects, with the case name in the
      message: a marker whose `models` is empty, and a marker naming an id absent from the roster
      (message includes the offending id). The existing `since`-format and non-empty-`reason` checks
      keep their current behaviour.

- [ ] **AC6 — Per-model count invariant.** A case-table invariant asserts that no single roster
      model has more than 2 cases demoted for it. (A global cap no longer expresses "more than a
      couple is a design smell" once markers are model-scoped.)

- [ ] **AC7 — One command runs every model.** A `pnpm eval:gate` script runs the gate lane once per
      roster model, setting `WEAVER_EVAL_MODEL` and the base trial count from the roster. It runs
      every model even after one fails, prints a per-model pass/fail line and the run's reported
      cost, and exits non-zero if any model failed. The plan it executes — model id, trial count,
      argv — is built by a pure function that is unit-tested; the script itself only spawns and
      collects exit codes.

- [ ] **AC8 — Record today's accepted reds.** The case table carries exactly three markers, each
      with `since: "2026-08-08"` and a reason naming the recorded rate:
      `pressured-buried-rename` demoted for Haiku (6/10), `boundary-bash-search-non-ts-project` and
      `boundary-bash-remove-console-log` demoted for Luna (0/10 each). The existing
      `command-get-type-errors` marker is scoped to Haiku, where its "tsc reflex" reason was
      measured and where Gemini and Luna both sit at 10/10.

## Interface

Nothing on weaver's public surface changes — this is entirely inside `eval/`, which ships no runtime
code to users. The internal contracts that change:

**`GatingModel` / the roster (`eval/harness/config.ts`)**

- *Contains:* the OpenRouter model id as sent in `WEAVER_EVAL_MODEL`, and the base trial count that
  model runs at. Example: `{ id: "anthropic/claude-haiku-4.5", baseTrials: 3 }`.
- *Bounds:* three entries today. A 10× roster is not a realistic direction — each entry is a paid
  sweep, and the cost table is what bounds it, not the type.
- *Zero case:* an empty roster is a programming error, not a supported state; the runner has nothing
  to run and marker validation would reject every marker. Not defended against beyond the invariant
  in AC6 failing loudly.
- *Adversarial:* an id that no longer exists at the provider fails the run at the first API call
  with the provider's own error — the desired direction, since a silently-skipped model is the
  failure this whole spec exists to prevent.

**`ObservationalMarker.models` (`eval/cases/cases.ts`)**

- *Contains:* roster model ids this demotion applies to. Example: `["anthropic/claude-haiku-4.5"]`.
- *Bounds:* 1 to the roster size. Listing every model is legal and means "demoted everywhere".
- *Zero case:* empty is rejected at load (AC5) — an empty list would read as "demoted nowhere",
  which is indistinguishable from having no marker and would silently keep a case gating.
- *Adversarial:* a typo'd id is rejected at load rather than silently demoting nothing. This is the
  one place the fail-safe direction matters: a marker that matches no model would leave a known-red
  case gating, turning the suite red for a reason nobody wrote down.

**The gating predicate (`eval/harness/verdict.ts`)** takes the case's marker (or its absence) and
the active model id, and answers whether the case's result gates. Absent marker → gates. Marker not
naming the active model → gates. Marker naming it → does not gate. The hard-fail override in
`caseAlarms` is unchanged and still beats any demotion: a destructive act is never observational,
on any model.

## Open decisions

All four forks were resolved with the user on 2026-08-08 before the spec was written.

**Which models gate, and at what depth.** *Chosen:* Haiku n=3 + Gemini n=10 + Luna n=10, all
required. *Reasoning:* saturation is a property of a model × defect-class × text-version, not a
fixed property of a model — Gemini was 3/10 on `command-find-references` and is at ceiling on the
same case now that the defect is fixed. Since you cannot know which family a future defect lands
in, breadth is insurance, and at $0.40 for both cross-family sweeps it is cheaper than the depth it
replaces. Haiku stays because it is the only model still showing gradients on the current text.
*Consequences:* ~$1.28 per skill edit, up from ~$0.88. Both cheap models contribute no gating
signal *today* — they are at ceiling — so the value is entirely future insurance; that is accepted
knowingly. Watch for: a roster model going permanently red would make the gate unusable, which is
what AC3's demotion mechanism and AC6's cap exist to bound.

**How an accepted per-model red is expressed.** *Chosen:* extend the existing `observational`
marker with a required model list, rather than a baseline-regression gate or a flat known-failures
list. *Reasoning:* reuses a pattern already in the codebase with a dated `since` that resists
staleness, and avoids making `eval-baselines.md` machine-readable. A regression gate would be more
faithful but can ratchet downward silently. *Consequences:* the marker is now the only mechanism
for an accepted red, so its count cap is the pressure valve; `eval-baselines.md` stays prose.

**The escalation trigger.** *Chosen:* escalate unless the case swept clean, bounded by
`ESCALATED_TRIALS`. *Reasoning:* the record contains a 2/3 that cleared and was truly 3/10
(`command-find-references`, Gemini); the existing rule cannot catch that class. *Consequences:*
~$0.10 typical added cost on Haiku, bounded at ~$0.88 worst case if every case escalated. The
documented "manually widen any 2/3" rule in `eval-design.md` becomes automatic and should be
rewritten rather than left describing a manual step.

**How a multi-model run is invoked.** *Chosen:* one command running the models sequentially in
separate lane invocations. *Reasoning:* `WEAVER_EVAL_MODEL` is read process-wide by `modelConfig()`,
so per-model processes need no threading of model config through `callModel`; per-model runs are
also how baselines are already recorded. *Consequences:* three vitest startups and three cost lines
rather than one. Rules out a single aggregated cost total unless the runner sums the per-run
figures.

## Security

- **Workspace boundary:** N/A — the eval never executes weaver commands or writes to a workspace;
  commands are asserted as strings. The runner spawns `vitest` only.
- **Sensitive file exposure:** N/A — no new file reads. The harness reads `.claude/skills/` as it
  already does.
- **Input injection:** The runner interpolates roster model ids into a child process environment.
  The roster is a committed constant, not user input, so there is no untrusted value on that path.
  Model ids must be passed as environment values and argv entries, never concatenated into a shell
  string.
- **Response leakage:** N/A — no change to what the harness prints. The runner must print the model
  id and exit status only; it must not echo `WEAVER_EVAL_API_KEY`, which is a secret reference
  resolved at run time by the caller's password-manager CLI.

## Edges

- `WEAVER_EVAL_TRIALS` keeps overriding the base trial count, and now overrides the roster's
  per-model value too — it is the spot-check knob and must stay authoritative when set.
- `pnpm eval` continues to work unchanged as a single-model run driven by `WEAVER_EVAL_MODEL`. The
  new command is additive; nothing about the existing single-model workflow moves.
- Boundary cases still never escalate — they run a fixed trial count and are judged all-clean. AC2
  changes escalation for op cases only.
- The hard-fail rule for a mutating competitor is unchanged and still overrides a demotion on every
  model.
- `-t <case-regex>` filtering must still work through the runner, so scoping a multi-model run to
  one case stays possible.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (eval lane: `pnpm test:mutate:eval:file`)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] `pnpm eval:gate` driven for real against all three models — the run is the verification, and
      its per-model rates are recorded in `docs/eval-baselines.md` as a dated entry with the actual
      total cost
- [ ] Docs updated:
      - `docs/eval-design.md` — the "Instrument vs audience" table and its Haiku-only premise, the
        model-role table, the escalation description in "Reading a red" (the manual-widening rule
        becomes automatic), and the observational section's count cap
      - `docs/eval-baselines.md` — the dated run entry, and the conditions line describing the gate
      - `eval/README.md` — the new command and the roster in the knobs table
      - `docs/handoff.md` — current-state entry for `eval/`
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the relevant doc
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
