# Agentic eval grader: mutating-competitor fail + neutral fixture fallback

**type:** change
**date:** 2026-07-11
**tracks:** handoff.md # Grader refinement + two-step lane rebuild → docs/eval-design.md

---

## Context

The agentic trigger lane's pass rule is exact-match: a case declares `expect.command` and
`matches` fires on the first `weaver <that-command>` call, crediting any earlier calls as
free precursors. This has two gaps the assertion-audit spike surfaced. (1) A trajectory that
runs the *wrong* destructive op and then the right one still passes, because the loop keeps
going after a non-match — the model has already done the wrong mutating thing. (2) An
unanticipated weaver hop is fed *another scenario's* fixture content (the no-coords `userId`
trial called `find-references` and got the `authenticate` fixture back, derailing it). This
change makes the grader classify a non-target mutating op as a hard fail, and replaces the
per-operation generic fixture fallback with an inert neutral stub so a case's `cannedResults`
is the only source of scenario content.

## User intent

*As a skill-text maintainer, I want the agentic lane to fail a trial that reaches for the
wrong destructive weaver op and to stop feeding unrelated scenario data into unanticipated
hops, so that a green rate means the model actually converged on the right operation for the
right reasons — not that it eventually typed the target command after doing something wrong,
or got lucky/unlucky on a mismatched canned result.*

## Relevant files

- `eval/harness/agentic-loop.ts` — `runAgenticLoop` (the loop + verdict handling), `cannedToolResult`, `CANNED_RESULTS`, `WEAVER_SUBCOMMAND_DEFAULTS`; the core of both changes.
- `eval/harness/agentic-loop.test.ts` — scripted-`ModelStep` unit tests for the loop and `cannedToolResult`; the fixture-fallback tests (lines ~442–462) change under AC4.
- `eval/harness/assertions.ts` — `isWeaverInvocation`, `weaverSubcommand`; the mutating-competitor guard builds on these.
- `eval/cases/trigger-agentic.llm.test.ts` — where the per-case `matches` predicate is constructed for the skill-trigger and boundary lanes; wires the new guard (AC3).
- `eval/cases/cases.ts` — `CaseEntry.expect.command`, `cannedResults`; no shape change.
- `eval/harness/fixtures.ts` — `loadFixture`, `operationToSubcommand`; still used by case-scoped overrides after `WEAVER_SUBCOMMAND_DEFAULTS` is removed.
- `src/daemon/dispatcher.ts` — `OPERATION_NAMES` (source of truth for the completeness guard). No existing mutating/read-only flag; the distinction (mutating ops take a `WorkspaceScope` and emit `filesModified`) is implicit, so the classification is harness-local.

### Red flags

- None severe. `agentic-loop.ts` (~256 lines) and its test file (~489 lines) are within threshold; the grader logic (mutability map + verdict predicates) is a new pure concern that belongs in its own small module (`eval/harness/grade.ts`) rather than swelling the loop file.

**Test hotspots:** `agentic-loop.test.ts` is the only sizeable test file touched; it is not near threshold. AC4 rewrites four existing `cannedToolResult` assertions in place rather than adding.

**Layer-fit check:** every AC is a pure function of its inputs (a tool call + case metadata → a verdict or a string). All four are unit-tested in the `test:eval` lane (runs in `pnpm check`, no model server). The live Haiku lane (`pnpm eval`) is used only for end-to-end verification (part 2), not for unit coverage.

## Value / Effort

- **Value:** A green agentic rate currently over-credits: it passes a trajectory that did the wrong destructive op first, and it can pass or fail a case for the wrong reason when an unanticipated hop returns another scenario's data. After this change the rate means "converged on the right op without a wrong destructive detour, on scenario-coherent inputs." This is the discrimination the pressure-ladder work depends on — a lane that mis-grades cannot report a trustworthy gradient.
- **Effort:** Contained to `eval/harness/` + one case-lane wiring file. One new small module (`grade.ts`), an additive optional parameter on `runAgenticLoop`, and a fallback swap in `cannedToolResult`. No public/CLI surface, no `src/` change, no new infrastructure.

## Behaviour

- [ ] **AC1 — Subcommand mutability classification.** A harness map classifies every weaver subcommand as `"mutating"` or `"read-only"`: mutating = `rename`, `move-file`, `move-directory`, `move-symbol`, `extract-function`, `replace-text`, `delete-file`; read-only = `find-references`, `find-importers`, `get-definition`, `get-type-errors`, `search-text`. A completeness guard test iterates `OPERATION_NAMES`, maps each through `operationToSubcommand`, and asserts every subcommand is classified — a new operation added without a classification fails this test (mirrors the fixtures-coverage invariant).
  - *Layer:* pure map + guard; unit test in `eval/harness/grade.test.ts`.
  - *Laziest wrong impl:* hard-code the two lists and let the guard rot. The `OPERATION_NAMES`-driven guard prevents that.

- [ ] **AC2 — `runAgenticLoop` supports a hard-fail verdict.** Add an optional `hardFails?: (call: ToolCall) => boolean` parameter. On a call that does not satisfy `matches` but does satisfy `hardFails`, the loop records the call in `trail`, then returns `{ matched: false, failedAtStep: <1-based step>, ... }` and stops — it does not echo the turn or continue. Callers that omit `hardFails` are unaffected (every existing behaviour — match, precursor, budget exhaustion, abandonment, skill-read — is unchanged). `matches` is checked before `hardFails`.
  - *Layer:* pure loop logic; unit test with scripted `ModelStep` fakes — (a) read-only precursor then wrong mutating op → `failedAtStep` at that step, `matched:false`, competitor in trail; (b) `matches` still wins when a call satisfies both (disjoint in practice, but pin the precedence); (c) omitting `hardFails` reproduces today's run-to-budget.
  - *Laziest wrong impl:* treat `hardFails` as a synonym for "no match" and run to budget — the test asserts `failedAtStep` is set and `steps` < `maxSteps`.

- [ ] **AC3 — The skill-trigger lane fails a mutating competitor.** The trigger lane passes `hardFails = isMutatingCompetitor(call, expectedCommand)`: true when the call is a `weaver <sub>` bash invocation whose `sub` is mutating and `!== expectedCommand`. Given `expect.command = "rename"`: `weaver rename …` → pass; `weaver move-file …` → hard fail (`failedAtStep` set, trial counts as not-passed in the rate); `weaver find-references …` → continue (read-only precursor, credited toward a later match); `Grep`/`Read`/`mkdir` → continue. The boundary lane passes no `hardFails` (its behaviour — run to budget, judged by `boundaryTrialClean` — is unchanged). The trail summary line renders a hard-failed trial distinctly (e.g. `competitor@<step>`).
  - *Layer:* `isMutatingCompetitor` is pure — unit test it directly in `grade.test.ts`. The trigger `.llm.test.ts` wiring is exercised live (part 2), not unit-mocked.
  - *Laziest wrong impl:* hard-fail on *any* non-expected weaver op — the test asserts a read-only op (`find-references`) is `continue`, not `fail`.

- [ ] **AC4 — Neutral fixture fallback replaces per-operation generic content.** In `cannedToolResult`, a `weaver <sub>` bash call whose `sub` is *not* owned by the case's `cannedResults` returns a single inert neutral stub (a fixed "no results" constant), **not** the operation's fixture content and **not** the generic bash file list. A case-owned subcommand still returns its override. A non-weaver bash call still returns the generic file list (or its override). An unknown *tool name* (not bash, not a mapped tool) still throws — the tool-set-drift guard is preserved. `WEAVER_SUBCOMMAND_DEFAULTS` (and its now-unused `loadFixture`/`operationToSubcommand`/`OPERATION_NAMES` imports in this file) is removed.
  - *Layer:* pure; unit test `cannedToolResult` — owned subcommand → override; un-owned subcommand → the neutral constant and *not* `loadFixture(op)`; non-weaver bash → file list; unknown tool → throws.
  - *Laziest wrong impl:* return `""` for an un-owned weaver call — the test asserts the neutral constant is non-empty and distinct from both the fixture content and the file list.

## Interface

N/A — internal eval-harness change. No CLI action, socket handler, or public surface. Signature changes are internal harness functions: `runAgenticLoop` gains an optional `hardFails`; `AgenticResult` gains an optional `failedAtStep`; a new `eval/harness/grade.ts` exports the mutability map, `isMutatingCompetitor`, and the completeness data. `CaseEntry` is unchanged.

## Open decisions

None — the two design forks were resolved before drafting:

- **Differentiator rule (deferred).** "A search/replace scenario passes on any weaver tool" adds no correct behaviour for the current case set (for a read-only-target case, "any weaver op" would wrongly credit a mutating op; for the current write cases it collapses to exact-match) and its one concrete intended use — accepting `replace-text` for a rename — rewards a footgun (see next). Deferred to the pressure-ladder work, which adds the phrasing-matrix cases the rule needs to be defined against. The mutability classification (AC1) is the rule's foundation and ships now.
- **No-coords rename (part 2) resolved by the grader, not a grader exception.** Renaming `userId → accountId` via `replace-text "userId"` also hits substrings, comments, and strings — the footgun `rename` exists to avoid. The grader therefore classifies `replace-text` for a rename case as a mutating competitor → hard fail; the case stays red *by design* until the skill text routes variable renames to `weaver-refactor` (separate work, out of this changeset). This changeset does **not** turn the no-coords case green — it makes the lane grade the case honestly.
- **Shadowing metric (deferred).** "Model reached weaver but also ran grep/sed" is non-gating and its "same intent" detection is fuzzy; it rarely fires on the thin current case set. Deferred to the pressure-ladder work.

## Security

- **Workspace boundary:** N/A — no file writes; the harness constructs no output paths. Fixture reads (`loadFixture`) are unchanged and confined to `eval/fixtures/`.
- **Sensitive file exposure:** N/A — no new file-content reads; the neutral stub is a constant string.
- **Input injection:** N/A — no new string parameters reach the filesystem or shell. The grader inspects tool-call strings that are already in memory.
- **Response leakage:** N/A — this is eval test code; no user-facing response surface.

## Edges

- **Boundary lane behaviour must not change:** still runs to the step budget (or model abandonment) and is judged by `boundaryTrialClean`; it passes no `hardFails`. Regression-guard this.
- **A read-only precursor before the expected op must still pass** (`matchedAtStep > 1`) — the hard-fail path must never fire on a read-only weaver op.
- **`replace-text` is mutating:** a `search-text` (read-only) target case that lands on `replace-text` hard-fails rather than silently passing.
- **The unknown-tool-name throw stays** — dropping the per-subcommand throw (AC4) must not drop the guard against a drifted *tool set*.
- **`cannedResults` overrides still win** for both weaver subcommands and non-weaver tools.

## Done-when

- [x] All ACs verified by unit tests in the `test:eval` lane (runs in `pnpm check`).
- [x] **Live Haiku verification (part 2):** confirmed — see Outcome for before/after rates.
- [x] Mutation score — **N/A**: `eval/` is excluded from Stryker (`stryker.config.mjs` `ignorePatterns`; `vitest.stryker.config.ts` is `src/**`-only). Compensated with assertion-strong unit tests (exact verdicts and the neutral-vs-fixture distinction pinned).
- [x] `pnpm check` passes (pre-commit hook ran the full suite green on every commit).
- [x] No touched file exceeds the hard flag in `docs/code-standards.md` (`grade.ts` is 46 lines; the loop file stayed within threshold).
- [x] Docs updated: `docs/eval-design.md` (grader verdict + neutral-fallback contract + `&&`-split gotcha); `docs/handoff.md` (`eval/harness/` current-state line, task entry).
- [x] Tech debt: none new. The stale `coverage.test.ts` fixture-coverage comment was corrected in-session rather than deferred.
- [x] Non-obvious gotchas recorded in `docs/eval-design.md` (the `&&`-split requirement for any bash-string predicate).
- [x] Spec moved to `docs/specs/archive/` with this Outcome section.

## Outcome

**Shipped:** parts 1 + 3. Six commits: subcommand mutability classification (`grade.ts`); optional `hardFails` veto on `runAgenticLoop` (`failedAtStep`); the skill-trigger lane's mutating-competitor wiring (`competitor@<step>` in the trail); the neutral fixture fallback; then two verification fixes (below).

**Live Haiku before/after** (`pnpm eval trigger-agentic`, 3 trials/case, 14 cases):

| Run | Result | Notes |
|-----|--------|-------|
| First (mechanism only) | 12/14 | `search-and-replace-pattern` regressed to 1/3; `no-coords` 0/3 but **misgraded** — a `cd … && weaver replace-text` competitor read as "no match" |
| After fixes | 13/14 | only `no-coords` red (1/3), now honestly graded: `competitor@3, competitor@3, matched@4` — the one pass is a genuine `rename` |

Both live criteria met: the no-coords case never passes spuriously (its pass is a real `rename`), and no previously-green case regressed. The case stays red **by design** — Haiku reaches for `replace-text` (the sed-temptation), which the grader now names a competitor; flipping it green is a skill-text lever tracked with the pressure ladder.

**Tests added:** eval `test:eval` lane 280 → 315 (+35).

**Reflection:**
- *What went well:* resolving the two design forks up front (differentiator deferred, no-coords red-by-design) kept the implementation mechanical. The mutability classification + `isMutatingCompetitor` are a clean, reusable foundation for the deferred differentiator rule.
- *What the unit lane could not catch:* both verification fixes came only from the live run. (1) `isMutatingCompetitor` inspected the raw bash string, so a `cd <dir> && weaver <sub>` competitor slipped through — the `matches` predicate splits `&&` via `extractBashCommands` and this one did not. **Generalisable:** any predicate over a bash command string in this harness must go through `extractBashCommands` (recorded in `eval/harness/grade.ts` and `docs/eval-design.md`). (2) The neutral fallback (AC4) shipped without the companion case-ownership updates, regressing a replace case whose on-path `search-text` precursor now returned "no results." **Generalisable:** a fixture-fallback mechanism change and the case-data that mechanism now requires (cases own on-path hops) are *one* behavioural unit — splitting them across "mechanism now, data later" produced a red lane. Worth folding into the spec discipline: when a default becomes inert, audit which cases relied on the old non-inert default in the same changeset.
- *For the next agent (pressure ladder):* every new multi-hop case must own coherent `cannedResults` for each on-path hop, or it strands on the neutral stub. The differentiator rule needs read-vs-write-target cases to be defined against — build those first, then the rule.
