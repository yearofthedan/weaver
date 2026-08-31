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
    daemon.ts                    ← thin runDaemon adapter (wires real process/net/fs, delegates to runLifecycle); promise-chain mutex; isDaemonAlive/removeDaemonFiles/stopDaemon/runStop; --verbose per-request logging. The socket handler serialises whatever dispatchRequest returns and owns only PARSE_ERROR
    lifecycle.ts                 ← runLifecycle: ordered startup behind FileSystem port + DaemonHost (onSignal/exit) seam — signal handlers installed before the daemon is discoverable; shutdown safe at any stage
    ensure-daemon.ts             ← ensureDaemon (build check + auto-spawn); callDaemon (socket client); spawnDaemon; forwards --verbose
    build-id.ts                  ← CLI_ENTRY + readBuildId (mtime of the built entry) + isSameBuild; daemons are reused only when running the build on disk
    logger.ts                    ← DaemonLogger: structured JSON log file, 10 MB cap
    paths.ts                     ← socketPath, lockfilePath, logfilePath, ensureCacheDir
    validate-workspace.ts        ← validateWorkspace(path, fs) — boundary workspace existence/dir/restricted-root check
    dispatcher.ts                ← dispatchRequest: total, returns DispatchResponse (discriminated on status); OPERATIONS table; sole producer of the error contract — maps EngineError to a response and attaches a capped, workspace-stripped stack on INTERNAL_ERROR; re-exports registry functions
    post-write-diagnostics.ts    ← getTypeErrorsForFiles — post-write type error enrichment for dispatcher
    serialise-response.ts        ← serialiseResponse — JSON line for the socket, with a fallback envelope when a response cannot be stringified
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
    scenarios/
      scenario-schema.ts ← zod schema for the YAML scenario format + expandResponseSugar + resolveFixture
      scenario-oracle.ts ← pure assertions: assertEffects/assertResponseMatches/assertStepSucceeded/describeFailure (no node:fs)
      scenario-runner.ts ← executor: seed → dispatchRequest loop → read tree → oracle; loadScenarios/executeScenario
    fixtures/
      fixtures.ts  ← fixtureTest (dir + seedNamedFixture + seedInlineFixture) — no standalone copyFixture export
      simple-ts/   ← minimal TS project scaffold (and 9 others: vue-project, cross-boundary, etc.)
```

**Commands shipped:** see [`docs/commands/README.md`](commands/README.md) for the full command index.

---

## Next things to build

Tiers run top to bottom. Complete a tier before starting the next.
**IMPORTANT**: Priority is the only thing that matters. Skipping an item without a design is a failure. If a priority item needs design, spec it.

Tiering asks one question: **what does this change make possible, or prevent?** A user gap prevents a specific failure. A structural change can make a whole class of work reachable, or a class of defect visible — so a refactor competes on the same axis rather than pleading its case as debt. A change that makes nothing possible and prevents nothing ranks below a small user win however tidy it is.

---

### Must

Something else is waiting on it, or a user is hitting the failure now.

These came from using weaver on real work, where a gap costs a user something.

- **A `.ts` file importing an SFC always reports TS2307** `[needs design]` — [spec](specs/20260831-ts-file-importing-sfc-ts2307.md): reproduced 2026-08-31 with no refactor involved, and the routing confirmed as the driver. `VueEngine.getTypeErrors` (`src/plugins/vue/engine.ts:380-385`) sends anything that is not `.vue` to the ts-morph engine, which has no `.vue` support; a direct probe shows the Volar service the same engine already holds resolves the identical import cleanly, and flipping only that one line drops the error to zero. Affects the project-wide form too, since `vueGetTypeErrorsForProject` merges the ts-morph whole-project result. Pinned meanwhile by `repoints aliased importers of a moved SFC` in `moveFile.scenarios.yaml`. Needs `/spec` because the fix has forks: route `.ts` through Volar (correct-shaped, but changes diagnostics for every `.ts` file in a Vue project and needs the project-wide path restructured) versus teaching ts-morph to resolve `.vue` specifiers.

- **A solution-style root `tsconfig.json` disables the Vue plugin for the whole workspace** `[needs design]` — **Observed 2026-08-31** in a real Vue app whose root `tsconfig.json` is `{"files": [], "references": [...]}`: `get-type-errors` on any `.vue` file returns `INTERNAL_ERROR — Could not find source file`, thrown from `TsMorphEngine`, and `@/`-aliased imports of plain `.ts` modules report TS2307. **Confirmed by probe:** `ts.parseJsonConfigFileContent` on that config yields 0 `fileNames` and no `paths`, so `isVueProject` (`src/utils/ts-project.ts:56`) returns `false` and the Vue plugin never engages — and the ts-morph project it falls back to is empty and alias-blind. Project references are the default layout `create-vue` scaffolds, so this is the common shape, not an exotic one. Decide whether detection and project loading should follow `references` into the referenced configs, scan for `.vue` on disk independently of the tsconfig file list (`buildVolarService` already does the latter for its own file set), or something else. Found while investigating the TS2307 entry above; it is a separate defect and must not be folded into that fix.

- **`filesModified` can name a path that no longer exists** `[needs investigation]` — **Observed:** moving `tests/utils.test.ts` to `tests/unit/utils.test.ts` returns `filesModified: ["tests/utils.test.ts", "tests/unit/utils.test.ts"]`, and the source is gone from disk. A same-depth rename, where the importer rewrite touched nothing, returns the destination alone. Both are pinned by scenarios in `src/operations/moveFile.scenarios.yaml`. `docs/commands/move-file.md:36` promises the array holds "the moved file itself plus every file whose imports were rewritten", so a consumer iterating it to re-read the files it names hits ENOENT on the first entry — and `checkTypeErrors` runs post-write diagnostics over this same array. **Theory, not isolated:** the importer rewrite writes the moved file at its old path and records it before the physical rename, so the old path enters `scope.modified` and nothing removes it. Reproduce, isolate which write records it, then decide: suppress the source path once the move completes, record against the destination, or filter the array to paths that exist. The last is the weakest — it hides a wrong entry instead of not producing it.


- **The lane's canned `Read` result is a one-line stub** `[needs design]` — `CANNED_RESULTS.Read` in `eval/harness/agentic-loop.ts` returns `export function authenticate(userId: string) { /* ... */ }`, so `boundary-bash-remove-console-log` asks the model to delete a `console.log` on line 15 of a file with one line and no `console.log`. Trials flail after the reach (`nl -ba`, `python3` existence checks), making trails hard to read. Blocks two Must items: the over-trigger entry below, and the symbol-lookup case, which needs `line: 1` not to be trivially correct. **The fork is scope, not content:** no case overrides `Read` today (`cannedResults` is only ever keyed to `search-text`), so every case that reads gets this string — changing it lane-wide can move rates across the whole table and would need a re-baseline, which is the objection already recorded against lane-wide seams. Case-scoped `cannedResults` overrides avoid that but leave the stub wrong for every other case. Decide which before writing the fixture.

- **A description edit perturbs unrelated skills' front-loaded cases — cause unknown** `[needs investigation]` — three different wordings of one skill's description each cost Haiku ~8 of 24 trials on `command-move-file`/`move-directory`/`move-symbol`/`search-text`, cases that do not use that skill. Front-loaded exposure already has every body in the user turn, so a description edit should be semantically inert there. Harm was indifferent to whether a negative clause was present or how it was scoped, which a semantic explanation would have to move. Isolating probe: a length-matched, meaning-preserving rewrite of the same clause — if Haiku still drops to ~15/24 it is perturbation or length, and no wording of that clause is shippable. ~$0.9 for both arms at n=6. This gates every future skill-description edit, not just the over-trigger one.

- **A skill description claims a single-line edit weaver should decline** `[needs design]` — Luna calls weaver to delete a one-line `console.log` at a known position, 0/10 clean on `boundary-bash-remove-console-log` since 2026-08-01. Spiked 2026-08-30 ([findings](specs/20260830-single-edit-over-trigger-spike.md)) — **the fix exists and is not shippable**. Three wordings took the case to 8–10/10 on Luna; every one cost Haiku ~a third of four front-loaded cases (13–16/24 vs controls of 23/24 and 24/24). Two corrections to the original framing: the pull is on the **search** half (all ten baseline trials ran `search-text` to locate the line; none ever tried `replace-text`), and the reach happens at the `Skill` load before any file is read, so only the description can move it. Blocked on the two items below — fix the canned `Read` stub first, then settle whether the Haiku harm is meaning or perturbation. Do not retry a wording before both are done.

- **No operation changes a symbol's visibility** — [spec](specs/20260830-set-export.md): a `set-export` operation, both directions, un-export guarded by an external-reference check. Its ts-engine action is the primitive the `moveSymbol` auto-export decision should reuse when that item is specced.

- **A symbol lookup without coordinates loses to generic search — reproduced, needs a fix and a gating case** `[needs design]` — spiked 2026-08-11 ([rates and method](eval-baselines.md#2026-08-11--spike-does-the-lane-see-a-generic-search-win-over-a-symbol-lookup)). Asking for a symbol's callers **without a line/col** drops Gemini to **1/10** against its own 10/10 comparator; adding the host's agent roster plus a callable delegation tool takes it to **0/10**, with 8 of 10 trials handing the task to a subagent on turn one and never loading the skill. Haiku and Luna hold at 10/10 throughout, so this is Gemini-only on current text. The original hypothesis — that *exploration phrasing* routes the model away from the skill — is a measured null on all three models; the driver is the missing coordinates, and delegation is an amplifier that only bites once they are gone. Mechanism: with no position in hand the task reframes as exploration, and `weaver-code-inspection`'s body offers no way back — it documents only the `line`/`col` form and never says how to obtain a position, so the model answers from `grep`/`Read` or invents a symbol-name API (`find-references '{"file": …, "symbol": "authenticate"}'`). Three decisions: (a) whether the skill body gains a documented symbol-name → position path (the content gap this exposed) or the CLI accepts a symbol name directly, which overlaps the `--flag` interface item below; (b) whether the durable case ships with the delegation affordance set — the spike's `delegationAffordance` seam is case-scoped for the baseline reason, and lane-wide would invalidate every recorded rate; (c) the case cannot ship until the lane's generic `Read` result is a coherent multi-line file, since a one-line stub makes `line: 1` correct and lets an invented-API call false-pass a `file`-only `keyArgs`. The second gap the live session showed — invoking the CLI from memory before reading the skill — is **not measurable in the progressive exposure**: a `firstWeaverStep`-vs-`readTurn` probe over 90 trials found zero pre-load invocations, because the skills block is the only channel by which the lane's model learns weaver exists. Measuring it needs an exposure where weaver is known independently of the skill.

---

### Should

Real gains that nothing else is blocked on.

The eval items lead. The instrument drifts faster than the skill text changes ([2026-08-16](eval-baselines.md#2026-08-16--luna-re-baseline-the-model-moved-the-lane-did-not)), so a small rate movement is as likely to be the provider as the product. Apply a decision test before any paid run: if the result cannot change something that ships, do not run it.

- **Luna earns its roster slot on the boundary cases, or comes out** `[needs design]` — the 2026-08-16 re-baseline put every *gating* Luna cell at 10/10 against unchanged lane code, so Luna can no longer go red for a skill edit; its only live signal is the two demoted boundary cases. It costs a full sweep per gate run to measure nothing. Options: promote the boundary cases (which reds the gate immediately at 0/10 — that is the point, but it blocks every skill edit until the descriptions are fixed, so it sequences after the over-trigger item in Must), drop Luna to an occasional drift check, or replace it with a model that still discriminates. Note the roster exists because a single model's green does not imply a green audience — removing Luna re-opens that risk.

- **Decide whether the gate adopts the Claude lean** `[needs design]` — spiked 2026-08-12 ([rates and method](eval-baselines.md#2026-08-12--spike-does-real-host-prompt-inertia-beat-the-lanes-invented-clutter)); the arm ships behind `WEAVER_EVAL_HOST_CLUTTER=1`, non-gating. The spike's premise — that the real host prompt is *harder* pressure than the lane's invented clutter — **inverted**. On `pressured-buried-rename`, the only case with headroom, Claude Code's tool-use policy scored **9/10 against 7/10**, and shell re-confirm calls fell **5 → 1**: its "avoid `cat`/`head`/`sed` in the shell" line suppresses the very reflex that eats that case's step budget. Six ceiling-bound Gemini cases moved nothing (58/60 → 59/60) and could not have. **The effect only reaches models that have the reflex**: Haiku shows 5 shell re-confirm calls and moves, Gemini near zero and barely moves, Luna zero and does not move at all — its boundary trails are identical across arms. So host clutter is also *not* a fix for Luna's two demoted boundary cases (0/10 → 0/10, 1/10 → 1/10), which was the one place a real anti-shell prompt might have paid for itself. Three decisions: (a) whether the gate adopts host clutter as its default pressure, accepting that it is *more forgiving* on the one discriminating case and that every rate in the baseline table needs re-measuring; (b) whether to accept the **Claude lean** — a gate shaped by one host's prompt, with Cursor/Windsurf/opencode getting whatever generalises; (c) whether the shell-command caveats belong in the `bash` tool description (where the real host puts them) rather than the system prompt, which is location as its own untested variable. Before (a), isolate the driver: an arm carrying only the `cat`/`head`/`sed` line would show whether that one sentence is doing all the work. Connects to the skill-design principle in `docs/skill-design.md`.

- **Lane-aware `/mutate-triage` + eval CI auto-triage** `[needs design]` — `/mutate-triage` is hardcoded to the src lane (`reports/mutation/mutation.json`, `pnpm test:mutate`, `reports/stryker-incremental.json`). The eval mutation CI job (`quality-feedback.yml` `mutation-eval`) therefore has no auto-triage-on-failure step — a naive mirror would triage the src lane from the eval job. Parameterise `/mutate-triage` by lane (the three paths above + the run command switch), then add the failure-gated triage step (with a `permissions: { id-token: write, contents: write }` block) to the eval job, mirroring the src job. Design call: lane as a skill arg (`/mutate-triage eval`) vs. two thin wrapper skills vs. auto-detecting from which report exists.

- **`schema.ts` is outside the default mutation run, and its surviving mutants are not understood** `[needs design]` — two halves of one problem. **Scope:** `stryker.config.mjs`'s `mutate` array excludes `src/adapters/schema.ts` entirely, on the grounds it was purely declarative field definitions. `ReplaceTextArgsSchema` now chains two `.refine()` predicates (mode XOR, glob-with-edits) — real branching logic a bare `pnpm test:mutate` never measures; only an explicit `--mutate src/adapters/schema.ts` run does (as used to verify the glob-with-edits refine, see [archived spec](specs/archive/20260809-replace-text-surgical-glob-validation.md)). **Survivors:** under that scoped run it scores ~64%, and the refine mutants *are* killable — so a blanket "ESM static-mutant, unkillable" explanation does not hold. The puzzle is a cluster of module-level *constraint* mutants that survive tests which should catch them: removing the `^` anchor from the `newName` identifier regex survives even though a test asserts `"1invalid"` is rejected. Investigate the survivors first — run one mutant in isolation and check whether the mutated schema is actually constructed when a static mutant is active under the vitest runner — because the answer decides the scope call. Options once understood: bring the file into default scope, split the refines into a non-declarative module already in scope, narrow the array to the refine lines, or targeted `ignoreStatic`. Do not chase the threshold meanwhile — `pnpm check` does not run mutation.

- **Promote `command-get-type-errors` off observational** `[needs design]` — it was demoted on a Haiku "tsc reflex" at 3/5 and now sits at **20/20** on Haiku, 10/10 on Gemini and Luna, so the lane prints "at ceiling — consider promoting" on every run. Once [the multi-model gate](specs/20260808-multi-model-eval-gate.md) scopes its marker to Haiku, Haiku sits at the per-model cap of 2 demotions and any new one fails the invariant — so this slot is worth reclaiming. Design call: promote outright, or re-measure first given the demotion reason (a `tsc` fallback) is the reflex the package-framing change most plausibly fixed.

- **`filesSkipped` does not currently mean anything a consumer can act on** `[needs design]` — the field is on five operations' responses and is populated two incompatible ways. In the refactor paths (`import-rewriter.ts:32`, `rename.ts:57`, `move-symbol.ts:138`, `extract-function.ts:51`, `remove-importers.ts:58`, `rewrite-importers-of-moved-file.ts:69`, `apply-rename-edits.ts:17`, Vue equivalents) it records `!scope.contains(filePath)` — outside the workspace boundary. In `searchText.ts:60` and `replaceText.ts:88` it records a `readFile` throw — an unreadable file. Meanwhile the *most common* declines are not recorded at all: `isSensitiveFile` and `isBinaryContent` both `continue` without calling `recordSkipped`. And when workspace and tsconfig root coincide — the normal invocation — every file the language service returns is under root, so the array is always empty, which is why no test observes it non-empty. **What it is guarding is real:** run weaver from `packages/app` in a monorepo whose program reaches `packages/shared`, rename an exported symbol, and the out-of-boundary references are never written; `filesSkipped` is the only thing in the response contradicting `status: success`. That is the same structurally-invisible shape as the Vue aliased-import defect — a file weaver declined to write is a file the post-write type check never inspects. Prior art does not help directly: an IDE has no user-drawn box narrower than the program, so it never half-renames. The boundary here exists for security (`docs/security.md`), and a security rule clipping a refactor is exactly when to be loud. Design: (a) make it coherent — one meaning, and decide whether a non-empty array should drive `status: warn`, since a partial refactor is at least as warn-worthy as a lingering type error; (b) remove the field and carry the incomplete-refactor signal some other way (warn status, distinct error code) — removal on its own would make the monorepo case fully silent; (c) whichever way, **bound the output** — the array has no cap where `diagnostics` has `MAX_DIAGNOSTICS`, and recording every sensitive or binary decline would make it unbounded on a large repo, so the actionable set is "files that would have been written but weren't", not "files weaver passed over". See `docs/agent-users.md` on bounded output.

- **`get-type-errors` never resolves a relative `file` argument** `[needs design]` — `SUBCOMMANDS`'s entry declares `pathParams: []` (`adapters/cli/operations.ts:64`), so `resolveRelativePaths` skips the `file` param and the raw relative string reaches the engine. `weaver get-type-errors '{"file": "src/utils.ts"}'` — the exact form documented in `docs/commands/get-type-errors.md` — returns `FILE_NOT_FOUND: src/utils.ts` from any cwd, including the workspace root; only an absolute path works. Found while investigating the project-wide throw (2026-08-29) and confirmed against the built CLI. `search-text` declares `pathParams: []` too, so check whether it has the same gap or genuinely takes no path. Design: whether the fix is one declaration entry per command or the declaration should be derived from the schema, since it already exists twice (`SUBCOMMANDS` and `daemon/dispatcher.ts:71`) and the scenario runner keeps a third copy — see the `resolveParams` item below.

- **One throw in `handleSocketRequest` permanently wedges the daemon** `[needs design]` — requests are serialised with `queue = queue.then(() => handleSocketRequest(…))`. A rejection leaves `queue` permanently rejected, so every later `.then()` short-circuits and no further request on any connection is answered; Node's default `--unhandled-rejections=throw` then takes the process down. [The dispatch-response spec](specs/archive/20260823-total-dispatch-response.md) removes the reachable path through response serialisation, leaving `logger.log` and `socket.write` as the remaining throw sources. Design: whether the chain gets a `.catch()` that resets it, whether the mutex should be a structure that cannot be poisoned, and how either is tested without asserting on unreachable code.

- **Project-cache coherence rides on the post-write type check repairing it by accident** `[needs design]` — `tsAfterFileRename` evicts the moved file's old entry from the cached ts-morph project (`after-file-rename.ts:23-26`) so a later call in the same daemon session computes edit offsets against text that still matches disk. Remove that eviction and a second move splices the import into nonsense — `"../src/utilsutils"` — but only when `checkTypeErrors: false`. On the default path the diagnostics pass calls `getLanguageServiceForFile` over every modified file, which reloads it and resyncs the project as a side effect, hiding the fault in both the response and the workspace. Isolated 2026-08-24 by flipping only that param: with it off a two-move scenario detects five of the seven mutants in that branch, with it on none of them. Nothing is broken today — the eviction is present and both paths are correct. The problem is that a repair nobody declared sits behind an option callers may switch off, so a refactor of the diagnostics path can silently un-fix sequential moves. Design: whether the move should own cache coherence explicitly, whether a diagnostics pass should be mutating compiler state at all, and what holds the uncompensated path.

- **Move `get-type-errors`'s project-wide cases to the scenario format** `[needs design]` — direction agreed 2026-08-29, only the runner work is open. The bug fixed that day was invisible because all seven project-wide tests built `TsMorphEngine` with no `workspaceRoot`, disabling the file walk that produces it; a scenario file has no construction in it, so that entire failure class cannot occur. It is also a stronger assertion: the runner deep-equals the whole response where the focused tests check three fields and would miss a status regression, and `then.files` pins that a read-only operation wrote nothing — which no test checks today. Proven to work: a review pass wrote a throwaway scenario for the project-wide case and ran it, passing with the fix and failing with the guard removed against the exact `INTERNAL_ERROR` response. **Do not move the `file`-argument cases.** The runner resolves every relative string param while the CLI resolves only declared ones, and `get-type-errors` declares `pathParams: []` — so a scenario for `{"file": "src/foo.ts"}` would pass while the real CLI returns `FILE_NOT_FOUND`, hiding the sibling bug logged above instead of catching it. Those cases stay focused tests until `resolveParams` is settled. Open: how much runner work a second operation needs, since `when` currently only handles `moveFile`'s shape and a read-only method returns diagnostics rather than file effects — nobody has read `scenario-runner.ts` to size this yet.

- **`resolveParams` is a third copy of the CLI's path resolution** — folded into [the set-export spec](specs/20260830-set-export.md) as its seam AC: the runner resolves only the dispatcher's declared path params, removing the gotcha the `scenario-tests` skill currently documents. Residual once that ships: collapsing the `SUBCOMMANDS`/`OPERATIONS` declaration copies, tracked under the *get-type-errors scenarios* entry.
- **The scenario harness is load-bearing but sits under the global mutation exclusion** `[needs design]` — the runner is the shared oracle every scenario file trusts, with its own schema, its own tests, and a second adopter queued (`get-type-errors`), yet `stryker.config.mjs:30` (`!src/**/__testHelpers__/**`) keeps its comparison logic out of the default run — measured only by targeted `--mutate` runs (as the oracle-split spec's Done-when does). Two questions, one entry: whether the harness joins the default mutation scope — and shaped how, since the exclusion covers fixtures and plumbing too, where mutants are mostly noise, so the carve-out would name `src/__testHelpers__/scenarios/**` or just the oracle/schema files — paying a red run until survivors are triaged, the same dynamic the `scan.ts` entry above names for `plugins/**`; and whether the harness's home is honest — it has outgrown "test helper", but it shares the main test lane (no own vitest config or run command), so a move out of `__testHelpers__` would be naming without lane substance until a second adopter lands. Makes sense after the oracle split ships, since that change defines the module a scope decision would name.

- **`moveDirectory` still leaves an SFC's aliased import pointing at the old location** `[needs design]` — the sibling of [the moveFile fix](specs/archive/20260829-vue-sfc-alias-imports.md), scoped out of it 2026-08-29 once the cost turned out to be different in kind. `moveFile` takes the SFC half of a rename from the Volar service, which resolves `@/*`, `baseUrl` and `exports` maps because it is the compiler. `moveDirectory` cannot reuse that as-is: `engine.ts:285` filters its mappings to `.vue` files before querying Volar, so a `.ts` file moving inside a directory goes to `this.tsEngine.moveDirectory` and never reaches the Vue edit path at all. Repairing it means one Volar query per moved file, not one per operation — measured at ~734 ms on a warm service, scaling with project size rather than directory size, so a 20-file directory move gains roughly 15 seconds. Design: whether that cost is paid outright, or gated on the narrowing in the entry above (only pay when some SFC holds a non-relative specifier), which for `moveDirectory` is what makes the cost bearable rather than a nicety. Reproduce with a scenario mirroring `repoints an SFC's aliased import when the composable it names moves`, moving `src/composables` instead of the file — one was written and removed when the scope changed.

- **A Vue `moveFile` writes importers before the operation that can still fail** `[needs design]` — `vueMoveFile` (`plugins/vue/move-file.ts`) applies the SFC import edits, then calls `tsMoveFile`, which computes its own edits, writes them, and only then renames. A throw anywhere in that second half — a `WORKSPACE_VIOLATION` from its `applyRenameEdits`, a failing `scope.fs.rename` — leaves importers naming the destination while the file is still at the source, which is the half-applied state `docs/architecture.md` principle 6 (compute before mutate) exists to prevent. Raised by review 2026-08-29. Writing importers before the rename is the pre-existing shape — `tsMoveFile` has always done it, and `moveDirectory` has the same ordering — so this widens an existing window rather than opening a new one. The obvious repair does not work: applying the SFC edits *after* the move breaks a moved SFC's own imports, whose edit has to land at the old path before the rename (pinned by `rewrites a moved SFC's own relative import` in `moveFile.scenarios.yaml`). Design: whether the move flow separates compute from apply across both engines, and what happens to an edit naming the file being moved. Sequencing with the `filesModified` defect is worth checking — both come from the same edit landing at the old path.

- **A Vue-project `moveFile` pays a full Volar service build even when no SFC could be affected** `[needs design]` — measured 2026-08-29 while speccing [the alias fix](specs/20260829-vue-sfc-alias-imports.md), on this repo at 262 TS/JS files: `buildVolarService` 1035 ms cold, `getEditsForFileRename` 734 ms on a warm service, against 22 ms for the `walkFiles([".vue"])` the regex scan pays today. `moveFile` calls `this.invalidateService(oldPath)`, so nothing stays warm across successive moves. The cost was accepted deliberately — correctness through the compiler beats a pattern matcher that cannot be made complete — and it lands only on projects `isVueProject` says contain `.vue` files, so no TS-only project is affected. The narrowing available: the scan already walks and reads every `.vue` file, so one pass over content it has already loaded says whether any SFC contains a non-relative specifier at all. If none do, the relative-only path the scan handles correctly is the whole story and the service is never built; if any do, the whole job goes to the compiler. The trigger is "is there anything here I cannot be sure about", not "is this an alias", so it does not reintroduce the pattern-matching problem. Review added a second lever 2026-08-29: `moveFile` evicts the service it just built three lines later (`invalidateService`), so N sequential moves under one tsconfig pay N full builds. Swapping the moved file's keys in `vueVirtualToReal`, `scriptFileNames` and the `scripts` registry would update it in place — the same incremental-over-full-invalidation argument `docs/internals/move-file.md` already makes for the ts-morph side, which names Volar as caching by path but leaves it doing the full drop. Design: whether that probe is worth its own code path, or whether TypeScript's native port lands first and makes the number small enough to ignore. Do not narrow by classifying specifiers.

- **`updateVueImportsAfterMove` may be redundant once `moveFile` routes through Volar** `[needs design]` — [the alias fix](specs/20260829-vue-sfc-alias-imports.md) deliberately leaves the regex scan (`plugins/vue/scan.ts:20`) in place: once the Volar edits land the old specifier is gone, so the scan matches nothing and is inert on the fixed cases, and removing it would have meant re-proving every existing relative-import scenario through the new path inside that change. **The first evidence is already in.** Mutation testing `plugins/vue/engine.ts` after the fix (2026-08-29) leaves the `updateVueImportsAfterMove(...)` call in `moveFile` as a survivor: deleting the call outright breaks none of the 9 tests covering that line. For `moveFile` the scan is doing nothing. The same instrument answers the rest — re-measure `plugins/vue/scan.ts` with `pnpm test:mutate:file` and compare against the 2026-08-28 run, which recorded `updateVueImportsAfterMove` and `rewriteImports` as that file's two clean functions; mutants killed then and surviving now say nothing exercises the scan any more. The answer is still not obviously yes: it still covers any `.vue` file `buildVolarService` fails to register, and a Vue project with no tsconfig builds a service with empty `compilerOptions`. Design: what evidence justifies the deletion, and whether the same argument reaches `updateVueImportsAfterSymbolMove` and `removeImportLines`, which no compiler path covers at all. Sequences after the alias fix ships.

- **`scan.ts`'s other functions are unmeasured, and reach `node:fs` directly** `[needs design]` — measured for the first time on 2026-08-28 (`plugins/**` is commented out of `stryker.config.mjs`'s `mutate` array, so `pnpm test:mutate` never covers it): **73.94%, 35 survivors and 2 mutants with no covering test at all**. `updateVueImportsAfterMove` and `rewriteImports` are clean; the survivors sit in `removeImportLines` (17, at lines 183/194/197) and `rewriteVueOwnImportsAfterMove` (14, at 231/236/240/257/262). One uncovered mutant empties the `if (!scope.contains(vueFile))` workspace-boundary guard, which nothing exercises. The 6 survivors at line 236 are the `fs.existsSync` chain — the same ambient I/O the Vue import work already flagged as a port violation — so both problems have one fix: routing those checks through `scope.fs` makes the branches reachable with `InMemoryFileSystem` instead of a real temp tree. Design: whether these functions get the same treatment `rewriteImports` got (delegate the specifier rule to the TypeScript path rather than pattern-match a second time), and whether `plugins/**` joins the default mutation scope, which would red the run until the survivors are triaged.

- **Scenario harness cleanups found in review** `[chore]` — three small ones, none behavioural. `seed()` (`scenario-runner.ts`) is line-for-line `seedInlineFixture`'s body (`__testHelpers__/fixtures/fixtures.ts`); extract a shared `writeFiles(dir, files)`. The `a-utils-module-with-importers` fixture re-inlines `src/utils.ts` verbatim instead of `extends: a-utils-module`. And `readTree` keys on `path.relative` while `scrubRoot` splits on `` `${root}/` ``, so every scenario fails on Windows — loudly, not silently, but worth deciding whether the lane is meant to run there. (The fourth item — the described-scenario case rebuilding the whole YAML scaffold — was mooted by the oracle split: the case now builds a `Scenario` literal.)

- **`status: warn` is never exercised** `[chore]` — no test in the suite asserts the `warn` status a mutating operation returns when the files it modified still carry type errors. It is a consumer-visible response field with real branching behind it: `warn` is computed from `typeErrorCount` in `dispatchRequest`. Add coverage at the dispatcher layer with a fixture whose modified file has a deliberate type error. (The `filesSkipped` half of this entry became its own design item above — do not add coverage for a field whose meaning is unsettled.)

- **Git-dependent file discovery is documented for one command out of seven** `[chore]` — `walkFiles` shells out to `git ls-files --cached --others --exclude-standard` inside a repository and falls back to a recursive readdir outside one (`file-walk.ts:34`), so whether a workspace is a git repo changes which files a refactor can see. Inside one, gitignored files are invisible: an importer under an ignored path keeps a stale import after a move, and nothing in the response reports it. That path backs `moveFile`, `moveDirectory`, `moveSymbol`, `rename`, `findImporters`, `deleteFile` and the Vue scans, but the only places it is written down are `docs/commands/search-text.md`, `docs/internals/search-text.md` (both scoped to search) and one row of `docs/architecture.md`. The README does not mention git at all. Audit which behaviour is git-dependent, state it once where a user will find it, and cross-reference from the affected command docs. Respecting `.gitignore` is deliberate — it is the set a developer expects touched — so this is a documentation gap, not a behaviour change.

- **`isVueProject` enumerates every file in the program to answer a yes/no question** `[needs design]` — it calls `ts.parseJsonConfigFileContent` and then asks whether *any* resulting filename ends in `.vue`, so it pays for a full file enumeration (0.2–1.3 ms, measured on this repo 2026-08-09 — the 1.3 ms case is weaver's own tsconfig) to answer "is there at least one `.vue` in the include set". That was free when the result was memoised for the daemon's lifetime; it is now paid once per dispatch ([archived spec](specs/archive/20260809-daemon-discovery-cache-invalidation.md)). Still small against a ~520 ms end-to-end CLI call, so this is a cost-reduction task, not a regression. Design: whether the include/exclude globs can be tested for `.vue` membership without building the file list, and what that costs in fidelity to tsconfig semantics. Do not resolve this by widening the cache's lifetime — that reintroduces the silent-stale-routing bug the spec fixed.

- **Global test setup's eager import makes half the codebase unmockable** `[chore]` — `src/__testHelpers__/test-cleanup.ts` statically imports `invalidateAll` from `language-plugin-registry.js`, which pulls in `ts-project.js` and its dependencies at setup time, before any test file's hoisted `vi.mock` can register. ES bindings lock in at first evaluation, so those modules keep their real `node:fs` / `typescript` references and a spy on them observes zero calls — a silent wrong answer, not an error. Fix: import lazily inside the `afterEach` callback so the module is evaluated after the test file's mocks register. Cheap and low-risk — `test-cleanup.ts` is referenced only by `vitest.config.ts`'s `setupFiles`, and the Stryker sandbox config (`vitest.stryker.config.ts`) sets no `setupFiles` at all, so a dynamic import here cannot affect mutation coverage attribution. Verify by spying on `fs.existsSync` from a test of any module downstream of `language-plugin-registry.js` and asserting the call count is non-zero.

- **Consolidate `WEAVER_VERBOSE` env var into flag-only** `[needs design]` — the daemon has both a `--verbose` CLI flag and a `WEAVER_VERBOSE` env var that do the same thing. The env var exists because auto-spawn can't pass CLI flags, but `ensureDaemon` could forward `--verbose` to `spawnDaemon` directly. Consolidate to flag-only and remove the env var.

---

### Could — features & speculative (pull when demanded)

- **A non-TS project may be a real boundary for the compiler-backed ops** `[needs design]` — `boundary-bash-search-non-ts-project` was retired on 2026-08-30 because `search-text` is legitimately language-agnostic ([why](eval-baselines.md#2026-08-30--boundary-bash-search-non-ts-project-retired-no-run)). But `find-references`, `get-type-errors` and the refactor ops genuinely cannot serve a Python project, so a *symbol-inspection* task on one would sit on a real decision boundary. Unmeasured — decide whether it earns a paid case before adding one, against the "keep boundary cases minimal" bar in [eval-design.md](eval-design.md).

- **`MoveFileActionResult` is returned through two engines and read by nobody** `[chore]` — `tsMoveFile` returns `{ oldPath, newPath }`, the Vue engine passes it straight through (`plugins/vue/engine.ts:270`), and `operations/moveFile.ts:15` discards it, building its `MoveResult` from `scope` instead. The only thing observing those fields is a test. It shows up as a mutant no black-box test can kill, so it keeps a test alive to guard a value nothing reads. Drop the return from `tsMoveFile`, the `Engine` interface (`ts-engine/types.ts:72`) and the Vue implementation, then delete the assertions that depended on it — rather than keeping both to protect it.

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

- **Action hook registry for plugin composition** `[needs design]` — Currently VolarCompiler implements every Engine action method by manually composing "call TS action, then do Vue cleanup." A registry pattern where plugins register pre/post hooks per action (e.g. Vue plugin registers a post-moveFile hook that scans `.vue` imports) would make composition declarative. Not needed with one plugin, but the manual approach won't scale to two. Revisit when a second plugin (Svelte, Angular) is on the horizon.

- **`moveSymbol` for class methods** — extract a method to a standalone exported function. Deferred: the only safe subset (static methods / no-`this` instance methods) doesn't update call sites, so it always leaves broken code. Without call-site rewriting, the value over manual `searchText` + `replaceText` is low. Revisit if call-site rewriting becomes tractable.

- **`inlineVariable` / `inlineFunction`** — less common refactoring pattern; complex to implement safely

- **CLI human-friendly flag interface** `[needs design]` — add `--flag` aliases for JSON params on CLI subcommands (e.g. `weaver rename --file src/a.ts --line 5 --col 3 --new-name bar`). Syntactic sugar that constructs the same JSON. Layers on top of the JSON interface without breaking it.

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue compiler works around TypeScript's refusal to process `.vue` files. Read this before touching `src/plugins/vue/engine.ts`.

- **ts-morph continuity under the native/Go `tsc` transition** — `@ts-morph/common@0.29.0` bundles a private, frozen copy of TS's classic compiler (`typescript.js` reports `version = "6.0.2"`), which is why it's unaffected by TS 7 removing the classic API from the host `typescript` package (see the now-closed [PR #188](https://github.com/yearofthedan/weaver/pull/188) investigation) — but that also means ts-morph will not gain any TS language feature shipped after 6.0.2 unless it's ported to whatever API Microsoft exposes for the native Go compiler. Per [ts-morph#1621](https://github.com/dsherret/ts-morph/issues/1621), maintainer dsherret is doubtful ts-morph continues past this transition: the new API will be IPC-based (cross-process, since the compiler is now Go, not in-process JS) and deliberately curated rather than comprehensive (per [microsoft/typescript-go#455](https://github.com/microsoft/typescript-go/discussions/455)), which he calls a "massive task" he may not have bandwidth for. The typescript-go team has said keeping ts-morph working is "an anti-goal to prevent," but nothing concrete has shipped — no newer `ts-morph`/`@ts-morph/common` release exists beyond what weaver already pins (28.0.0 / 0.29.0). No design work is possible until either Microsoft ships a concrete API or ts-morph/Volar commit to a direction. Revisit when either happens.

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
