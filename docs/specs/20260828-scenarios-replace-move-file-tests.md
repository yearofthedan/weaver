# YAML scenarios replace the move-file engine tests

**type:** change
**date:** 2026-08-28
**tracks:** handoff.md # Decide whether YAML scenarios replace the move-file engine tests → docs/quality.md, docs/code-standards.md

---

## Context

The spike on `spike/approved-scenarios` put 23 scenarios in `src/operations/moveFile.scenarios.yaml` behind a runner that asserts two contracts per case: the exact response a consumer receives, and the complete set of file effects, where any file changed without being named fails the case. The decision to adopt the format is made. This change is the adoption: retire the integration tests the scenarios replace, keep the four whose inputs the format cannot build, and write down the format's rules — which currently exist only as working examples.

## User intent

*As a developer refactoring a TypeScript or Vue project with weaver, I want the move operation's behaviour pinned by cases that compare whole file content and the whole response, so that a rewrite which changes an import's meaning fails a test instead of shipping as `status: success`.*

The format's value is not that it finds what hand-written tests cannot. It is that the weak assertion is unavailable: the runner compares whole files because it has no way to do less, where `toContain` is a per-test choice an author makes — and in `moveFile_volarCompiler.test.ts:14` a reasonable-looking `toContain("utils/useCounter")` is what let a wrong `.js` specifier sit uncaught.

## Relevant files

- `src/operations/moveFile.scenarios.yaml` — 23 scenarios, 4 fixtures, 755 lines; the subject
- `src/__testHelpers__/scenarios/scenario-schema.ts` — `scenario` (line 96) declares `name`/`given`/`when`/`then` only; `fixtureBody` (line 4) declares `description`
- `src/__testHelpers__/scenarios/scenario-runner.ts` — `executeScenario`, `assertEffects`, `assertResponseMatches`; `resolveParams` (line 47) resolves every relative string as a path
- `src/ts-engine/move-file.test.ts` — 21 tests, 497 lines; 17 retire, 4 stay
- `src/operations/moveFile_tsMorphCompiler.test.ts` — 1 test (FILE_NOT_FOUND); retires whole
- `src/operations/moveFile_volarCompiler.test.ts` — 5 tests; retires whole
- `src/operations/moveFile.test.ts` — 4 mock-based unit tests; **untouched**, they test delegation and scope wiring, not engine behaviour
- `docs/quality.md` § Strategy — names unit and integration only
- `docs/code-standards.md` § Layer fit (line 57) — the rule's home

### Red flags

- **The move call graph is outside the default mutation run.** `stryker.config.mjs:22-24` comments out `src/ts-engine/**` and `src/operations/**`, so `pnpm test:mutate` never measures the files this change removes tests from. Only an explicit `--mutate` run does. The backstop below must be run deliberately; a green `pnpm check` says nothing about it.
- **The runner itself is outside mutation scope.** `stryker.config.mjs:30` excludes `src/**/__testHelpers__/**`, so the schema and runner changes in AC1 are not mutation-checked. They are covered by `scenario-schema.test.ts` and `scenario-runner.test.ts`; assert AC1 there.
- **Layer fit per AC.** AC1 is a pure function of its inputs — assert it in the runner/schema unit tests, not by adding a scenario. AC2 requires real project wiring and is measured by mutation, not by a new test.

## Value / Effort

- **Value:** A move that changes an import's meaning currently returns `status: success` with no type errors, because the assertion that would catch it was never written. Three such defects are open against the Vue path today. Whole-content comparison removes the authoring mistake that let them through, and makes a case cheap enough that thin areas get covered at all. Retiring the 23 superseded tests is what makes the format the one place move behaviour is stated rather than a second, weaker copy alongside it.
- **Effort:** Mostly subtraction. Three test files edited (two deleted), one YAML reordered, ~6 lines across schema and runner, three docs artifacts. No source change — no operation's behaviour moves. The risk sits entirely in the deletions, which the mutation backstop bounds.

## Behaviour

- [ ] Given a scenario carrying a `description`, the parsed scenario retains it (it is dropped today, because `scenario` does not declare the key and Zod strips unknown keys), and when that scenario fails an assertion the vitest failure message contains the description text. A schema field added without the runner surfacing it does not satisfy this line.
- [ ] Given the six files in the move call graph — `src/ts-engine/{move-file,rewrite-own-imports,rewrite-importers-of-moved-file,apply-rename-edits,after-file-rename}.ts` and `src/operations/moveFile.ts` — mutated with `--incremental false`, the score recorded after the deletions is no lower than the score recorded over the same six files before them. Every mutant killed before and surviving after is named individually, and each is either covered by a new scenario or written up with the reason it is accepted. An aggregate "still above threshold" does not satisfy this line.

## Structural criteria

- [ ] `src/operations/moveFile_tsMorphCompiler.test.ts` and `src/operations/moveFile_volarCompiler.test.ts` do not exist
- [ ] `src/ts-engine/move-file.test.ts` contains exactly these four tests, and no others:
      - `rewrites import in a file created after the project was loaded` (write between project load and call)
      - `rewrites imports when tsMoveFile is called with a symlinked workspace path` (symlinked root)
      - `does not throw ENOENT when moving a file that imports a previously-moved file` (two direct `getEditsForFileRename` calls, no `tsMoveFile`)
      - `does not throw ENOENT when git ls-files returns a file deleted by a prior move` (git index out of step with disk)
- [ ] In `moveFile.scenarios.yaml`, each TS scenario and the Vue scenario stating what its counterpart should have done are adjacent
- [ ] `docs/quality.md` § Strategy names the scenario layer alongside unit and integration
- [ ] `docs/code-standards.md` § Layer fit states when a scenario is the right layer and when a focused test is
- [ ] An internal skill (`metadata: internal: true`, matching `.claude/skills/investigate/SKILL.md`) carries the procedure and these three rules:
      - mutation parity is not a deletion criterion — a test whose mutants die elsewhere may still be the only place its input exists
      - a case needing setup the format refuses stays a focused test
      - `resolveParams` resolves every relative string as a path, so a method taking a literal string needs that contract settled before a second operation adopts the format

The fourth rule the handoff listed — that a scenario `description` is stripped — is deleted rather than documented, by AC1.

## Interface

No public surface changes. No CLI action, socket handler, response field, or error code is added or altered. The `description` key is test-harness surface: already written in the YAML by four scenarios, currently discarded.

- **What it contains:** free prose saying why the scenario exists — typically what the correct behaviour would be, for a case pinning something broken. Example: *"The TypeScript path follows the alias; the Vue scan matches only ./ and ../ specifiers, so it never considers this one."*
- **Bounds:** one to three sentences. Unbounded in the schema, deliberately — it reaches only a vitest failure message, never a response or a log.
- **Zero case:** absent. Optional, and the runner's failure message omits the line entirely rather than printing an empty one. Absent and empty-string need not be distinguished.
- **Adversarial case:** none reachable — the value is authored in a git-tracked test file, never user input, and never crosses a process or filesystem boundary.

## Open decisions

Both forks the handoff left open were settled before this spec was written:

- **Adopt the format, or delete the branch.** Adopt. The measured argument stands on the format removing a category of authoring mistake, not on out-finding hand-written tests — the three Vue defects it surfaced are, on inspection, mostly attributable to testing untested inputs rather than to the format.
- **How scenarios pinning known-broken behaviour are marked.** They are not. A `pins:` field was considered and rejected: the handoff entries owning those defects already name their scenarios, so the field would be the reverse of a link that exists, and it would have no users at all once the defects are fixed. Retaining and surfacing `description` (AC1) is the smaller change that carries the same information, and it serves every scenario rather than the transient few. **Watch for:** if a future defect cluster genuinely needs the set enumerated, that is when the field earns its way in — not before.

## Security

- **Workspace boundary:** N/A. No source path changes; no new code reads or writes files outside the runner's existing temp-root seeding.
- **Sensitive file exposure:** N/A. No new file content is read; `description` is authored text in a tracked test file.
- **Input injection:** N/A. `description` reaches a vitest failure message only. No new string parameter reaches the filesystem, a shell, or a path.
- **Response leakage:** N/A. No operation response is touched — this change removes tests and adds test-harness metadata.

## Edges

- Deleting a test file must not orphan a fixture or helper it alone imported — check `FIXTURES` usage after removing `moveFile_volarCompiler.test.ts`.
- The reorder must be a pure move: no scenario's `name`, `given`, `when` or `then` may change in the same commit, so the diff can be read as reordering rather than rewriting.
- The mutation baseline must be recorded **before** any test is deleted. Once the tests are gone the "before" number cannot be recovered without a checkout.
- `pnpm check` does not run mutation, and the default `pnpm test:mutate` excludes these six files. Neither is evidence for the backstop AC.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files, and the before/after comparison in the backstop AC is recorded in the Outcome
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated:
      - `docs/quality.md` § Strategy — scenario layer
      - `docs/code-standards.md` § Layer fit — scenario vs. focused test
      - new internal skill in `.claude/skills/`
      - handoff.md current-state section, and the test count in `docs/quality.md` § Coverage targets (23 tests retire; AC1 adds cases to the runner/schema unit tests, so state the measured net, not an assumed one)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
