# Pressured single-shot emission lane

**type:** change
**date:** 2026-07-24
**tracks:** handoff.md # Single-shot emission under pressure → docs/eval-readiness.md, docs/eval-baselines.md

---

## Context

The lane matrix has two axes — selection (does the model pick weaver?) and emission
(does it emit the right `weaver <cmd>` + args?) — each crossed with clean vs pressured
context. Three cells are filled; the fourth is empty: **emission is only ever graded in a
*clean* context** (the command lane). The pressured lanes grade *selection* and the
multi-step *recipe*, never single-shot emission. So a skill-body edit can keep clean-context
emission green while making the model fall back to the shell the moment the context is
cluttered and habit-primed — the real condition agents run in — and no lane turns red.

A spike (2026-07-24, temp 0, `momentumTurns: 3`, bash-only) confirmed the cell is not empty:
under pressure the gate model **Haiku** dropped `weaver find-importers` → `grep`,
`weaver search-text` → `grep`, and `weaver get-type-errors` → `npx tsc` (3/11), and the
stronger **Gemini 2.5 Flash** dropped `weaver move-file` → `mv` (1/11). Both models,
primed by a `grep`/`git log`/`find` momentum seed, fell back to the shell equivalent the
seed primed — deterministic at temp 0, isolated to the added pressure (same task, same
temp, clean passes).

The existing pressured *multi-step* lane already computes an args verdict under pressure,
but only as reporting, only after selection+load has succeeded, bundled with selection
noise. This lane isolates emission — body in context, one bash move — deterministically and
~10× cheaper.

## User intent

*As a developer relying on weaver's skill files, I want the eval suite to catch a skill-body
edit that makes single-shot command emission fragile under realistic host pressure, so that
the guidance I depend on keeps producing the right `weaver` command even when the agent is
distracted by a cluttered context and primed toward shell tools — not only in a clean,
single-prompt setup.*

## Relevant files

- `eval/cases/command.llm.test.ts` — the clean emission lane this mirrors; reuse its
  `commandPrompt` shape (skill content + task + single-call instruction) and its
  `matchWeaverCommand` + `keyArgs` grading.
- `eval/cases/trigger-agentic.llm.test.ts` — the pressured multi-step lane; source of the
  pressure recipe (`buildClutterSystemPrompt()` as system content, habit-momentum seed).
- `eval/harness/clutter.ts` — `buildClutterSystemPrompt()` (generic ~12k-char crowded host
  prompt, weaver-free).
- `eval/harness/seed.ts` — `buildHabitMomentumSeed(task, turns)`; throws past pool size (3).
- `eval/harness/assertions.ts` — `matchWeaverCommand`, `extractBashCommands`.
- `eval/harness/tools.ts` — `BASH_TOOL` (the only tool this lane declares).
- `eval/cases/cases.ts` — the single-step command cases (`stage: "command"`, no `seed`) this
  lane reuses unchanged.

### Red flags

- (none) The lane adds one `.llm.test.ts` reusing already-tested harness helpers; no new
  harness source, so no test hotspot and nothing new to mutation-test.

**Layer-fit:** the lane is `pnpm eval`-only (API-gated), like every `*.llm.test.ts`. It
introduces no new deterministic logic — the pressured prompt is `[system, ...seed]` over
existing tested builders, and the gate/observe partition is a local `const Set`. No new unit
tests in `pnpm check` are required (the helpers it composes are already covered).

## Value / Effort

- **Value:** closes the one blind spot where a skill-body regression ships silently. Today
  the clean command lane and the pressured selection lanes can all be green while emission
  under pressure has rotted; after this, the eight cases that hold emission under pressure
  gate — a body edit that drops any of them to a shell fallback (`grep`/`mv`/`tsc`) turns CI
  red. Cheap: one temp-0 call per case, same cost profile as the clean command lane.
- **Effort:** one new `.llm.test.ts` composing existing helpers; a local known-red `Set`;
  docs updates. No new harness source, no schema change.

## Behaviour

- [ ] **AC1 — currently-robust cases gate.** Given a single-step command case
  (`stage: "command"`, no `seed`) whose `name` is *not* in the known-red baseline set, run
  under the pressured setup — `system = buildClutterSystemPrompt()`, then a **3-turn**
  habit-momentum seed wrapping the command prompt (full skill content + task + "make a single
  call"), `BASH_TOOL` only, temperature 0 — the lane asserts the model emits a `weaver
  <command>` matching the case's `command` + `keyArgs` (`matchWeaverCommand(...).matched`); a
  non-match fails the case.
  - Laziest-wrong guard: dropping either the clutter system prompt or the momentum seed
    reduces this to the clean command lane. The setup **must** include both pressure elements —
    a case passing with pressure absent is not evidence for this AC.
  - **Legitimate-pressure constraint.** The momentum seed must contain only shell work weaver
    has no operation for (log grep, `git log`, filename `find`) — the existing
    `TRUE_SHELL_POOL`. It must **never** model a shell stand-in for a graded weaver op (`grep`
    of workspace *source* → `search-text`; `grep` for a symbol's uses → `find-references`;
    `mv`/`rm` → `move-file`/`delete-file`; `sed` → `replace-text`). A seed that demonstrates the
    substitution manufactures the failure instead of measuring the skill body's weakness. This
    is the established momentum-seed principle (`docs/eval-design.md`); the lane reuses the
    compliant pool unchanged and must not extend it with a substituting step.

- [ ] **AC2 — known-red baseline cases report but do not gate.** Given a case whose `name`
  is in the known-red set — `command-find-importers`, `command-get-type-errors`,
  `command-search-text` (measured red under pressure on Haiku, 2026-07-24) — the lane runs
  the identical pressured setup and logs the case's pass/fail plus the emitted fallback
  command, but makes **no** gating assertion; the run is green whether or not the case matches.

The pressured-prompt assembly and the per-case logging are verification details within
AC1/AC2, not separate ACs. The known-red set is a **local `const Set<string>` in the lane
file** with a baseline comment — deliberately not a new `CaseEntry` field (that type is
already an overloaded bag; see the P4 "Discriminate `CaseEntry` by stage" item).

## Interface

No public/product surface changes — this is an internal eval lane. The only new surface is
the test file and its local known-red set.

- **Known-red set** — `Set<string>` of case `name`s currently red under pressure on the gate
  model. Contents (2026-07-24, Haiku): `command-find-importers`, `command-get-type-errors`,
  `command-search-text`. Bounds: a subset of the single-step command case names (≤ 11).
  Zero/empty case: an empty set means every case gates (the end state after the deferred
  hardening). Adversarial: a name in the set that no longer matches a case is dead — a
  comment must tie each entry to the measured baseline so stale entries are removable.
- **`momentumTurns`** — fixed at 3 (the pool maximum; `buildHabitMomentumSeed` throws past
  it). Not configurable — one pressure level, matching the buried trigger cases.

## Open decisions

(none) The gate-vs-observational fork is resolved: **gate the cases that hold emission under
pressure, mark the measured-red cases observational.** This mirrors the clean command lane's
per-case temp-0 gating (not the n=3 buried cases' rate-observational style, which exists only
because n=3 rates are unstable — not the case here). Consequence: the lane ships green while
still gating 8 cases; the three red cases are reported until the deferred body-hardening flips
them to gating. What to watch: the partition is calibrated to the gate model; see Edges.

## Security

- **Workspace boundary:** N/A — the lane makes API calls and asserts on returned strings; it
  writes no files and executes no emitted command.
- **Sensitive file exposure:** N/A — no file reads; skill content is already-public
  `SKILL.md` bodies.
- **Input injection:** N/A — no new parameters reach the filesystem or shell; emitted
  commands are matched as strings, never run.
- **Response leakage:** N/A — logs contain the model's emitted command and skill guidance,
  no secrets.

## Edges

- The gate/observe partition is calibrated to the **gate model (Haiku)**. Running the lane
  against another model may gate a case that model happens to fail under pressure (e.g.
  Gemini's `move-file` → `mv`, which is not in the Haiku known-red set). Acceptable — the
  whole suite is Haiku-calibrated; CI runs the default model. Documented, not guarded.
- `momentumTurns: 3` is the pool maximum; a request beyond it throws (inherited
  `buildHabitMomentumSeed` guard). The lane never requests more.
- The pressure's legitimacy is load-bearing (see AC1's legitimate-pressure constraint): the
  reused `TRUE_SHELL_POOL` is weaver-orthogonal, so the spike's observed fallbacks
  (`search-text`→`grep` of source, `find-importers`→import-grep, `get-type-errors`→`npx tsc`,
  `move-file`→`mv`) are habit transfer, not copied precedents — none was demonstrated in the
  seed. A future seed step that greps *source*, greps for a symbol's uses, or runs `mv`/`sed`
  would invalidate the corresponding case's signal.
- Lane runs only under `pnpm eval`, never `pnpm check` (API-gated globalSetup).

## Done-when

- [ ] AC1 gates the robust single-step command cases; AC2 reports (no assertion) the three
      known-red cases — verified by a `pnpm eval` run on Haiku showing 8 gated cases green and
      the three red cases logged with their fallback commands.
- [ ] Mutation score ≥ threshold for touched source files — N/A, no source touched (verify no
      harness source changed).
- [ ] `pnpm check` passes (the new lane is eval-only; check must stay green).
- [ ] No touched file exceeds the code-standards hard flag.
- [ ] Docs updated:
      - `docs/eval-readiness.md` — fill the now-covered "NONE × pressured" cell in the lane
        matrix (§1) and the Findings note that flagged it as an empty gap.
      - `docs/eval-baselines.md` — add the pressured-emission baseline (which cases held,
        which fell back, on Haiku; note Gemini's `move-file` divergence).
      - `docs/eval-design.md` — a mechanics note if the lane's setup isn't obvious from the
        existing lane descriptions.
      - handoff.md current-state `eval/cases` line (new lane) and remove the P3 task entry.
- [ ] Deferred tech debt added to handoff.md as `[needs design]`: harden the three red skill
      bodies to hold single-shot emission under shell-habit pressure, then remove them from the
      known-red set to flip the lane fully gating.
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended.
