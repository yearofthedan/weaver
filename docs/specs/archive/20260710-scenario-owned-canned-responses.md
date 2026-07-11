# Scenario-owned canned responses

**type:** change
**date:** 2026-07-10
**tracks:** handoff.md # Grader refinement + scenario-owned canned responses → docs/eval-design.md

---

## Context

The agentic trigger lane feeds a canned tool result back after each model turn. Today that result comes from one global map keyed by tool *name* (`agentic-loop.ts` `CANNED_RESULTS`). Every `bash` call — including `weaver search-text …` — resolves to the single `"bash"` entry, a bare file list with no `line:col`. So a case that must search before it can act (find `userId`'s position, then `rename` it) never gets the position back and cannot converge. This is the sole red case in an otherwise-green Haiku lane (`trigger-refactor-rename-no-coords-sed-tempting`, 0/3; assertion-audit spike). The fix is to let a scenario own the result its tool calls feed back, and to make a `weaver` stub always return a `weaver`-shaped response.

## User intent

*As an eval author, I want a case to control what its intermediate tool calls feed back, so that a multi-hop scenario (search → act) gets a realistic, position-carrying result and the lane measures whether the model can actually converge rather than a harness fidelity gap.*

## Relevant files

- `eval/harness/agentic-loop.ts` — `CANNED_RESULTS` + `cannedToolResult`; the resolution point that changes.
- `eval/harness/assertions.ts` — `isWeaverInvocation`/`isAnyWeaverInvocation`/`extractBashCommands`; add `weaverSubcommand` here alongside the other weaver-command parsers.
- `eval/cases/cases.ts` — `CaseEntry` type + the case table; `loadFixture`/`fixtureContent`; add the optional `cannedResults` field and populate the no-coords case.
- `eval/cases/trigger-agentic.llm.test.ts` — `cannedResultForCall` (the skill-aware wrapper) threads the per-case map into `cannedToolResult`; both `it.each` blocks pass `c.cannedResults`.
- `eval/harness/agentic-loop.test.ts` — existing `cannedToolResult` unit tests to extend.
- `eval/harness/assertions.test.ts` — home for `weaverSubcommand` unit tests.
- `eval/fixtures/searchText.json` — existing grab-bag search stub (TODO + userId + v1); the incoherent one to *not* reuse for a userId search. New focused `searchText-userId.json` sits beside it.
- `docs/eval-design.md` — durable home for the weaver-faithful-stub invariant.

### Red flags

- None in the target files. `agentic-loop.ts` (~175 lines) and `cases.ts` (~295 lines) are cohesive and under threshold. `assertions.ts` already owns weaver-command parsing, so `weaverSubcommand` fits its responsibility.

**Layer-fit check:**
- AC1 (`weaverSubcommand`) — pure function of a command string. Unit test in `assertions.test.ts`.
- AC2 (`cannedToolResult` resolution) — pure function of `(call, caseResults)`. Unit test in `agentic-loop.test.ts`.
- AC3 (per-case wiring + applied win) — the map field and its threading are pure/structural (unit-assert that a `weaver search-text` bash call in the no-coords case resolves to the positional stub). The *convergence* claim (0/3 → passing) is only observable through the LLM lane and is API-gated → manual `pnpm eval` verification in Done-when, not an automated test.

## Value / Effort

- **Value:** The lane stops scoring a harness artefact as a model failure. A no-coords rename is a real agent workflow (the model rarely has line/col to hand); today the eval can't tell "the skill text failed to trigger a rename" from "the harness never handed back a position." Scenario-owned results remove that confound, and the weaver-faithful invariant means no future case can silently regress into feeding a `weaver` call a shell-shaped blob. It is also the infrastructure the deferred two-step rebuild and pressure-ladder work consume.
- **Effort:** One new pure helper, one enriched resolver, one optional case field, one fixture, and test-file plumbing. No new infrastructure; all through existing patterns (`CaseEntry`, `loadFixture`, the `cannedResultFor` seam the loop already exposes).

## Behaviour

- [ ] **AC1 — `weaverSubcommand(command)` extracts the subcommand.** Given `"weaver search-text '{…}'"` → `"search-text"`; `"pnpm exec weaver rename '{…}'"` → `"rename"`; `"npx weaver move-file …"` → `"move-file"`. Given a non-weaver command (`"mkdir -p /x"`, `"grep -rn foo src/"`, `""`) → `undefined`. The subcommand ends at the first whitespace and is returned verbatim (no normalisation). Laziest wrong impl: a regex that also matches `"renamed"` as `"rename"` — pin a boundary case (`"weaver renamer …"` → `"renamer"`, not `"rename"`) so the match is the whole token.

- [ ] **AC2 — `cannedToolResult(call, caseResults?)` resolves case-first and keeps every `weaver` stub weaver-shaped.** Resolution order:
  - `call.name === "bash"` **and** the command is a weaver invocation (`weaverSubcommand` returns a value): `caseResults[<sub>]` if defined → else the global weaver default for `<sub>` (the matching `eval/fixtures/<operation>.json` stub) → else **throw** `No weaver stub for subcommand "<sub>"`. It must **never** return `CANNED_RESULTS["bash"]` for a weaver call.
  - `call.name === "bash"` and *not* a weaver invocation: `caseResults["bash"]` if defined → else `CANNED_RESULTS["bash"]` (the generic file list).
  - any other tool: `caseResults[call.name]` if defined → else `CANNED_RESULTS[call.name]` → else throw (unchanged drift guard).

  Laziest wrong impl: check `caseResults` but fall through to `CANNED_RESULTS["bash"]` when a weaver subcommand has no entry — pin a test that an unmapped weaver subcommand *throws* rather than returning the file list, and that a plain `mkdir` bash call still returns the file list.

  *Sub-note:* the global weaver-default layer maps each weaver subcommand → its existing fixture, so an *unanticipated* weaver precursor a trial happens to try still gets a weaver-shaped response instead of throwing mid-run. `cases.ts` owns the camelCase-operation ↔ kebab-subcommand mapping (`operationToSubcommand`); the default map is built from the fixtures through it.

- [ ] **AC3 — a case can own its tool results, and the no-coords rename case converges.** `CaseEntry` gains `cannedResults?: Record<string, string>` (keys are weaver subcommands *or* tool names; values are the verbatim result strings). `trigger-refactor-rename-no-coords-sed-tempting` sets `cannedResults: { "search-text": <focused userId stub> }`, sourced from a new `searchText-userId.json` fixture returning only the `userId` match at `line 12, col 9`. The agentic lane threads `c.cannedResults` through `cannedResultForCall` → `cannedToolResult` in both the skill-trigger and boundary `it.each` blocks. Observable at the unit layer: for that case, a `bash` call of `weaver search-text '{…}'` resolves to the positional stub (not the file list). Convergence (the lane reaching a `weaver rename` call, previously 0/3) is verified manually via `pnpm eval trigger-agentic` — see Done-when.

## Interface

Internal eval-harness surface only — no shipped CLI/MCP/socket change.

- `weaverSubcommand(command: string): string | undefined` — new export in `eval/harness/assertions.ts`. Contains the first whitespace-delimited token after a `weaver`/`npx weaver`/`pnpm exec weaver` prefix. Bounds: any shell string; realistic ≤ a few hundred chars. Zero case: empty string → `undefined`. Adversarial: a command merely *containing* the word weaver mid-string (e.g. `echo weaver`) must not match — anchored at the start like `isAnyWeaverInvocation`.
- `cannedToolResult(call: ToolCall, caseResults?: Record<string, string>): string` — second parameter added; omitting it preserves today's behaviour for callers that pass no case map (except that a weaver bash call now resolves through the fixture-backed default rather than the `"bash"` entry). Return: a result string. Throws on an unmapped weaver subcommand or an unmapped non-bash tool.
- `CaseEntry.cannedResults?: Record<string, string>` — new optional field. Empty/absent is the common case (single-hop cases need no override). Keys not matching any call the case makes are inert.

## Open decisions

(none — resolution order, throw-on-unmapped-weaver, and the focused-fixture choice were decided during design.)

## Security

- **Workspace boundary:** N/A — eval harness only; reads fixture files under `eval/fixtures/` (repo-internal, fixed paths), writes nothing.
- **Sensitive file exposure:** N/A — fixtures are hand-authored stub JSON, no real file content.
- **Input injection:** `weaverSubcommand` parses model-produced command strings but only to *read* a token for map lookup; it never executes or interpolates them into a path or shell.
- **Response leakage:** N/A — canned results are author-controlled stub strings fed back to the model under test; no user secrets involved.

## Edges

- **Weaver-faithful-stub invariant (regression guard):** a `weaver <sub>` bash call must never receive `CANNED_RESULTS["bash"]`. A test asserts an unmapped weaver subcommand throws; a test asserts a plain non-weaver bash call still returns the file list. This invariant is recorded in `docs/eval-design.md` and as a comment at the resolver.
- **Single-hop cases unchanged:** cases whose expected weaver call is their *first* call still match and exit the loop before any result is fed back — they need no `cannedResults` and their behaviour must not change.
- **Boundary cases unchanged:** boundary (`expect.skill === "bash"`) cases issue only non-weaver shell commands; they continue to resolve to the generic file list and stay clean.
- **Drift guard preserved:** an unknown non-bash tool name still throws (existing `cannedToolResult` behaviour).

## Done-when

- [ ] All ACs verified by tests (AC1/AC2 unit; AC3 unit for wiring)
- [ ] `pnpm eval trigger-agentic -t rename-no-coords` shows the case converging on a `weaver rename` call (was 0/3) — record the observed rate in the Outcome section
- [ ] Mutation score ≥ threshold for `agentic-loop.ts` and `assertions.ts` (the touched source)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Docs updated:
      - `docs/eval-design.md` — record the weaver-faithful-stub invariant and the per-case `cannedResults` mechanism (one short paragraph, not narrative)
      - handoff.md current-state section — note `cannedResults` on `CaseEntry` and the scenario-owned resolution in the harness/cases descriptions
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Resolver carries a one-line comment stating the weaver-faithful-stub contract
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Not in scope

- **Grader rules** (read-only vs mutating competitors, shadowing metric, search/replace differentiator) — separate spec.
- **Two-step lane rebuild.** The two-step lane's degenerate `'{}'` seed stays as-is; it remains a documented false negative until it is retired or rebuilt on this infrastructure. No band-aid seed fix here.

## Outcome

**Shipped as infrastructure; the applied win was not delivered — and that was the point of verifying.**

The infrastructure landed and is correct: `weaverSubcommand` (AC1), `cannedToolResult(call, caseResults?)` with the weaver-faithful-stub contract and per-subcommand fixture defaults (AC2), `CaseEntry.cannedResults` + the no-coords `search-text` override + lane wiring (AC3). A review pass extracted the fixture helpers to `eval/harness/fixtures.ts` (removing a harness→cases import inversion against the `seed.ts` convention) and added a coverage guard that every operation has a default fixture (the defaults map loads them all at import).

**The applied win — the no-coords rename case converging — was falsified on the real Haiku lane.** Unit tests proved the wiring (the positional `search-text` stub is fed back), but the case stayed 0/3. Feeding back `line:col` is necessary, not sufficient. The real run exposed two independent blockers the spec's premise (inherited from the assertion-audit spike) missed:
- **A lossy plain-text echo** meant multi-hop trajectories never converged at all — root-caused and fixed in the follow-on bug spec [`20260711-agentic-loop-tool-exchange`](20260711-agentic-loop-tool-exchange.md).
- **Skill/grader (Finding B):** for a no-coords variable rename, Haiku picks `weaver-search-and-replace` (→ `replace-text`), not `weaver-refactor` (`rename`). Routed to the grader spec.

**Reflection:**
- *Verify the applied win on the real instrument before claiming it.* The unit layer confirmed the stub is fed back; only the hosted lane could confirm convergence, and it refuted the premise. The insistence on a real `pnpm eval` run (not just green units) is what caught it — a lesson worth carrying: an eval-infra change's *observable* claim lives on the model, not in the unit suite.
- *The premise came from a spike, and the spike was incomplete.* The assertion-audit attributed non-convergence solely to the missing `line:col`. It was one of three causes. A spike finding is a hypothesis until the fix is verified end-to-end.
- The weaver-faithful-stub invariant proved its worth immediately: once multi-hop worked, an unanticipated `find-references` hop still got a weaver-shaped (if scenario-incoherent) result rather than the file list. That incoherence is now its own tracked item.

**Tests added:** `test:eval` lane 243 → 276 (weaverSubcommand ×8; cannedToolResult resolution ×8; cannedResults wiring ×1; coverage guards, incl. per-operation fixture existence). **Mutation:** N/A — `eval/` is excluded from Stryker (`ignorePatterns` + src-only sandbox); mutation-aware unit tests + the hosted-lane run are the quality gate. Gap logged as a `[needs design]` handoff item.
