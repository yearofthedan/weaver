**Purpose:** Current state, source layout, and prioritised next work items. Each task either links to a spec file (ready to implement) or is marked `[needs design]` (needs a `/spec` pass first).
**Audience:** Engineers implementing features, AI agents working on the codebase.
**Status:** Current
**Related docs:** [Why](why.md) (product rationale), [Commands](commands/) (per-command reference), [Internals](internals/) (implementation), [Specs](specs/) (task specifications)

---

# Handoff Notes

Context that isn't in the command or internals docs — things you need to know before picking up the work.

## Start here

**New to the codebase?** Read in this order:
1. [`docs/why.md`](why.md) — what this is and why it exists
2. [`docs/agent-users.md`](agent-users.md) — how agents differ from human users; read before speccing any feature
3. [`docs/internals/daemon.md`](internals/daemon.md) — understand the daemon and how the CLI connects to it
4. [`docs/architecture.md`](architecture.md) — compiler/operation architecture; read before touching anything in `src/`
5. [`docs/quality.md`](quality.md) — testing and reliability expectations

**Picking up a task?** Tasks have one of four states:
- **`[chore]`** → implementation is unambiguous; implement directly, no spec needed. Any decision context is in the task description. Use for deferred admin tasks (dependency bumps, doc edits, config changes, dead code removal). Inline refactors spotted during a session don't need an entry — apply them in a separate commit and move on.
- **`[needs investigation]`** → something is broken, root cause not yet confirmed. Run `/investigate` to reproduce the failure, observe the mechanism, and record a confirmed root cause, then route the fix to `/slice` or `/spec`.
- **`[needs design]`** → problem understood, solution not yet agreed. Run `/spec` to create a spec with the user before writing code.
- **Has a spec link** → already designed. Read the spec, then run `/slice`.

An agent discovering new work should add a `[needs design]` entry and move on — do not design it in the same session.

**Finishing a task?** The spec's Done-when section is the checklist. Key items:
1. Archive the spec to `docs/specs/archive/` with an Outcome section
2. Remove or update the entry below
3. Update docs if public surfaces changed (see Done-when in the spec)
4. Write gotchas to the relevant `docs/internals/` or `docs/tech/` doc; cross-cutting process rules go in `CLAUDE.md` (route by its "Where the rules live" table)

---

## Current state

Directory layout matches domain boundaries:

```
eval/
  harness/             ← eval harness: model client (callModel), context/skill/prompt builders, assertions + grading, the agentic loop, per-exposure trial assembly (case-lane.ts), sampling + escalation (run-case.ts), the gate verdict + per-model demotion (verdict.ts), and the multi-model run planner (gate-plan.ts); unit-tested in the test:eval lane. Gating roster (`GATING_MODELS` in config.ts): Haiku n=3, Gemini 2.5 Flash n=10, GPT-5.6-Luna n=10, all via OpenRouter — `pnpm eval:gate` runs all three and is what a skill edit must clear. Mechanics: [`eval-design.md`](eval-design.md)
  cases/               ← cases.ts conditioned case table (discriminated union on `exposure`: progressive | front-loaded | boundary; optional seed/cannedResults/momentumTurns/observational); one gate.llm.test.ts lane, `pnpm eval`-only; coverage.test.ts + cases.test.ts invariants run in pnpm check
  fixtures/            ← canned CLI stdout JSON keyed by operation name; embedded as tool results in seeded cases
  vitest.config.ts     ← test:eval lane (helpers + invariants, runs in pnpm check)
  # harness logic is mutation-tested via a dedicated lane: `pnpm test:mutate:eval` (stryker.eval.config.mjs / vitest.stryker.eval.config.ts, own incremental cache, CI job `mutation-eval`) — see docs/tech/mutation-testing.md
  vitest.llm.config.ts ← pnpm eval lane (LLM cases; globalSetup requires the hosted endpoint env vars)
  global-setup.llm.ts  ← fails fast requiring a hosted endpoint (WEAVER_EVAL_BASE_URL/MODEL/API_KEY) when unset
  README.md            ← operational runbook: setup, secret injection, run commands, diagnostic knobs
tsconfig.eval.json     ← typechecks eval/ (incl. the .llm.test.ts lane) via `pnpm typecheck:eval`, wired into pnpm check
tsconfig.test.json     ← typechecks src/**/*.test.ts (excl. src/__testHelpers__/fixtures/*/** scaffolds) via `pnpm typecheck:test`, wired into pnpm check
scripts/
  eval-gate.ts         ← `pnpm eval:gate` — spawns one `pnpm eval` per roster model, collects exit codes and costs; thin adapter over gate-plan.ts
.github/workflows/
  ci.yml               ← lint + build + test on push/PR
  quality-feedback.yml ← mutation testing (weekly + on push to main); Claude Code triage step on score < 75
.claude/skills/
  mutate-triage/       ← /mutate-triage skill: classify survivors, open issues for noise, fix PRs for fixable gaps
  weaver-search-and-replace/ ← shipped with npm; agent guidance for search-text + replace-text
  weaver-refactor/    ← shipped with npm; agent guidance for rename, move-file, move-directory, move-symbol, delete-file, extract-function
  weaver-code-inspection/    ← shipped with npm; agent guidance for find-references, get-definition, get-type-errors
src/
  adapters/
    schema.ts         ← Zod schemas + per-field descriptions + inferred arg types (used by dispatcher + CLI --help)
    cli/
      cli.ts          ← CLI entry point; registers daemon, stop, skills install commands + operation subcommands
      operations.ts   ← data-driven registration of 12 operation subcommands; SUBCOMMANDS table; renders --help from schemas
      install-skills.ts ← installSkills() pure copy/diff over FileSystem port + deriveSkillNamesFromPackageJson; backs `weaver skills install`
      classify-error.ts ← classifyDaemonError — maps socket error codes to DAEMON_STARTING / INTERNAL_ERROR
      classify-error.test.ts ← unit tests for classifyDaemonError
      security.integration.test.ts ← CLI workspace-security integration tests (boundary, traversal, injection)
  ports/
    filesystem.ts         ← FileSystem interface + barrel re-exports
    node-filesystem.ts    ← NodeFileSystem wrapping node:fs (production)
    in-memory-filesystem.ts ← InMemoryFileSystem Map-backed (unit tests)
    __testHelpers__/       ← filesystem-conformance.ts shared conformance test suite
    *.test.ts              ← colocated unit tests
  domain/
    workspace-scope.ts    ← WorkspaceScope boundary tracking + modification recording
    security.ts           ← validateFilePath(), isWithinWorkspace(), isSensitiveFile() — pure security policy (no node:fs)
    errors.ts             ← EngineError class + ErrorCode union
    *.test.ts              ← colocated unit tests
  daemon/
    daemon.ts                    ← thin runDaemon adapter (wires real process/net/fs, delegates to runLifecycle); promise-chain mutex; isDaemonAlive/removeDaemonFiles/stopDaemon/runStop; --verbose per-request logging
    lifecycle.ts                 ← runLifecycle: ordered startup behind FileSystem port + DaemonHost (onSignal/exit) seam — signal handlers installed before the daemon is discoverable; shutdown safe at any stage
    ensure-daemon.ts             ← ensureDaemon (build check + auto-spawn); callDaemon (socket client); spawnDaemon; forwards --verbose
    build-id.ts                  ← CLI_ENTRY + readBuildId (mtime of the built entry) + isSameBuild; daemons are reused only when running the build on disk
    logger.ts                    ← DaemonLogger: structured JSON log file, 10 MB cap, workspace-prefix stripping
    paths.ts                     ← socketPath, lockfilePath, logfilePath, ensureCacheDir
    validate-workspace.ts        ← validateWorkspace(path, fs) — boundary workspace existence/dir/restricted-root check
    dispatcher.ts                ← dispatchRequest; OPERATIONS table; re-exports registry functions
    post-write-diagnostics.ts    ← getTypeErrorsForFiles — post-write type error enrichment for dispatcher
    language-plugin-registry.ts  ← LanguagePlugin registry; makeRegistry; invalidateFile/invalidateAll; registers built-in Vue plugin
    watcher.ts                   ← startWatcher(root, extensions, callbacks); chokidar + 200ms debounce
    *.test.ts                    ← colocated unit tests
    *.integration.test.ts        ← colocated integration tests
  plugins/
    vue/
      plugin.ts         ← createVueLanguagePlugin(); Vue/Volar LanguagePlugin factory (project detection, lifecycle)
      engine.ts         ← VolarEngine: implements Engine; delegates TS work to TsMorphEngine; scans .vue files for imports
      get-type-errors.ts ← vueGetTypeErrorsForFile + vueGetTypeErrorsForProject + vueGetTypeErrorsFromService — standalone actions
      scan.ts           ← updateVueImportsAfterMove + removeVueImportsOfDeletedFile + updateVueNamedImportAfterSymbolMove
      service.ts        ← buildVolarService() — Volar service factory
      *.test.ts         ← colocated unit tests
  operations/
    rename.ts          ← rename(engine, filePath, line, col, newName, scope: WorkspaceScope)
    findReferences.ts  ← findReferences(engine, filePath, line, col)
    findImporters.ts   ← findImporters(engine, filePath) — "who imports this file?"; returns {fileName, references[]}
    getDefinition.ts   ← getDefinition(engine, filePath, line, col)
    getTypeErrors.ts   ← getTypeErrors(engine, file?, scope: WorkspaceScope) — errors-only, cap 100; thin validation wrapper delegating to engine
    moveFile.ts        ← moveFile(engine, oldPath, newPath, scope: WorkspaceScope)
    moveDirectory.ts   ← moveDirectory(engine, oldPath, newPath, scope: WorkspaceScope)
    moveSymbol.ts      ← moveSymbol(tsEngine, projectEngine, sourceFile, symbolName, destFile, scope: WorkspaceScope)
    extractFunction.ts ← extractFunction(tsEngine, file, startLine, startCol, endLine, endCol, functionName, scope: WorkspaceScope)
    searchText.ts      ← searchText(pattern, scope: WorkspaceScope, { glob, context, maxResults }) — no utility exports
    replaceText.ts     ← replaceText(scope: WorkspaceScope, { pattern, replacement, glob } | { edits })
    deleteFile.ts      ← deleteFile(engine, file, scope: WorkspaceScope) — delegates to engine.deleteFile()
    types.ts           ← result types for all operations (RenameResult, MoveResult, FindReferencesResult, etc.)
    *.test.ts          ← colocated unit tests
  ts-engine/
    types.ts              ← Engine + LanguagePlugin + EngineRegistry interfaces; SpanLocation, DefinitionLocation, FileTextEdit
    engine.ts             ← TsMorphEngine: project cache, LS accessors, delegates to standalone action functions
    get-type-errors.ts    ← tsGetTypeErrors(): TS-only type error collection; exports toDiagnostic + MAX_DIAGNOSTICS — standalone action
    delete-file.ts        ← tsDeleteFile(): delete file, remove importers, invalidate cache — standalone action
    move-file.ts          ← tsMoveFile(): edits + physical move + project graph update + fallback scan — standalone action
    move-directory.ts     ← tsMoveDirectory(): batch edits + OS rename + non-source files — standalone action
    after-file-rename.ts  ← tsAfterFileRename(): project graph update + own-import rewrite + fallback scan; called by tsMoveFile and tsMoveDirectory
    rename.ts             ← tsRename(): resolve offset, get locations, apply edits, boundary-filter, write via scope — standalone action
    extract-function.ts   ← tsExtractFunction(): TS Extract Symbol refactor, name substitution, cache invalidation — standalone action
    move-symbol.ts        ← tsMoveSymbol(): compiler work for moveSymbol (symbol lookup, AST surgery, import rewriting)
    symbol-ref.ts         ← SymbolRef — resolved exported symbol value object (lookup, unwrap, remove)
    throwaway-project.ts  ← createThrowawaySourceFile(): in-memory ts-morph project for one-off AST parsing
    import-rewriter.ts    ← ImportRewriter — rewrites named imports/re-exports of a moved symbol across files
    rewrite-own-imports.ts ← rewriteMovedFileOwnImports — adjusts a moved file's own relative specifiers
    rewrite-importers-of-moved-file.ts ← rewriteImportersOfMovedFile — rewrites external importers after a file move
    apply-rename-edits.ts ← applyRenameEdits — applies TS LS rename edits; called by tsMoveFile and tsMoveDirectory
    remove-importers.ts   ← tsRemoveImportersOf(): remove all import/export declarations referencing a deleted file
    __testHelpers__/      ← mock-compiler.ts (makeMockCompiler) shared test helper
    *.test.ts             ← colocated unit tests
  utils/
    text-utils.ts      ← applyTextEdits(), offsetToLineCol()
    file-walk.ts       ← walkFiles() + walkWorkspaceFiles() + SKIP_DIRS + TS_EXTENSIONS + VUE_EXTENSIONS
    globs.ts           ← compileGlob() — validate + brace-expand a glob into a path predicate; globToRegex() per-pattern translation
    ts-project.ts      ← findTsConfig, findTsConfigForFile, isVueProject, resetDiscoveryCaches (per-dispatch memo reset)
    *.test.ts          ← colocated unit tests
  cli-workspace-default.integration.test.ts ← asserts --workspace defaults to process.cwd() for daemon and stop
  __testHelpers__/
    helpers.ts        ← shared test utilities (readFile, fileExists, PROJECT_ROOT); re-exports fixtureTest
    process-helpers.ts ← subprocess spawning utilities
    fake-daemon.ts    ← fake daemon script for protocol tests
    fixtures/
      fixtures.ts  ← fixtureTest (dir + seedNamedFixture + seedInlineFixture) — no standalone copyFixture export
      simple-ts/   ← minimal TS project scaffold (and 9 others: vue-project, cross-boundary, etc.)
```

**Commands shipped:** see [`docs/commands/README.md`](commands/README.md) for the full command index.

---

## Next things to build

Priorities run top to bottom. Complete a tier before starting the next. 
**IMPORTANT**: Priority is the only thing that matters. Skipping an item without a design is a failure. If a priority item needs design, spec it. 

---

### P3 — Medium-value features / bugs / tech debt

- **Model real host-prompt inertia in the gate's clutter** `[needs design]` — the gate wraps every task in `buildClutterSystemPrompt()` (a generic weaver-free crowded prompt) plus a shell-momentum seed. But the inertia a skill must actually beat is set by the *real* host system prompt — e.g. Claude Code's "prefer the dedicated file/search tools over shell commands." A generic clutter tests skills against invented pressure, not what they face in deployment. Design: fold representative real-host system-prompt patterns into the clutter (or behind a flag) so the gate measures whether skills overcome the true inertia. Caveat: "prefer dedicated tools" is ambiguous in the front-loaded exposure (bash is the only tool) — validate it changes behaviour before adopting, don't assume it helps. Connects to the skill-design principle in `docs/skill-design.md`. The [package-framing spike](specs/archive/20260807-weaver-is-a-shell-command-framing.md) is the closest prior work — it showed one real deployment fact the gate did not model was worth four cases, which is the argument for modelling the host prompt too.

- **Eval suite never tests whether an agent picks a symbol-specific weaver skill over a generic search default** `[needs design]` — observed directly in a live `/slice` session in this repo (2026-08-09), not simulated. Asked to find every caller of an exported symbol (`makeRegistry`), the agent pattern-matched the task as "broad codebase exploration" and spawned a generic grep-based Explore subagent instead of recognising it as a symbol-reference lookup and reaching for `weaver-code-inspection`'s `find-references` — despite that skill's own description stating "use instead of grep... for a symbol's usages." After being told to use weaver directly, the agent still didn't load the skill file first: it invoked `weaver find-references --file ... --line ... --col ...` from memory (guessed per-field flags, which don't exist — the CLI takes one JSON-blob positional arg), and only found the correct syntax by then reading `--help` after the call failed. Two distinct, separately-testable gaps: (1) does the model route a task phrased as generic exploration to the specific tool a skill already claims coverage for, when a generic subagent/grep is also a plausible reading; (2) does the model consult a loaded skill's documented interface before its first invocation of the CLI it covers, rather than invoking from memory and self-correcting only after a failure. Design: whether (1) fits the existing exposure/case table (e.g. a boundary case that asks for symbol callers without naming weaver or the skill) or needs a new case dimension; whether (2) is measurable in the current harness at all — it captures tool calls, not whether a skill's content was read before the first covered-CLI invocation, so this may need a harness change to track skill-load-before-first-use ordering rather than just call presence.

- **`dispatcher.test.ts`'s "dispatches X and returns Y shape" tests can't catch a happy path turning into an error** `[needs design]` — surfaced by mutation testing while fixing the `getTypeErrors`/Vue routing bug (`docs/tech/mutation-testing.md`'s `dispatcher.ts` L287 entry): `"dispatches findReferences and returns references shape"` and `"dispatches getDefinition and returns definition shape"` both assert `if (result.status === "success") { expect(result).toHaveProperty(...) } else { expect(result).toHaveProperty("error") }` — a branch that passes regardless of which side fires, so it can never catch a bug that turns a valid in-workspace call into a spurious error (confirmed: forcing `WorkspaceScope.contains()`'s result to always-false at `dispatcher.ts:287` survives mutation testing specifically because of this pattern). Likely repeats across the file's other `"dispatches X and returns Y shape"` tests. Design/scope: audit every test using this pattern in `dispatcher.test.ts`, replace with a fixture/input known to succeed and assert `status === "success"` directly (or a known-bad input asserting the specific error), rather than branching on the actual result.

- **`vueGetTypeErrorsForProject`'s `_probe.ts` synthetic-path trick duplicates the fix just applied to `makeRegistry`** `[chore]` — `src/plugins/vue/get-type-errors.ts:97-99` fabricates a non-existent `<workspace>/_probe.ts` path purely so `VolarEngine`'s private `getService(filePath)` (`src/plugins/vue/engine.ts:47`), which internally calls `findTsConfigForFile(filePath)`, resolves to the workspace-root tsconfig instead of searching one level too high — the exact same directory-vs-file bug just fixed directly in `makeRegistry` (see the spec above), worked around here instead of fixed. It currently works (not broken), so this is cleanup, not a bug fix. Mechanical shape, following the established pattern: widen `getService`'s `filePath` parameter to `string | undefined` (mirroring `makeRegistry`), resolve via `findTsConfig(this.workspaceRoot)` when absent, and drop the synthetic path plus its two callers' need for a fake filename (`cacheKey`'s `path.dirname(filePath)` fallback and `buildVolarService`'s anchor-file argument both need checking for what they actually require when there's no real file). Not folded into the `getTypeErrors` fix: touches a different class's private method and its call sites, a larger surface than that fix's scope.

---

### P4 — Low priority (cheap hygiene; clear opportunistically)

- **`pressured-buried-rename` sits below the floor — weak skill text, or a worn-out case?** `[needs investigation]` — the rate has never settled: **5/10** (Haiku, 2026-07-26), **11/12** at the 2026-07-24 routing spike, **8/10** forcing the old `WEAVER_EVAL_TEMPERATURE=0.7`, **8/10** again on a fresh re-run (2026-08-03, default temperature), and **6/10** on 2026-08-07 under the new package-framing section — the one case in the suite that framing did not move. The failures are `no attempt`: the model loads the right skill, explores with `grep`/`search-text`/`find-references`, and never calls `weaver rename` inside the 6-step budget. The 2026-08-07 trails sharpen the shape: in all four misses the model *does* call `weaver search-text`, gets the answer, and then re-confirms it with `grep`/`cat` before running out of budget — while the `weaver-refactor` body carries an explicit instruction not to (*"Do not `grep`, `cat`, or re-open the file to re-confirm the match"*). So a distrust-the-result reflex is beating a line written to stop it, which is a separate question from the burial confound below. Cross-model check on the same 2026-08-03 run: Gemini 2.5 Flash 9/10 (1 no-attempt), GPT-5.6-Luna 10/10 clean — so the weakness concentrates on the gate model but isn't absent elsewhere. The case carries a known confound: its own definition in `cases.ts` notes the burial is carried by the task's trailing "note anything else that looks inconsistent while you're in there" clause, which is exactly the pattern `eval-design.md`'s anti-gaming doctrine flags as gating the metric on a side-step rather than the tool call itself — so the measured rate may reflect that clause's pull more than the `rename` skill text. Further measurement of the case *as currently written* is low-value for that reason. `pressured-buried-search-text` — identically shaped — was already deleted from the gate for the same knife-edge pattern.

- **Lane-aware `/mutate-triage` + eval CI auto-triage** `[needs design]` — `/mutate-triage` is hardcoded to the src lane (`reports/mutation/mutation.json`, `pnpm test:mutate`, `reports/stryker-incremental.json`). The eval mutation CI job (`quality-feedback.yml` `mutation-eval`) therefore has no auto-triage-on-failure step — a naive mirror would triage the src lane from the eval job. Parameterise `/mutate-triage` by lane (the three paths above + the run command switch), then add the failure-gated triage step (with a `permissions: { id-token: write, contents: write }` block) to the eval job, mirroring the src job. Design call: lane as a skill arg (`/mutate-triage eval`) vs. two thin wrapper skills vs. auto-detecting from which report exists.

- **The harness charges for probing and never pays the dividend** `[needs design]` — models emit `weaver --help` and `command -v weaver` unprompted (confirmed model-native: the probes persisted after the `--version` example that was suspected of causing them was removed). In deployment that probe returns real help and the agent proceeds better informed — one wasted step, once. In the lane it returns `NEUTRAL_WEAVER_RESULT` (`"No results for this call."`) or the generic bash file list (`eval/harness/agentic-loop.ts:13-28`), so it costs a step out of six and teaches nothing. The lane therefore penalises exploratory behaviour that is close to free in the real world, and a rate drop caused by probing is weaker evidence than the same drop caused by a `grep` fallback. Design: whether `weaver --help`/`<sub> --help` should return real CLI help text (it is generatable from the schemas, which already back `--help`), and whether that makes the lane more realistic or merely more forgiving. Do not act on it as a scoring correction without checking whether it changes any recorded rate.

- **`replace-text` rejects `glob`/`excludeGlob` combined with `edits`** → [spec](specs/20260809-replace-text-surgical-glob-validation.md) — extends `ReplaceTextArgsSchema`'s refine to fail with `VALIDATION_ERROR` instead of silently ignoring the glob in surgical mode.

- **Reviewable implementation plan before dispatch** `[needs design]` — `/slice` step 3 decomposes ACs into dispatch steps entirely inside the orchestrator's head. That decomposition is a real design act (it decides what each commit can test), but it is invisible until something goes wrong: the `excludeGlob` slice merged a seam change with its consumers, leaving every AC test green on first run ([archived spec](specs/archive/20260807-exclude-glob-search-replace.md)). The *Split seam from adoption* rule now catches that specific case; the general gap is that no step list gets reviewed before agents run. Design: whether the plan is a written artifact with its own review checkpoint, or the orchestrator simply states the step list in-conversation before dispatching. Weigh a durable, reviewable list against another file to maintain per slice — the value is the checkpoint, not the document, and a small slice may not earn either. Start by trying the stated list and see whether reviews catch anything.

- **Surgical-mode edits are only tested at line 1** `[chore]` — mutation on `src/operations/replaceText.ts` (2026-08-07, 78.13%) reports no coverage for the offset `reduce` at line 157 and the out-of-range `throw` at line 153. Both are reachable: the `reduce` callback only fires when `lineIdx > 0`, and the throw only on an out-of-range line. Every surgical test therefore edits line 1 of its file and none passes a bad line number. Add two cases — an edit on a later line (proving the offset accumulation) and an out-of-range line asserting `TEXT_MISMATCH`. The multi-edit comparator at line 146 is covered but its ordering mutant survives, so that assertion needs to discriminate order too.

- **Promote `command-get-type-errors` off observational** `[needs design]` — it was demoted on a Haiku "tsc reflex" at 3/5 and now sits at **20/20** on Haiku, 10/10 on Gemini and Luna, so the lane prints "at ceiling — consider promoting" on every run. Once [the multi-model gate](specs/20260808-multi-model-eval-gate.md) scopes its marker to Haiku, Haiku sits at the per-model cap of 2 demotions and any new one fails the invariant — so this slot is worth reclaiming. Design call: promote outright, or re-measure first given the demotion reason (a `tsc` fallback) is the reflex the package-framing change most plausibly fixed.

- **`isProgressiveOpCase`/`isBoundaryCase` mutants survive the case-table tests** `[chore]` — a scoped mutation run on `eval/cases/cases.ts` leaves both predicates killable-in-principle but unkilled: `isProgressiveOpCase` always returning `true` still passes the trigger-coverage tests, because those tests filter again by `c.expect.skill === "..."` and the extra cases get filtered back out. Pre-existing, unrelated to the multi-model gate work that surfaced it. Fix by asserting the predicate's own partition (every case classifies as exactly one of progressive-op / boundary / front-loaded) rather than only using it as a filter.

- **`isVueProject` enumerates every file in the program to answer a yes/no question** `[needs design]` — it calls `ts.parseJsonConfigFileContent` and then asks whether *any* resulting filename ends in `.vue`, so it pays for a full file enumeration (0.2–1.3 ms, measured on this repo 2026-08-09 — the 1.3 ms case is weaver's own tsconfig) to answer "is there at least one `.vue` in the include set". That was free when the result was memoised for the daemon's lifetime; it is now paid once per dispatch ([archived spec](specs/archive/20260809-daemon-discovery-cache-invalidation.md)). Still small against a ~520 ms end-to-end CLI call, so this is a cost-reduction task, not a regression. Design: whether the include/exclude globs can be tested for `.vue` membership without building the file list, and what that costs in fidelity to tsconfig semantics. Do not resolve this by widening the cache's lifetime — that reintroduces the silent-stale-routing bug the spec fixed.

- **Global test setup's eager import makes half the codebase unmockable** `[chore]` — `src/__testHelpers__/test-cleanup.ts` statically imports `invalidateAll` from `language-plugin-registry.js`, which pulls in `ts-project.js` and its dependencies at setup time, before any test file's hoisted `vi.mock` can register. ES bindings lock in at first evaluation, so those modules keep their real `node:fs` / `typescript` references and a spy on them observes zero calls — a silent wrong answer, not an error. Fix: import lazily inside the `afterEach` callback so the module is evaluated after the test file's mocks register. Cheap and low-risk — `test-cleanup.ts` is referenced only by `vitest.config.ts`'s `setupFiles`, and the Stryker sandbox config (`vitest.stryker.config.ts`) sets no `setupFiles` at all, so a dynamic import here cannot affect mutation coverage attribution. Verify by spying on `fs.existsSync` from a test of any module downstream of `language-plugin-registry.js` and asserting the call count is non-zero.

- **`VolarLanguageService` hand-typed interface** `[chore]` — `src/plugins/vue/compiler.ts` manually narrows the TS LanguageService surface used by the Vue compiler; an upstream signature change can compile but fail at runtime. Replace with `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>` for compile-time safety. May fall out naturally during further Volar refactoring.

- **Consolidate `WEAVER_VERBOSE` env var into flag-only** `[needs design]` — the daemon has both a `--verbose` CLI flag and a `WEAVER_VERBOSE` env var that do the same thing. The env var exists because auto-spawn can't pass CLI flags, but `ensureDaemon` could forward `--verbose` to `spawnDaemon` directly. Consolidate to flag-only and remove the env var.

- **ts-morph long-term continuity risk (native/Go `tsc` transition)** `[needs design]` — no action possible yet; watch item. `@ts-morph/common@0.29.0` bundles a private, frozen copy of TS's classic compiler (`typescript.js` reports `version = "6.0.2"`), which is why it's unaffected by TS 7 removing the classic API from the host `typescript` package (see the now-closed [PR #188](https://github.com/yearofthedan/weaver/pull/188) investigation) — but that also means ts-morph will not gain any TS language feature shipped after 6.0.2 unless it's ported to whatever API Microsoft exposes for the native Go compiler. Per [ts-morph#1621](https://github.com/dsherret/ts-morph/issues/1621), maintainer dsherret is doubtful ts-morph continues past this transition: the new API will be IPC-based (cross-process, since the compiler is now Go, not in-process JS) and deliberately curated rather than comprehensive (per [microsoft/typescript-go#455](https://github.com/microsoft/typescript-go/discussions/455)), which he calls a "massive task" he may not have bandwidth for. The typescript-go team has said keeping ts-morph working is "an anti-goal to prevent," but nothing concrete has shipped — no newer `ts-morph`/`@ts-morph/common` release exists beyond what weaver already pins (28.0.0 / 0.29.0). No design work is possible until either Microsoft ships a concrete API or ts-morph/Volar commit to a direction. Revisit when either happens.

---

### P5 — Features & speculative (pull when demanded)

**Eval-confidence chain (API-gated).** Per [`docs/eval-design.md`](eval-design.md), the gate is `instrument × simulated`: Haiku movement is assumed to predict the real audience, and only an occasional Sonnet run checks that assumption.

- **Harnessed end-to-end — real host + real bash + file-state** `[needs design]` — run the skill through a real agent host (not the API) executing real `weaver` commands against a live daemon, asserting on file state. Before building, evaluate Anthropic's `skill-creator` skill ([github.com/anthropics/skills](https://github.com/anthropics/skills)) — it already does with/without runs, output grading, and description optimization via subagents. Host: Claude Code headless gives real execution but a weak tool-call trail (file-state inference only); **opencode** is open-source and likely exposes the trail directly — evaluate as the alternative host. Subsystem-sized; gated (API + real execution; Ollama JSON-drop reappears for emission).

- **`moveSymbol` for non-exported functions** `[needs design]` — `moveSymbol` returns `SYMBOL_NOT_FOUND` for unexported helpers. Supporting them requires deciding whether to auto-export at the destination, what happens if the function is private and still used in source, and how to handle the case where source calls the now-exported helper. Spec separately.

- `createFile` `[needs design]` — scaffold a file with correct import paths

- **`moveBlock`: move a contiguous code block between files** `[needs design]` — Move a block of code (e.g. a `describe(...)` block in a test file) from one file to another by line range: `moveBlock(sourceFile, startLine, endLine, destFile, insertAfterLine?)`. The block is self-contained — no callers to update, no reference graph involved. Main challenges: (1) import carrying — identify which imports the moved block uses, add missing ones to the destination; (2) import cleanup — remove now-unused imports from the source (ts-morph `organizeImports`); (3) insertion point — default is append to end of file. Primary use case: reorganising large test files by moving `describe` blocks without manual cut/paste + import fixup.

- **Per-host skill format adaptation for `weaver skills install`** `[needs design]` — `--dir` lets the installer write skills to a non-Claude location, but it copies `SKILL.md` verbatim. Hosts with a different rule format (Cursor `.mdc`, Windsurf) won't consume it. A `--host` preset that rewrites the frontmatter/layout per target host would close the multi-host gap. Deliberately out of scope for the initial installer (the initial command solves *location*, not *format*).

- **Explore uses for ts-morph `printStructure`** `[needs design]` — ts-morph 28 ships a standalone `printStructure(structure)` function that serialises a structure object back to TypeScript source. Potential directions: a `generateFromStructure` tool that lets agents produce scaffolded code from a JSON description, or a read-side `readStructure` that extracts a node's structure for inspection/diffing. Investigate what agent workflows this could enable before committing to an interface.

- **`--dry-run` / rollback** `[needs design]` — add `--dry-run` flag to CLI operation subcommands that previews what would change without writing. Requires daemon-level support (compute-only mode that returns edits without applying them). Multi-file operations have no all-or-nothing guarantee; documented precondition (clean git working tree) is workable for now. Agents already have git as their undo mechanism. Revisit if non-git workflows emerge.

- **Workspace split: `app` + `tooling` (evals)** `[needs design]` — move the `eval` scripts plus related tests into a tooling project; keep app unit tests and mutation testing with app initially; define dependency ownership and migration steps that preserve CI and publish flows

- **Watcher own-writes redundant invalidation** `[needs design]` — The daemon's own writes emit FS events that fire `invalidateFile`/`invalidateAll` ~200ms after the write, by which time the operation has already invalidated. Safe (no correctness issue, mutex-serialised), but if a second call arrives within the debounce window, the next `getEngine()` pays a cold rebuild. Sketch: maintain a skip-set of paths the daemon just wrote, drain after a grace period; populated and drained inside the mutex so no concurrency guard needed. Design choice: grace-period length, drain trigger.

- **Stryker survivors on `schema.ts` module-level constraints** `[needs design]` — `src/adapters/schema.ts` is module-level Zod schema declarations. After adding `replaceText` refine tests it scores ~64% (not the ~1% an earlier run reported — that measurement was wrong), and the refine (runtime-function) mutants are killable by tests, so a blanket "ESM static-mutant, unkillable" explanation does NOT hold. The real puzzle: a cluster of module-level *constraint* mutants survive despite tests that should catch them — e.g. removing the `^` anchor from the `newName` identifier regex survives even though a test asserts `"1invalid"` is rejected (which should fail under that mutant). Needs hands-on investigation: run one such mutant in isolation and inspect whether the mutated schema is actually constructed when a static mutant is active under the vitest runner. Once understood, options: targeted `ignoreStatic`, restructure to factory functions so constraints evaluate per-call, or accept and document. Do not chase the threshold meanwhile — `pnpm check` does not run mutation.

- **Action hook registry for plugin composition** `[needs design]` — Currently VolarCompiler implements every Engine action method by manually composing "call TS action, then do Vue cleanup." A registry pattern where plugins register pre/post hooks per action (e.g. Vue plugin registers a post-moveFile hook that scans `.vue` imports) would make composition declarative. Not needed with one plugin, but the manual approach won't scale to two. Revisit when a second plugin (Svelte, Angular) is on the horizon.

- **`moveSymbol` for class methods** — extract a method to a standalone exported function. Deferred: the only safe subset (static methods / no-`this` instance methods) doesn't update call sites, so it always leaves broken code. Without call-site rewriting, the value over manual `searchText` + `replaceText` is low. Revisit if call-site rewriting becomes tractable.

- **`inlineVariable` / `inlineFunction`** — less common refactoring pattern; complex to implement safely

- **CLI `--interactive` selection mode** `[needs design]` — interactive confirmation workflow for `replace-text` (present matches one-by-one like `git add -p`). Human-friendly; not useful for agents. Requires TTY detection and incremental confirmation loop.

- **CLI human-friendly flag interface** `[needs design]` — add `--flag` aliases for JSON params on CLI subcommands (e.g. `weaver rename --file src/a.ts --line 5 --col 3 --new-name bar`). Syntactic sugar that constructs the same JSON. Layers on top of the JSON interface without breaking it.

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue compiler works around TypeScript's refusal to process `.vue` files. Read this before touching `src/plugins/vue/engine.ts`.

---

## Where to find architecture detail

Each concern has a dedicated doc. Read those — don't rely on handoff for design specifics.

| Topic | Doc |
|-------|-----|
| Agent user characteristics — design constraints for tool interfaces | [`docs/agent-users.md`](agent-users.md) |
| Skill-body design — designing skill descriptions and body structure | [`docs/skill-design.md`](skill-design.md) |
| Compiler/operation architecture, dispatcher design, `CompilerRegistry` | [`docs/architecture.md`](architecture.md) |
| Daemon lifecycle, auto-spawn, socket protocol, `DAEMON_STARTING` | [`docs/internals/daemon.md`](internals/daemon.md) |
| Vue compiler internals, virtual↔real path translation, `toVirtualLocation` | [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Implementation gotchas (`workspace` convention, Volar quirks, etc.) | [`docs/architecture.md`](architecture.md), [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Task specifications (ready and archived) | [`docs/specs/`](specs/) |
