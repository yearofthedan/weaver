# Eval: real tool-call invocation + result-derived arg fidelity

**type:** change
**date:** 2026-07-12
**tracks:** handoff.md # Two-step lane rebuild/retire + command-lane bash-tool flip → docs/eval-design.md

---

## Context

The eval exists to answer one question — *will a real agent call weaver with the right args?* — but it currently fudges two axes. The command lane asserts on emitted **text** ("reply with ONLY the command"), not a tool call — an Ollama-era accommodation with no live justification. And nothing asserts the arguments an agent must **carry out of a prior tool result**: the two-step lane, which should test exactly that, seeds a degenerate `weaver <sub> '{}'` step-1 and then asserts prompt-derived args, so it tests nothing the command lane doesn't. This slice flips the command lane to a declared bash tool, rebuilds the two-step lane to assert a result-derived position, adds a structured args `outcome` so the agentic lane stops silently passing wrong args, and deletes the last Ollama accommodations.

## User intent

*As a weaver skill-author, I want the eval to verify that an agent invokes weaver through a real tool call with the correct arguments — including arguments it must carry from a prior tool result — so that a green eval means the skills produce correct real-world invocations, not merely well-formed text.*

## Relevant files

- `eval/harness/assertions.ts` — `matchWeaverCommand` (AC1 adds `outcome`), `extractBashCommands`, `weaverSubcommand` (the `outcome` classification reuses it).
- `eval/harness/grade.ts` — existing eval "grader" (`isMutatingCompetitor`, three-way loop verdict); the `outcome` axis is the args analogue, wired into the deterministic lanes rather than the loop.
- `eval/cases/command.llm.test.ts` — command lane (AC2). Carries the stale Ollama comment (13–15) to delete.
- `eval/cases/two-step.llm.test.ts` — two-step lane (AC3).
- `eval/harness/seed.ts` — `buildSeedMessages` (AC3 rewrites it to a real tool exchange); `buildHabitMomentumSeed` is the tool-exchange format to mirror. Carries the stale Ollama comment (61–62) to delete.
- `eval/cases/trigger-agentic.llm.test.ts` — agentic lane (AC4 reads `result.trail` and classifies the matched call).
- `eval/harness/tools.ts` — `BASH_TOOL` (declared in AC2 and AC3).
- `eval/cases/cases.ts` — case table: add `keyArgs` to trigger cases (AC4); drop the `two-step-find-references-then-move-symbol` case (AC3); the two-step `searchText` case gains the result-derived `keyArgs`.
- `eval/fixtures/searchText-userId.json` — the seeded step-1 result (line 12, col 9) AC3 asserts is carried.
- `eval/harness/agentic-loop.ts` — `runAgenticLoop` (`AgenticResult.trail`), `cannedToolResult` (unchanged; referenced for AC4 wiring).
- `eval/harness/call-model.ts` — `callModel(messages, [BASH_TOOL], …)` is the AC2/AC3 shape.
- `src/operations/searchText.ts` (`col = m.index + 1`, 1-based) and `src/ts-engine/engine.ts` `resolveOffset` (`getPositionOfLineAndCharacter(line-1, col-1)`, 1-based in) — the source proof that `col: 9` correctly targets `userId`; both ops agree at 1-based.
- `docs/eval-design.md` — the command/two-step/case-stages passages this slice makes false.

### Red flags

- **Test hotspots:** new unit tests land in `eval/harness/assertions.test.ts` (the `outcome` matrix) and `eval/harness/seed.test.ts` (the rebuilt `buildSeedMessages`). Assess both against `docs/code-standards.md` thresholds before adding; neither is expected near threshold, but confirm.
- The `.llm.test.ts` lanes are gated behind `pnpm eval` (need a live model) — they are **not** covered by `pnpm check` or mutation. All new *pure* logic (the `outcome` classifier, the seed builder) must be unit-tested in the harness `test:eval` lane so the behaviour has assertion coverage independent of a live run.

**Layer-fit per AC:**
- **AC1** — pure function. Unit-test the `outcome` matrix directly in `assertions.test.ts`. No integration.
- **AC2** — lane wiring only (`command.llm.test.ts`); the matching logic is `extractBashCommands` + `matchWeaverCommand` (AC1 / existing units). Verified by a live `pnpm eval` run; no new unit surface beyond AC1.
- **AC3** — the seed builder (`buildSeedMessages` → real tool exchange) is pure → unit-test in `seed.test.ts`. The carry-through assertion itself is live.
- **AC4** — the classification is AC1 (unit); the diagnostic wiring + trigger `keyArgs` are live/data.

## Value / Effort

- **Value:** today the eval can go green on infidelities a real agent would fail on — text that never becomes a tool call, wrong args the agentic lane ignores (`weaver rename '{"whoops":true}'` passes on subcommand alone), and a search→act carry-through that is never checked. Each is a way "green" lies about the real-world invocation. This closes all three.
- **Effort:** four harness/case files, two live lanes, one fixture reuse, doc edits. No new infrastructure — `BASH_TOOL`, `runAgenticLoop`, `matchWeaverCommand`, and the fixture all exist. The `outcome` field is additive (existing `.matched`/`.reason` callers unaffected).

## Behaviour

- [x] **AC1 — `matchWeaverCommand` returns a structured `outcome`.** Given a command string, expected subcommand, and optional `keyArgs`, the result includes `outcome: "correct" | "wrong-tool" | "wrong-args"` alongside `matched`/`reason`, defined as: `matched` → `"correct"`; else if `weaverSubcommand(command) === subcommand` → `"wrong-args"` (right op reached, args malformed / missing / wrong value / absent); else → `"wrong-tool"` (no weaver, or a different subcommand). Examples: `weaver rename '{"newName":"accountId"}'` vs expected `rename`+`{newName:"accountId"}` → `correct`; `weaver rename '{"whoops":true}'` → `wrong-args`; `weaver rename` (no arg) → `wrong-args`; `weaver replace-text '{}'` vs expected `rename` → `wrong-tool`; `grep userId src/` → `wrong-tool`.
  - *Laziest wrong impl:* deriving `outcome` by string-matching `reason` — brittle and couples to message wording. Define it from `matched` + `weaverSubcommand` vs `subcommand`, independent of `reason`.
  - *Unit-tested (matrix): correct / wrong-args (bad value, missing key, no arg, malformed JSON) / wrong-tool (other subcommand, non-weaver).* No mutation (eval excluded).

- [x] **AC2 — command lane invokes through a declared bash tool.** The command lane declares `BASH_TOOL` and asserts on the model's **bash tool call**, not emitted text. Given skill context + task + `[BASH_TOOL]` at `temperature: 0`, the model's bash call (via `extractBashCommands`) must `matchWeaverCommand(cmd, subcommand, keyArgs).matched`. A response with **no bash tool call** fails as "did not call the bash tool," surfacing `response.text`. The "reply with ONLY the single shell command" prompt and its Ollama comment are removed.
  - *Laziest wrong impl:* still reading `response.text` and parsing a command out of prose while a tool is declared — asserts nothing about invocation. The assertion must read `response.toolCalls`.
  - *Live (`pnpm eval`); matching logic is AC1.*

- [x] **AC3 — two-step lane asserts the result-derived position.** The lane seeds step 1 as a **real tool exchange** — assistant `bash` tool call running a realistic `weaver search-text '{"pattern":"userId"}'`, then a `tool`-role message carrying `searchText-userId.json` (line 12, col 9) — and asserts the follow-up `rename` bash tool call carries `keyArgs: { file: "/tmp/weaver-eval/src/auth.ts", line: 12, col: 9, newName: "accountId" }`. `line`/`col` appear **only** in the seeded result (task says *"I don't have the line number"*), so a match proves carry-through. `buildSeedMessages` is rewritten from three plain-text turns to the tool-exchange form (mirroring `buildHabitMomentumSeed`); the `'{}'` step-1 is gone. The `two-step-find-references-then-move-symbol` case is **dropped** — `move-symbol`'s args are all prompt-derived (already asserted by `command-move-symbol`), so it carries nothing from its `find-references` result.
  - *Laziest wrong impl:* asserting only `newName` (prompt-derived) after the new seed — green even if the model invents or drops the position. `line: 12` (result-only) is the load-bearing assertion; `col: 9` is included because the seam is source-verified (see Open decisions).
  - *Live; the `buildSeedMessages` change is unit-tested in `seed.test.ts`.*

- [x] **AC4 — agentic lane surfaces a non-gating args verdict.** For every trial that reaches the expected weaver subcommand (`result.matched`), the lane classifies the matched call's weaver segment via `matchWeaverCommand(segment, expectedCommand, keyArgs).outcome` and prints it in the trail summary (e.g. `matched@3 args:wrong-args`). Trigger cases gain `keyArgs` mirroring their command-lane counterpart (e.g. rename → `{newName:"accountId"}`). The selection **rate and its gate are unchanged** — a `wrong-args` trial still counts as a selection match; the verdict is diagnostic only. So `weaver rename '{"whoops":true}'`, today an invisible pass, now prints `args:wrong-args`.
  - *Laziest wrong impl:* folding the args verdict into the rate (a right-selection/wrong-args trial dropping the rate) — reintroduces exactly the selection/args smearing the lane split avoids. The rate must stay selection-only.
  - *Live; the classification is AC1. Trigger `keyArgs` use the command-lane values (none assert `col`), so the "column 8" task-text issue does not bite here — see Edges.*

## Interface

`WeaverCommandMatch` (in `eval/harness/assertions.ts`) gains one field:

```ts
export type CommandOutcome = "correct" | "wrong-tool" | "wrong-args";

export interface WeaverCommandMatch {
  matched: boolean;
  outcome: CommandOutcome;   // NEW — see AC1 for the mapping
  reason?: string;           // unchanged; populated when !matched
}
```

- **Contains:** which of the three real-world failure modes a single candidate command exhibits against one expected subcommand + `keyArgs`. `correct` iff `matched`.
- **Bounds / zero case:** total function over any string; a blank or non-weaver command is `wrong-tool`. Independent of `reason` wording.
- **Adversarial:** `weaver` prefixes (`npx`, `pnpm exec`) and `&&`-chains are handled upstream by the caller splitting via `extractBashCommands` before classification, as today.

`buildSeedMessages(task, step1Command, fixtureContent)` keeps its signature but returns a tool-exchange (`user` task → `assistant` with a `bash` `tool_calls` entry for `step1Command` → `tool` result carrying `fixtureContent`) instead of three plain-text turns.

No CLI/daemon/product surface changes — this is eval-harness only.

## Open decisions

Both forks are **resolved** (recorded here for the archive):

- **AC4 — include the agentic args diagnostic, or defer?** → **Include.** Resolved by the determinism property of this eval: it targets skill/tool selection and structured tool-call args, not free-form prose, so args are low-entropy on a clear task and an exact-value verdict is legitimate signal, not sampling noise. That removes the only reason to defer, and closes a real gap — the agentic lane currently passes `weaver rename '{"whoops":true}'` on subcommand alone. Kept **non-gating** so it never smears args noise into the selection rate. Consequence: `matchWeaverCommand.outcome` (AC1) gains a live consumer, so it is not speculative surface.
- **AC3 — assert `col`, or `line` only?** → **Assert `col: 9`.** Source-verified that the seam is correct: `searchText` emits `col = m.index + 1` (1-based → 9 for `userId` in `  const userId = …`) and `rename` consumes col through `resolveOffset` → `getPositionOfLineAndCharacter(line - 1, col - 1)` (1-based in → col 9 targets the `u`). Both agree, so `col: 9` is the correct expected value and a stronger carry-through proof than `line` alone. Dropping it "to avoid 0/1-based fragility" was rejected: the model transcribes the field from the result JSON (it does not recompute an index), and a genuine convention mismatch across that seam is precisely the bug this assertion exists to catch — the red would be the product. `line: 12` remains the minimum load-bearing assertion.

## Security

- **Workspace boundary:** N/A — eval harness writes no workspace files and adds no path-handling code; assertions run over in-memory strings.
- **Sensitive file exposure:** N/A — no file content is read beyond the existing fixture JSON under `eval/fixtures/`.
- **Input injection:** N/A — no new string parameter reaches the filesystem or shell; `BASH_TOOL` commands are asserted on, never executed (Non-goal: real command execution).
- **Response leakage:** N/A — failure messages surface the model's own emitted command/text (already the case), no user secrets.

## Edges

- **The agentic selection rate stays selection-only.** A trial that selects the right op with wrong args must still count toward the rate as a match; AC4 only annotates it. Regression-guard: a wrong-args match does not lower `computeRate`.
- **`buildHabitMomentumSeed` is untouched.** Only `buildSeedMessages` changes; the trigger lane's seed format must keep working.
- **Coverage invariant holds.** Dropping `two-step-find-references-then-move-symbol` is safe — `coverage.test.ts` requires a *command-stage* case per operation, and `command-move-symbol` remains; two-step cases are not the coverage source.
- **Lane separation holds.** New unit tests (`assertions.test.ts`, `seed.test.ts`) are pure — `pnpm check` still never needs a model server.
- **The "column 8" task-text smell is out of scope here.** Trigger `keyArgs` (AC4) mirror command-lane values and assert `newName`/`symbolName`/`file`/`pattern`, never `col`, so no prompt-derived case gates on `col`; correcting the 0-based "column 8" task text to 1-based (9) is left to the `eval-design.md` P2 task where it is recorded.
- **OSS-70B stress lane unaffected** — same harness, same tool set.

## Done-when

- [x] AC1 verified by unit tests (the `outcome` matrix); AC2/AC3/AC4 verified by a live `pnpm eval` run on the Haiku lane, with the before/after recorded in the Outcome section (esp. the new two-step carry-through case and any `args:wrong-args` annotations).
- [x] Mutation score — **N/A**: `eval/` is Stryker-excluded; no `reports/stryker-incremental.json` change for this slice.
- [x] `pnpm check` passes (lint + build + `test:eval` units; no model server).
- [x] No touched file exceeds the `docs/code-standards.md` hard flag; if `assertions.test.ts` / `seed.test.ts` cross threshold, extract per the test refactoring hierarchy before adding.
- [x] Stale Ollama comments removed: `command.llm.test.ts` (13–15) and `seed.ts` (61–62).
- [x] `docs/eval-design.md` — the **Case stages** command/two-step bullets (74–84) and any inline "text emission" / "why not a declared bash tool" rationale rewritten to the tool-call + result-derived-args reality. The broader de-stale (Architecture / Running / Interpreting / ladder / Working-discipline section) is the separate P2 task — do **not** absorb it here.
- [x] No skill file in `.claude/skills/` references these lane mechanics (confirm) — no skill update expected.
- [x] `docs/handoff.md` — the two-step P3 entry removed; the harness/lane description in "Current state" updated (command lane now a declared bash tool; two-step now asserts a result-derived position; `matchWeaverCommand.outcome`).
- [x] Tech debt discovered during implementation added to handoff.md as `[needs design]`.
- [x] Spec moved to `docs/specs/archive/` with an Outcome section (incl. Reflection).

## Outcome

Shipped as six commits: AC1 (`e599b0c`), AC2 (`93859f3`), AC3 (`12c4575`), AC4 (`051093e`), dead-`extractCommandsFromText` removal (`3846209`), and a follow-up single-call command-lane constraint (`076831e`).

**Live Haiku eval (2026-07-13, `anthropic/claude-haiku-4.5` via OpenRouter):**

| AC | Lane | Result |
|----|------|--------|
| AC1 | `assertions.test.ts` (unit, in `pnpm check`) | ✅ `outcome` matrix green |
| AC2 | command | 10/12. Two residual reds are precursor/selection, not wiring: `command-extract-function` cats the file before extracting; `command-move-directory` reached for plain `mv` (passed a prior run — likely temp-0 variance). Routed to a new `[needs design]` (Option A: follow the precursor via `runAgenticLoop`). |
| AC3 | two-step | ✅ carry-through confirmed — Haiku carried `line: 12, col: 9` from the seeded `search-text` result into the `rename` bash call. |
| AC4 | agentic | ✅ `matched@N args:correct` ×22 and `args:wrong-args` ×2 printed; rate stayed selection-only (wrong-args trials still counted as matches, the case passed). 13/14 — the 1 red (`trigger-refactor-rename-no-coords-sed-tempting` → `replace-text`) is the pre-existing "red by design" case owned by the Pressure-ladder task, gating path untouched here. |

**Real signal the eval now surfaces (the point of the slice):** AC4's non-gating verdict caught `trigger-refactor-move-file` emitting a **relative** `oldPath` (`src/auth.ts`) where the task gave the absolute `/tmp/weaver-eval/src/auth.ts` — an invisible pass before this slice. Logged as a lever for skill text / the pressure ladder.

**Test count:** +9 unit tests (the AC1 `outcome` matrix); net test-file change also removed 5 `extractCommandsFromText` unit tests and rewrote 2 `seed.test.ts` shape tests. The three live lanes (`command`, `two-step`, `trigger-agentic`) are `pnpm eval`-only.

**Mutation:** N/A — `eval/` is Stryker-excluded (`stryker.config.mjs` `ignorePatterns`).

### Reflection

- **What went well.** The `outcome` field derived from `matched` + `weaverSubcommand` (not `reason` wording) held up cleanly and AC4 consumed it immediately — no speculative surface. AC3's carry-through worked first try, confirming the source-verified 1-based `col: 9` seam decision was right, not fragile.
- **The AC2 miss, and the lesson.** AC2's spec assumed the model would go straight to the target op once given a bash tool, so the `commandPrompt` was just `skillContent + task`. The live run disproved that: removing the old "reply with ONLY the single command" text-emission instruction also removed the *single-shot constraint*, and Haiku took natural precursor steps (`cat`, `find-importers`, `find`). This is a spec-reality tripwire — the AC's interface assumption was wrong, not just its implementation — and it was only visible by running the real model, never by reasoning. The first fix attempt (naming weaver in the prompt) was correctly rejected by the user as **priming**: the old lane never named weaver, so the model had to select it. The right translation (B′) restored only the single-call constraint. It greened 10/12; the remaining two genuinely need the model followed through a precursor (Option A), deferred by decision rather than forced green.
- **Recommendation to the next agent.** Do not reason about what a model "should" emit and shape the assertion to match — run it. Two of this slice's key findings (the precursor behaviour, the relative-path arg gap) were invisible until the live run and would have been wrong if predicted. When a live lane goes red, first classify: wiring bug vs. real model behaviour vs. pre-existing known-red — the no-coords case here was already red by design and unrelated. Option A (command lane on `runAgenticLoop`) is the open thread.
