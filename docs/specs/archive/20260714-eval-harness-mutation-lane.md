# Eval harness mutation-testing lane

**type:** change
**date:** 2026-07-14
**tracks:** handoff.md # Eval harness mutation-testing scope → docs/tech/mutation-testing.md

---

## Context

The agentic eval harness (`eval/harness/`) carries real branching logic — `cannedToolResult` scenario/subcommand resolution, `weaverSubcommand`, `isMutatingCompetitor`, the tool-exchange echo in `runAgenticLoop`, frontmatter parsing in `context.ts` — but `eval/` is excluded from Stryker (`ignorePatterns` lists `eval`; `vitest.stryker.config.ts` includes only `src/**`). Its unit tests are pure (scripted `ModelStep` fakes, no model server), so the logic is mutatable today; nothing verifies the harness's own assertions catch a logic inversion. A spike proved the mechanism works: a separate Stryker config over `eval/**/*.test.ts` (excluding the `.llm.test.ts` cases) mutates the full harness in 44s, 306 tests, zero errors, scoring 70.14% out of the box.

## User intent

*As a maintainer of the eval harness, I want its branching logic covered by mutation testing, so that a regression in the grader/loop/assertion code is caught by a failing assertion rather than shipping a silently-wrong eval verdict.*

## Relevant files

- `stryker.config.mjs` — the src lane config; the eval config mirrors its structure (mutator exclusions, thresholds, `disableTypeChecks`, `coverageAnalysis`).
- `vitest.stryker.config.ts` — the src sandbox test config; the eval sandbox config mirrors its `include`/`exclude` shape.
- `eval/vitest.config.ts` — the pure eval unit-test lane; its `include: ["eval/**/*.test.ts"]` / `exclude: ["eval/cases/**/*.llm.test.ts"]` is exactly the sandbox test set.
- `.github/workflows/quality-feedback.yml` — src mutation CI (triggers: weekly `schedule` + manual `workflow_dispatch` — no `push` trigger exists; cache restore/save, artifact upload, `/mutate-triage` on failure); the eval lane is added as a parallel job and inherits the same triggers.
- `docs/tech/mutation-testing.md` — where the eval-lane config notes and its known-survivor rationale go.
- `package.json` — scripts (`test:mutate` / `test:mutate:file` are the pattern to mirror).
- `eval/harness/assertions.ts` (+`.test.ts`) — 68%, 44 survivors; the largest triage target (parsing/matching helpers).
- `eval/harness/context.ts` (+`.test.ts`) — 53%; real gaps in frontmatter parse + ENOENT branch.
- `eval/harness/agentic-loop.ts` (+`.test.ts`) — 72%; the core loop, real gaps.
- `eval/harness/clutter.ts`, `eval/harness/tools.ts` — the two data-only files to exclude from `mutate` (see AC2).

### Red flags

- **Test hotspots:** `eval/harness/agentic-loop.test.ts` (~19k) and `assertions.test.ts` (~13k) are large. AC3 adds kill-tests to these. If a file crosses the hard flag in `docs/code-standards.md`, extract per the test refactoring hierarchy (push down to units → extract fixtures → parameterise) before adding more.
- No source-side smells found; the harness files are cohesive. `clutter.ts` and `tools.ts` are pure content builders (prompt text, static tool schemas) — not logic, hence the AC2 exclusion.

## Value / Effort

- **Value:** The eval harness is the instrument that tells us whether a skill-text change helped or hurt. An untested logic inversion in the grader (`isMutatingCompetitor`, `matchWeaverCommand`) or the loop (`runAgenticLoop`'s match/hard-fail/echo ordering) produces a wrong verdict that looks like a real signal — the most expensive kind of bug, because it silently misdirects skill tuning. Mutation testing is the only check that these assertions actually bite.
- **Effort:** Small-to-moderate. Config plumbing is chore-shaped (proven by the spike). The real work is triaging ~98 survivors on the logic files (after excluding the two data files) and writing the missing assertions to clear break=75. Four files touched for plumbing (two new configs, `package.json`, the CI workflow); test additions concentrated in `assertions.test.ts` and `context.test.ts`.

## Behaviour

- [x] **AC1 — the eval mutation lane exists and is scoped correctly.** `pnpm test:mutate:eval` runs Stryker via `stryker.eval.config.mjs` against `vitest.stryker.eval.config.ts` (test set = `eval/**/*.test.ts` minus `eval/cases/**/*.llm.test.ts`). The sandbox retains `src/` (eval tests import `OPERATION_NAMES` from `src/daemon/dispatcher.js`) and `.claude/skills/` (`skill-file.test.ts`/`context.test.ts` read the shipped `SKILL.md` bodies); it ignores `.claude/agent-notes` and `.claude/agent-memory`. The lane uses its own `incrementalFile: "reports/stryker-eval-incremental.json"` so it never clobbers the src cache. `pnpm test:mutate:eval:file <path>` scopes to one file. Laziest wrong impl: reusing the src `ignorePatterns` (drops `.claude/skills/` → dry run fails "Skill file not found") — the AC is only met when a full run completes with zero dry-run errors.
  - *Layer-fit:* tooling AC; verified by running the command and inspecting the report, not by a unit test.
- [x] **AC2 — the two data-only files are excluded from the eval `mutate` set, documented.** `eval/harness/clutter.ts` (prompt-string builders) and `eval/harness/tools.ts` (static tool-definition schemas) are excluded via a `!`-negation in the config's `mutate` array. `docs/tech/mutation-testing.md` records *why*: these are content fixtures, not logic — their surviving `ObjectLiteral`/`BlockStatement` mutants (`{...}→{}`, body→`{}`) replace prompt text / schema objects that no assertion pins by design. Laziest wrong impl: excluding them silently — a future reader sees the gap and either re-includes them (score tanks) or assumes they're untestable logic. The documented rationale is the deliverable, not just the exclusion.
- [x] **AC3 — logic-file survivors are triaged and the lane clears break=75.** Every survivor on `assertions.ts`, `context.ts`, `agentic-loop.ts`, `fixtures.ts`, `seed.ts`, `call-model.ts`, `grade.ts` is classified (Rule 20): a real gap gets a new assertion that kills it; genuine noise (structurally unreachable / equivalent mutant) is recorded in the `docs/tech/mutation-testing.md` eval section with an explicit reason. After triage, `pnpm test:mutate:eval` exits 0 at break=75. Laziest wrong impl: lowering the eval break threshold to the current score — the threshold is an alarm, not a target; it stays at 75.
- [x] **AC4 — CI runs the eval lane.** `quality-feedback.yml` runs `pnpm test:mutate:eval` (own cache restore/save keyed to `stryker-eval-incremental`, own report artifact, own step summary) so eval-harness regressions surface on the workflow's existing triggers (weekly + manual dispatch), alongside the src lane. Laziest wrong impl: a step with no cache persistence — every run starts cold; acceptable functionally but wasteful, so the cache steps are part of the AC.
  - *Resolved during implementation — auto-triage step deferred:* the plan was to mirror the src job's `/mutate-triage`-on-failure step once AC3 cleared break=75. On implementation this proved not a trivial mirror: `/mutate-triage` is hardcoded to the src lane (`reports/mutation/mutation.json`, `pnpm test:mutate`, `reports/stryker-incremental.json`), so a naively-copied step would triage the *src* lane from the eval job — worse than no step. Rather than ship a misdirected step, the eval job stops at failed-job + report-artifact + step-summary visibility (a regression is still loud in CI), and making `/mutate-triage` lane-aware then wiring the eval triage is a follow-up (`docs/handoff.md`). No `permissions` block is added since no step pushes.

> Type-matrix note: the lane's inputs are `.ts` harness files only — no `.vue`/engine paths. The distinct code paths are the harness's own branches (bash-vs-tool in `cannedToolResult`, match-vs-hardFail-vs-echo in the loop, ENOENT-vs-parse-fail in `context.ts`), which AC3's triage covers per-file.

## Interface

N/A — internal tooling and CI. No public CLI/socket/MCP surface changes. New developer-facing scripts (`test:mutate:eval`, `test:mutate:eval:file`) are documented in `docs/tech/mutation-testing.md` and `CLAUDE.md`'s command list.

## Open decisions

Both forks were resolved by the spike; recorded here for the archive.

- **Separate config vs. widen the existing src config → separate.** The eval sandbox needs `.claude/skills/` present and does not want the src lane's assumptions; the src lane must not carry `.claude/skills/`. Widening would couple two lanes with divergent sandbox needs and force both into one incremental cache. A separate `stryker.eval.config.mjs` with its own `incrementalFile` isolates them. *Enables:* independent cadence, independent cache, `test:mutate:eval:file` scoping. *Rules out:* a single "mutate everything" command (acceptable — the src and eval lanes are run/triaged separately anyway). *Watch:* the two configs share structure; keep mutator exclusions and thresholds in sync when either changes.
- **Mutate the whole harness vs. exclude the data-only files → exclude `clutter.ts` and `tools.ts`.** They are the eval equivalent of `src/**/__testHelpers__` — static content whose mutants aren't behaviour. Including them drags the score ~3 points below threshold on noise and invites chasing unkillable content mutants. *Enables:* the threshold reflects logic coverage. *Rules out:* nothing of value — no assertion is meant to pin the exact prompt text or schema shape. *Watch:* if either file gains real logic (e.g. conditional clutter assembly), re-include it and cover the new branch.

## Security

- **Workspace boundary:** N/A — no product code path changes; eval harness reads only repo-local test files and the shipped skills.
- **Sensitive file exposure:** N/A — no new file reads of secret-bearing paths; the sandbox additions (`src/`, `.claude/skills/`) are source and documentation.
- **Input injection:** N/A — no new string parameters reaching fs/shell.
- **Response leakage:** N/A — no runtime response surface touched.

## Edges

- The eval `.llm.test.ts` cases must stay excluded from the sandbox test set — they require the hosted model endpoint (`vitest.llm.config.ts`/`global-setup.llm.ts`) and would fail the dry run.
- `pnpm check` must NOT run the eval mutation lane (mutation never gates `check`; parity with `test:mutate`).
- The eval incremental cache (`reports/stryker-eval-incremental.json`) is committed after runs, same discipline as the src cache (Rule 16).
- The src mutation lane (`pnpm test:mutate`) is unaffected — its config, cache, and score stay as-is.

## Done-when

- [x] All ACs verified: `pnpm test:mutate:eval` exits 0 at break=75; the two data files are excluded and documented; CI runs the lane.
- [x] Every logic-file survivor is either killed or recorded with a rationale in `docs/tech/mutation-testing.md`.
- [x] `pnpm check` passes and does not invoke the eval mutation lane.
- [x] No touched source or test file exceeds the hard flag in `docs/code-standards.md`; extract before adding tests if AC3 pushes `assertions.test.ts`/`agentic-loop.test.ts` over.
- [x] `reports/stryker-eval-incremental.json` committed.
- [x] Docs updated:
      - `docs/tech/mutation-testing.md` — eval-lane config section (sandbox needs, separate cache, exclusions) + eval known-survivor table.
      - `CLAUDE.md` commands list — add `test:mutate:eval` / `test:mutate:eval:file`.
      - `docs/handoff.md` — remove the task entry; update the current-state eval note if the layout changes.
- [x] Tech debt discovered during implementation added to handoff.md as [needs design].
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended.

## Outcome

**Reflection:**
- *What went well:* Spiking first was decisive — turning the lane on immediately (rather than speccing in the abstract) surfaced the two sandbox needs (`src/` for the `OPERATION_NAMES` import, `.claude/skills/` for the SKILL.md-reading tests) and the real 70% baseline, collapsing the "separate config vs. widen" fork to an evidence-backed call in minutes. The execution agent's Rule-14 discipline caught an error of mine: I told it `grade.ts:43` was "a real gap, kill it" because it survived the spike — but surviving ≠ killable. It verified empirically that the `subcommand !== undefined` guard is TypeScript-required (narrows the index type) and a runtime-equivalent mutant (no `"undefined"` key exists), and documented it as noise. The discipline working as intended.
- *What didn't go well / took longer:* Stryker's incremental cache reported a stale `Survived` verdict on `static: true` mutants (`truncate`/`indent`) even after tests that kill them were added, because cache invalidation keys off source changes, not test-suite additions — cost a detour, resolved by a delete-cache clean run and now documented. Separately, my AC4 assumed the src auto-triage step was a trivial mirror; it wasn't (`/mutate-triage` is hardcoded to the src lane), caught before shipping a misdirected step and deferred to a lane-aware follow-up.
- *Recommendation for the next agent:* pick up the lane-aware `/mutate-triage` follow-up (handoff P4) to give the eval lane the same auto-triage-on-failure the src lane has. When writing kill-tests for `node:fs` wrapper guards, use the documented `vi.mock("node:fs")` pattern — `vi.spyOn` fails under Vitest's ESM handling of built-ins.

**Tests added:** eval unit tests 306 → 364 (+58) across new assertions and 4 new test files (`fixtures.test.ts`, `canned-tool-result.test.ts`, `boundary-trial-clean.test.ts`, `agentic-loop.debug.test.ts` — the last three split out of `agentic-loop.test.ts` to keep every file under the 500-line hard flag).

**Mutation score (eval lane, clean full run):** 98.39% overall, break=75 cleared. agentic-loop 100%, assertions 98.51%, call-model 100%, config 100%, context 91.49%, fixtures 100%, grade 93.33%, rate 100%, seed 100%. 7 surviving mutants, all documented as equivalent in `docs/tech/mutation-testing.md`.

**Source change:** one Rule-20 dead-code simplification in `assertions.ts` — an unanchored, optional `(?:npx\s+|pnpm\s+exec\s+)?weaver` presence check reduced to `/weaver/` (the prefix group never constrained the match), killing 6 would-be-noise mutants by removing the dead alternation rather than documenting them.

**Decisions preserved:** separate config (sandbox needs differ from src); `clutter.ts`/`tools.ts` excluded as content fixtures, not logic; eval auto-triage deferred until `/mutate-triage` is lane-aware.
