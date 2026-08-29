# Split the scenario oracle from the executor

**type:** change
**date:** 2026-08-29
**tracks:** handoff.md # The scenario oracle is only reachable by driving a full dispatch → .claude/skills/scenario-tests/SKILL.md

---

## Context

The scenario runner is the shared oracle every scenario file trusts: if its comparison is wrong, every scenario can pass for the wrong reason. Its assertion functions — `assertEffects`, `assertResponseMatches`, the description-prefixing — are pure functions of (before tree, after tree, declared effects), but all 15 cases in `scenario-runner.test.ts` reach them only by seeding a real project and driving `moveFile` through `dispatchRequest`, then asserting on a substring of the failure message. That is the setup-proportionality smell in `docs/code-standards.md` (line 64), and it is why `parseScenarios` is exported for tests alone. A second operation (`get-type-errors`) is queued to adopt the format, so the shared piece gets settled before it does.

## User intent

*As a developer refactoring a TypeScript or Vue project with weaver, I want the harness that pins refactor behaviour to be verified directly, so that a regression a scenario pins stays pinned instead of passing for the wrong reason.*

## Relevant files

- `src/__testHelpers__/scenarios/scenario-runner.ts` — the file being split: `assertEffects` (57), `scrubRoot` (98), `assertResponseMatches` (107), `assertStepSucceeded` (120), `describeFailure` (131), `executeScenario` (137), `parseScenarios` (15)
- `src/__testHelpers__/scenarios/scenario-runner.test.ts` — the 15 cases being rewritten (283 lines)
- `src/__testHelpers__/scenarios/scenario-schema.ts` — `Effects` type, `expandResponseSugar`, `Scenario`/`ScenarioFile` types the e2e literals are written against
- `src/operations/moveFile.scenarios.test.ts` — the only consumer of `executeScenario`/`loadScenarios`; untouched
- `src/operations/moveFile.scenarios.yaml` — untouched; its green run is the regression guard
- `docs/code-standards.md` § Setup proportionality (line 64) — the smell this removes

### Red flags

- **The runner is outside mutation scope.** `stryker.config.mjs` excludes `src/**/__testHelpers__/**`, so `pnpm test:mutate` never measures the oracle. The Done-when run must be an explicit `--mutate` run with a scratch incremental file, per the `scenario-tests` skill — a green `pnpm check` says nothing about it.
- **Layer fit per AC.** AC1–AC4 are pure functions of their inputs — unit tests with literal trees, no fs. AC5 is wiring — one integration case per executor branch, no more.
- **Test hotspot.** `scenario-runner.test.ts` is 283 lines, under threshold; the rewrite replaces setup rather than adding to it, so no prep step.

## Value / Effort

- **Value:** An oracle bug currently costs a full ts-morph dispatch per probe to investigate, and surfaces as a confusing moveFile failure rather than a runner one. Direct testing makes the one piece every scenario trusts checkable with literal values in milliseconds, and a second adopter can extend the executor without re-proving the oracle through the stack.
- **Effort:** One module split, one test-file rewrite. No source change — no operation's behaviour moves. The risk is message-text drift, bounded by carrying the existing substring assertions over verbatim.

## Behaviour

- [ ] **AC1 — the oracle passes on a clean contract.** Given a before tree, an after tree, and `Effects` where every `moved` source existed beforehand and landed byte-identical or with its declared content, every `changed` file differs from before and matches its declared content, every `unchanged` file existed and was left alone, and no unnamed file differs — `assertEffects(before, after, effects)` returns without throwing. *(unit)*
- [ ] **AC2 — the oracle rejects the pinned violations.** Each of the nine effect violations currently pinned in `scenario-runner.test.ts` — an unclaimed modification, a claim that nothing happened, wrong `changed` content, a file listed `changed` but identical, a move whose declared destination is not where the file landed, a declared move whose source is still there, a file declared `unchanged` that was rewritten, an `unchanged` file never seeded, and a `moved` source that never existed — plus a `moved` entry whose declared content is not what landed (added after the targeted mutation run found the declared-content branch had no negative case) throws from `assertEffects` with a message containing the pinned text, given literal trees reproducing the violation. No seeded project, no dispatch. *(unit)*
- [ ] **AC3 — the response oracle is exact.** Given a written response block and the actual response already scrubbed of the temp root, `assertResponseMatches(written, actual)` passes when they are deep-equal after expanding the `typeErrors: none` sugar, and rejects with a `response:` failure each of the three pinned violations: a wrong field value, an omitted field the dispatcher returns, and a field the dispatcher never returns. *(unit)*
- [ ] **AC4 — the remaining pure functions are pinned directly.** `describeFailure` prefixes the description onto an `Error` and returns a description-less or non-`Error` value unchanged; `assertStepSucceeded` rejects an `error` status and passes `success` and `warn`. *(unit)*
- [ ] **AC5 — the wiring stays intact, proven by exactly five end-to-end cases** in `scenario-runner.test.ts` driving `executeScenario` against a real `dispatchRequest`: (a) a single-step scenario with a declared response passes, its paths reading workspace-relative — the temp root scrubbed; (b) a single-step scenario with a deliberately wrong expectation and a `description` fails with the description leading the message; (c) a multi-step scenario with no declared response passes when every step succeeds; (d) a multi-step scenario stops at a failing step, naming it; (e) a single-step scenario whose declared response is wrong fails on the response assertion even though every file effect holds. Cases (d) and (e) were added after the targeted mutation run: the three original cases left both conditional wiring branches in the executor (the step-status check in the loop, the declared-response assertion) unpinned end-to-end. *(integration)*

## Structural criteria

- [ ] `src/__testHelpers__/scenarios/scenario-oracle.ts` exists, exports `assertEffects`, `assertResponseMatches`, `assertStepSucceeded`, `describeFailure`, and imports nothing from `node:fs`
- [ ] The oracle's signatures take plain values: `(before: Tree, after: Tree, effects: Effects)` and `(written, actual)` — the executor reads the after-tree and scrubs the response before calling in
- [ ] `parseScenarios` is not exported from `scenario-runner.ts` and nothing outside that file imports it
- [ ] The oracle cases in `scenario-runner.test.ts` call the oracle functions directly with literal trees; only the five AC5 cases call `executeScenario`
- [ ] `moveFile.scenarios.test.ts` and `moveFile.scenarios.yaml` are byte-identical to before the change, and the scenario run is green

## Interface

No public surface changes. The oracle is test-harness surface; its consumers are `scenario-runner.ts` and `scenario-runner.test.ts`.

```ts
type Tree = Record<string, string>; // key: workspace-relative path, value: file content

assertEffects(before: Tree, after: Tree, effects: Effects): void          // throws on violation
assertResponseMatches(written: Record<string, unknown>, actual: unknown): void // actual already scrubbed
assertStepSucceeded(method: string, result: DispatchResponse): void       // throws on status "error"
describeFailure(error: unknown, description: string | undefined): unknown // returns the (possibly prefixed) error
```

- **What it contains:** `Tree` keys are relative paths (`src/utils.ts`), values full file content. `Effects` is the schema type with defaults applied. Failure messages are vitest assertion messages — the exact strings today's cases pin by substring.
- **Bounds:** fixture-sized trees — a few dozen files at most. Unbounded in principle; the oracle does set arithmetic and string comparison, nothing that degrades.
- **Zero case:** empty trees with empty `Effects` pass. An empty tree with any non-empty effect fails (the source-existence checks fire).
- **Adversarial case:** none reachable — inputs are authored in git-tracked test files, never user input, and never cross a process boundary.

## Open decisions

All three forks were settled with the user before implementation:

- **Module boundary: separate `scenario-oracle.ts` vs exported functions in `scenario-runner.ts`.** Separate file. The directory already splits schema from runner; this completes the triad (schema = shape, oracle = assertion, runner = wiring), and the no-fs boundary becomes visible in the imports rather than resting on tests alone. Consequence: the oracle module must never import `node:fs` — that is a structural criterion, and the queued `get-type-errors` runner work extends the wiring module, not the oracle.
- **Which end-to-end cases remain.** Three at speccing time, raised to five after the targeted mutation run (see AC5): happy path with response (pins scrubbing — wiring the oracle never sees), described failure (pins the try/catch wrapping — unit tests cover `describeFailure` the function, not its call site), multi-step sequence (pins the `when` loop and `assertStepSucceeded`, which today have no runner-level case at all — only the moveFile scenarios, where a loop bug would surface as a confusing moveFile failure), a failing step in a sequence, and a wrong declared response with correct file effects (pinning the two conditional wiring branches the first three left unexercised). Today's "no description" e2e case is dropped: its branch belongs to `describeFailure`, which AC4 covers.
- **Where `scrubRoot` lives.** The executor. The temp root is environment; the oracle compares already-relative values. Scrub behaviour stays pinned by AC5(a).

## Security

- **Workspace boundary:** N/A — test-harness code; the executor keeps the same fs reads/writes it has today, all under a temp dir the test owns. No new path reaches `isWithinWorkspace`-guarded code.
- **Sensitive file exposure:** N/A — inputs are literal trees authored in test files; no file content outside the temp fixture dir is read.
- **Input injection:** N/A — no new string parameter reaches the filesystem or shell; `resolveParams` and `seed` are unchanged.
- **Response leakage:** N/A — nothing here reaches a daemon response or log; failure messages stay inside vitest.

## Edges

- **Message text is preserved verbatim.** The substring assertions in today's cases carry over as written; a case pinning behaviour known to be wrong relies on its expectation reading as deliberate, and the description-prefix contract is what makes that legible.
- **The moveFile scenario run must not drift.** All 20 scenarios keep running through the same `executeScenario` entry point with no YAML edits — that run is the proof the split changed no behaviour.
- **The overlapping `[chore]` harness-cleanups entry** touches this file; this rewrite moots its `moveScenario` item. Trim that entry's description in the same session — do not fold the cleanups into this change.
- **Mutation is measured only by a targeted run** — `src/**/__testHelpers__/**` is outside Stryker's default scope.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `scenario-oracle.ts` and `scenario-runner.ts`, via a targeted `--mutate` run with `--incrementalFile` pointed at scratch (per the `scenario-tests` skill); every survivor classified
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`. If implementation pushes a file past threshold, extract per the test refactoring hierarchy (push down to units → decompose source) before marking this item done.
- [ ] Docs updated if public surface changed: none — test-harness surface only; the `scenario-tests` skill does not name the runner's exports
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
