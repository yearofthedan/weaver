# `skillMdRead` detection scans only the turn's first call

**type:** bug
**date:** 2026-07-23
**tracks:** handoff.md # skillMdRead detection scans only the turn's first call — misses bundled skill-loads

---

## Symptom

In `runAgenticLoop` (`eval/harness/agentic-loop.ts`), a skill-load (SKILL.md read)
is only detected when it is the model's **first** call of a turn. When a model
bundles the skill-load with other calls in one turn and the load is *not* first —
Haiku 4.5 does this, firing `git log` + `Read` + `Skill(...)` together — the load
is missed: `skillMdRead` stays `false`, `readTurn` is unset, and the skill-load
call is pushed into `trail` as if it were an operation.

Surfaced in the 2026-07-23 Haiku baseline: `pressured-buried-find-references`
logged "no skill load" on every trial despite an explicit
`Skill(weaver-code-inspection)` in the trail.

Two impacts:
- **Gating/observational lanes** (`trigger-agentic.llm.test.ts`, rate lane):
  cosmetic — the trial still matches on the `weaver` call, so pass/fail is
  unchanged, but the `skill loaded@N` diagnostic and the trail are wrong.
- **Boundary lane:** a **correctness gap**. `boundaryTrialClean` short-circuits
  on `skillMdRead`, so a boundary trial that bundles a skill-load as a non-first
  call scores falsely clean — a missed over-trigger. (No boundary case bundled a
  load this run, so no rate was wrong yet.)

```
input:    a turn with calls [bash("git log"), Read(SKILL.md)]  (skill-load second)
          then a later turn with a matching weaver call
actual:   skillMdRead = false, readTurn = undefined,
          trail contains the Read (skill-load) call
expected: skillMdRead = true, readTurn = 1,
          trail excludes the skill-load call
```

## Value / Effort

- **Value:** This is the prerequisite for the P2 `[needs design]` item
  "Separate skill-content usability from host-exposure noise in the eval" —
  `skillMdRead` is the signal that isolates skill *content* from host *exposure*.
  Measuring the content signal on a flag that under-reports skill-loads measures
  noise. The boundary-lane correctness gap means a future boundary trial could
  silently pass an over-trigger.
- **Effort:** Root cause is confirmed and localised to one branch in one
  function. The fix is a mechanical generalisation of the first-call check to
  scan all of a turn's calls, mirroring the existing `.some(...)` pattern used by
  `matches`/`hardFails`. No new infrastructure.

## Expected

For each model turn, a skill-load is detected regardless of its position among
the turn's calls. Detecting a load and making an operation call in the same turn
are independent facts and both are recorded: `skillMdRead`/`readTurn` are set for
the load, while the non-load calls are the ones added to `trail` and checked
against `matches`/`hardFails`.

```
input:    turn calls [weaver find-references ...(match), Read(SKILL.md)]
expected: skillMdRead = true, matched = true, trail = [the weaver call only]

input:    turn calls [ls (boundary), Read(SKILL.md)]  then model abandons
expected: skillMdRead = true, boundaryTrialClean(result) = false (over-triggered)

input:    turn calls [Read(SKILL.md)] only  (pure navigation turn)
expected: skillMdRead = true, trail unchanged, loop continues (today's behaviour)
```

## Root cause

`agentic-loop.ts:219` binds `const call = calls[0]` and `:230`
`if (isSkillMdRead(call))` inspects **only that first call**, whereas the
sibling checks `:241` `calls.some((c) => matches(c))` and `:252`
`calls.some((c) => hardFails(c))` scan every call in the turn. When `calls[0]`
is not the skill-load, the `isSkillMdRead` branch is skipped, the loop falls
through, and `:239` `trail.push(...calls)` pushes the skill-load into the trail;
`skillMdRead`/`readTurn` are never set.

The asymmetry also makes detection order-dependent in the opposite direction:
when the skill-load *is* `calls[0]` and the turn also contains a matching weaver
call, the branch `continue`s (`:235`–`:236`) and swallows the whole turn, so the
match is never credited that turn. Order should not change the outcome.

Confirmed by reproduction (temporary test, run and observed red then removed):
a turn `[bash("git log"), Read(skill-load)]` produced `skillMdRead = false` with
the `Read` in `trail`, and `boundaryTrialClean` returned `true` (falsely clean)
for a boundary trial that bundled a non-first skill-load with a shell call.

## Fix

Generalise the per-turn skill-load handling in `runAgenticLoop` so it is
position-independent, partitioning each turn's calls into skill-loads and the
rest:

1. On each turn, detect a skill-load across **all** of `calls` (mirror the
   `.some(...)` pattern). On the first turn any call is a skill-load, set
   `skillMdRead = true` and `readTurn = stepIndex`.
2. Compute the non-skill-load calls for the turn. Push **only those** to `trail`
   (skill-loads remain excluded — they are navigation, not operations), and run
   the `matches` then `hardFails` checks over **only those** (keeping `matches`
   precedence over `hardFails`).
3. If the turn has **no** non-skill-load calls (a pure navigation turn), record
   the read and `continue` — today's behaviour for a lone skill-load turn.
4. `echoTurn` continues to echo the **full** turn (all calls, including the
   skill-load) — the model's real history includes the load, and the
   OpenAI-compatible endpoint requires a tool result for every `tool_call`.

**Precedence decision (resolved):** when a turn bundles a skill-load with a
matching or hard-failing call, record both facts — `skillMdRead` is set for the
load *and* the non-load calls drive `matched`/`failedAtStep`. This faithfully
represents what the model did (it both loaded the skill and made the call) and
removes the current order-dependence. A skill-load does not excuse a bundled
mutating competitor: the competitor is a non-load call and still triggers
`hardFails`.

Files: `eval/harness/agentic-loop.ts` (the loop body, `agentic-loop.ts:219`–`:263`).
No interface change — `AgenticResult`, the params, and the consumers
(`trigger-agentic.llm.test.ts`, `boundaryTrialClean`) are untouched.

**Adjacent inputs to cover with regression tests:**
- skill-load as a non-first call, later turn matches → `skillMdRead` true, load
  excluded from trail (the reported case).
- skill-load bundled *with* the matching call in the same turn → both
  `skillMdRead` true and `matched` true, trail excludes the load.
- skill-load bundled with a hard-failing mutating competitor → `failedAtStep`
  set, `skillMdRead` true.
- skill-load bundled with a shell-only boundary call, model abandons →
  `boundaryTrialClean` returns `false`.
- lone skill-load turn (only call) → unchanged: read recorded, loop continues.
- multiple calls, none a skill-load → unchanged.

## Security

- **Workspace boundary:** N/A — harness-only test scaffolding; reads/writes no
  workspace files and touches no `isWithinWorkspace` path.
- **Sensitive file exposure:** N/A — no file-content reads added; operates on
  in-memory `ToolCall` objects.
- **Input injection:** N/A — no user-supplied strings reach the filesystem or
  shell; the loop only inspects tool-call names/arguments already produced by
  the model transport.
- **Response leakage:** N/A — no change to error messages or response fields; the
  fix only alters which calls are counted vs. trailed inside the eval harness.

## Edges

- Sibling inputs (skill-load at position 0, mid-turn, last) — covered above.
- Same logic shared by both LLM consumers (rate lane + boundary lane) — the fix
  is in the shared `runAgenticLoop`, so both benefit; assert the boundary path
  via `boundaryTrialClean`.
- Happy-path regression: existing "skill-load as the sole first call" and
  "no skill load" tests in `agentic-loop.test.ts` must still pass unchanged.

## Done-when

- [x] Reproduction case now produces expected output (skill-load detected as a
      non-first call; boundary trial reports over-triggered)
- [x] Regression tests cover the adjacent inputs listed under Fix
- [x] Mutation score ≥ threshold for `eval/harness/agentic-loop.ts` (100%)
- [x] `pnpm check` passes (lint + build + test)
- [x] **Real eval run** verifies no rate shift on the gating lane (see Outcome)
- [x] Docs updated if public surface changed — none (harness-internal); JSDoc
      updated in `agentic-loop.ts`
- [x] Tech debt discovered during investigation added to handoff.md as
      `[needs design]` (none found)
- [x] Non-obvious gotchas — the position-independence rule is captured in the
      function JSDoc at the call site; no separate doc entry needed
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Verification:** Live Haiku lane, `pressured-buried-find-references` (the case
that surfaced the bug), 3 trials via
`pass-cli run --env-file .env -- pnpm eval eval/cases/trigger-agentic.llm.test.ts -t "find-references" --disable-console-intercept`:

```
pressured-buried-find-references — rate 3/3
  trial 1 [matched@4, skill loaded@3]: git log → git log → weaver find-references
  trial 2 [matched@5, skill loaded@4]: git log → git log → Read → git log → weaver find-references
  trial 3 [matched@4, skill loaded@3]: git log → git log → Read → weaver find-references
```

Every trial now reports `skill loaded@N` where it previously logged "no skill
load". The bundled non-first `Skill(...)` load is detected and excluded from the
trail; a plain source-file `Read` correctly *stays* in the trail (it is not a
skill-load). Rate is 3/3, unchanged — the fix shifts no gating-lane rate, as
predicted (gating cases match on the `weaver` call regardless of the flag).

**Reflection:**
- *Went well:* The handoff entry's root-cause claim was accurate; the discipline
  (reproduce red, then read the exact lines) confirmed it fast. The repro was a
  throwaway unit test — the bug is deterministic logic, so no instrumentation of
  the live path was needed to *find* it, only to *verify the fix* end-to-end.
- *Bonus find:* The obvious fix (an early `if (operationCalls.length === 0)
  continue`) was dead code — a pure-navigation turn falls through to the same
  echo/iterate with no operational calls to push or match. Mutation testing
  (two survivors on that guard) caught the redundancy; removing it took the file
  to 100% and simplified the loop. Lesson reinforced: don't reach for a guard
  before checking the fall-through already does the right thing.
- *For the next agent:* The now-reliable `skillMdRead` unblocks the P2
  `[needs design]` item "Separate skill-content usability from host-exposure
  noise in the eval" — its content signal builds directly on this flag.

**Test count:** +4 regression tests in `agentic-loop.test.ts` (25 total in file).
**Mutation:** `eval/harness/agentic-loop.ts` 100% (0 survivors), was 98.43% with
2 survivors before the dead-branch removal.
