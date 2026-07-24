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
  harness/             ← callModel (fetch to an OpenAI-compatible endpoint; bearer auth; per-lane temperature; malformed tool-JSON tolerated via invalidArguments), context builders (available_skills + host-style skill instruction; classifySkillReach → load vs tool-style skill reach), assertions (isWeaverInvocation; isAnyWeaverInvocation for the boundary guard; weaverSubcommand; extractBashCommands splits &&-chains; matchWeaverCommand → matched + outcome correct/wrong-tool/wrong-args; path key args (oldPath/newPath/file/sourceFile/destFile) matched by trailing segment so a cd+relative invocation grades correct, non-path keys stay exact), fixtures (loadFixture + operationToSubcommand — shared by harness and cases), rate aggregator, outcome classifier (classifyTrialOutcome + computeOutcomes → four-tier clean-pass/warned-pass/content-fail/never-reached composition, reporting-only beside the unchanged selection-rate gate), seed builder (habit-momentum seed = `turns` true-shell pre-steps from a pool weaver does not own — log grep, `git log --grep`, `find` by name — throws past the pool size; two-step seed), per-case lane config in case-lane.ts (`seedForCase` reads momentumTurns, default 1; `caseIsGating` reads observational, default gating), clutter prompt builder, tool defs (rateLaneTools, SKILL_TOOL), grade (SUBCOMMAND_MUTABILITY mutating/read-only classification + isMutatingCompetitor — the loop's hardFails verdict), agentic loop (replays each turn as a standard tool exchange — assistant tool_calls + tool-role results; three-way verdict pass/hard-fail-on-mutating-competitor/precursor with failedAtStep; cannedToolResult resolves per-case cannedResults, else an inert neutral stub for unowned weaver hops — scenario content lives only in cannedResults; skill-load hop feeds real SKILL.md body — a tool-style skill reach (a skill called directly as a tool) is fed the body too and treated as a load, flagging skillCalledAsTool; skillMdRead/readTurn; abandonedText; boundaryTrialClean; WEAVER_EVAL_DEBUG turn trace), config; unit-tested in test:eval lane. One lane: Haiku (`anthropic/claude-haiku-4.5`) via OpenRouter — see docs/eval-design.md
  cases/               ← cases.ts typed case table (trigger + command stages; two-step seed = {step1Command, fixture}; optional per-case cannedResults, momentumTurns, observational); *.llm.test.ts run only via `pnpm eval` (agentic trigger lane — incl. the boundary over-trigger guard + adjacent-negative boundaries + per-trial matchedAtStep + a non-gating args verdict via matchWeaverCommand.outcome + an observational pressured buried rung, momentumTurns:3, that reports rate but does not gate; command lane asserts a declared bash tool call from a single unprimed prompt; two-step lane seeds a real tool exchange and asserts a result-derived rename position — line 12/col 9 carried from search-text); coverage.test.ts invariant runs in pnpm check
  fixtures/            ← canned CLI stdout JSON keyed by operation name; embedded as tool results in two-step cases
  vitest.config.ts     ← test:eval lane (helpers + invariants, runs in pnpm check)
  # harness logic is mutation-tested via a dedicated lane: `pnpm test:mutate:eval` (stryker.eval.config.mjs / vitest.stryker.eval.config.ts, own incremental cache, CI job `mutation-eval`) — see docs/tech/mutation-testing.md
  vitest.llm.config.ts ← pnpm eval lane (LLM cases; globalSetup requires the hosted endpoint env vars)
  global-setup.llm.ts  ← fails fast requiring a hosted endpoint (WEAVER_EVAL_BASE_URL/MODEL/API_KEY) when unset
  README.md            ← operational runbook: setup, secret injection, run commands (design rationale lives in docs/eval-design.md)
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
    ensure-daemon.ts             ← ensureDaemon (version check + auto-spawn); callDaemon (socket client); spawnDaemon; forwards --verbose
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
    ts-project.ts      ← findTsConfig, findTsConfigForFile, isVueProject
    *.test.ts          ← colocated unit tests
  *.integration.test.ts ← cross-cutting integration tests (cli-workspace-default, eval, agent-conventions, skill-file)
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

### P2 — High-value features / bugs / tech debt

_(none queued)_

---

### P3 — Medium-value features / bugs / tech debt

- **Single-shot emission under pressure** `[needs design]` — [`docs/eval-readiness.md`](eval-readiness.md) gap, partly overtaken. The pressured trigger rungs now exercise the *body's* multi-step recipe under the depth-3 seed (the rename locate→act flow), so body-following under pressure *is* covered. Remaining gap: **single-shot command emission** under pressure — no lane pairs the emission path (correct `weaver <cmd>` args in one shot) with a pressured context; today's command lane is unpressured. Add a pressured emission lane (still canary, cheap).

- **`extract-function` two-step lane fails — model stages args to a file instead of emitting the command** `[needs investigation]` — 2026-07-23 Haiku baseline: `two-step-cat-then-extract` fails deterministically (temp 0). Asked to extract lines into a new function, the model writes the extract-function JSON to a temp file (`cat > /tmp/extract_request.json << EOF … EOF; cat …`) and never runs `weaver extract-function`, so the matcher finds no invocation. Root cause not confirmed: either skill-text (the extract-function guidance doesn't drive a single-shot emission the way rename does) or matcher (should file-staged args count as an attempt?). Model-specific, not universal: in the cross-model runs Haiku and DeepSeek fail this deterministically while both Geminis pass it — so it is a canary (Haiku) weakness worth fixing, not a harness bug. Run `/investigate` to isolate before choosing a skill-body vs. harness fix.

- **`search-text` / `replace-text` `excludeGlob` parameter** `[needs design]` — surfaced while dogfooding the skills-installer rename: a repo-wide rename had to manually revert hits under `docs/specs/archive/`. A declarative exclusion (e.g. `"excludeGlob": "docs/specs/archive/**"`) would make "find everywhere except X" safe without narrowing the glob and losing the find-everywhere benefit. (The former same-line `TEXT_MISMATCH` gap is already fixed — surgical edits apply last-position-first per file, regression-tested in `replaceText.test.ts`.)

- **Daemon discovery cache invalidation** `[needs design]` — `src/utils/ts-project.ts` caches `findTsConfig` and `isVueProject` results in module-level Maps for the daemon's whole lifetime. If a `tsconfig.json` is created/deleted/moved or `.vue` files appear during the daemon run, decisions go stale until restart. Fix: hook the watcher's `onFileAdded`/`onFileRemoved` callbacks to clear the relevant entries. Design choice: which path patterns invalidate which cache.

- **Daemon adapter follow-ups (port migration + mutation-noise)** `[needs design]` — two items discovered shipping the SIGTERM lifecycle extraction ([archived spec](specs/archive/20260621-daemon-sigterm-registration-race.md)). (1) `runStop`/`stopDaemon`/`ensureDaemon`/`readLockfile`/`removeDaemonFiles` still use raw `node:fs`; the new `lifecycle.ts` goes through the `FileSystem` port — decide whether to migrate the rest (parallels the operations read-side port effort). (2) `daemon.ts` scores ~9% in-process mutation because `runDaemon`/`handleSocketRequest` run only in the spawned daemon subprocess, invisible to in-process Stryker (the integration smoke spawns the real daemon and exercises them). The extraction moved the testable logic to `lifecycle.ts` (100%); the `daemon.ts` remainder is structural subprocess-noise. Decide: exclude adapter bodies from `--mutate` (like the `schema.ts` known-noise item) or accept and document, so triage does not chase it.

---

### P4 — Low priority (cheap hygiene; clear opportunistically)

- **Lane-aware `/mutate-triage` + eval CI auto-triage** `[needs design]` — `/mutate-triage` is hardcoded to the src lane (`reports/mutation/mutation.json`, `pnpm test:mutate`, `reports/stryker-incremental.json`). The eval mutation CI job (`quality-feedback.yml` `mutation-eval`) therefore has no auto-triage-on-failure step — a naive mirror would triage the src lane from the eval job. Parameterise `/mutate-triage` by lane (the three paths above + the run command switch), then add the failure-gated triage step (with a `permissions: { id-token: write, contents: write }` block) to the eval job, mirroring the src job. Design call: lane as a skill arg (`/mutate-triage eval`) vs. two thin wrapper skills vs. auto-detecting from which report exists.

- **Discriminate `CaseEntry` by stage** `[needs design]` — `eval/cases/cases.ts` `CaseEntry` is a shared bag of stage-specific optionals: `seed` (two-step only), `cannedResults` + `expect.skill` + `momentumTurns` + `observational` (agentic trigger only), `expect.command`/`keyArgs` (command/trigger). The type permits nonsense (a `command`-stage row can set `momentumTurns` and it is silently ignored); the "only X reads this" field comments compensate for a type too loose to make illegal states unrepresentable. Convert to a `stage`-discriminated union so each lane's fields live only on its variant. Design nuance: the split is not single-axis — two-step cases are `stage: "command"` *plus* a `seed`, so that variant is a sub-shape, not a third `stage`. Cover all four lane-specific fields in one pass, not piecemeal.

- **`VolarLanguageService` hand-typed interface** `[chore]` — `src/plugins/vue/compiler.ts` manually narrows the TS LanguageService surface used by the Vue compiler; an upstream signature change can compile but fail at runtime. Replace with `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>` for compile-time safety. May fall out naturally during further Volar refactoring.

- **Consolidate `WEAVER_VERBOSE` env var into flag-only** `[needs design]` — the daemon has both a `--verbose` CLI flag and a `WEAVER_VERBOSE` env var that do the same thing. The env var exists because auto-spawn can't pass CLI flags, but `ensureDaemon` could forward `--verbose` to `spawnDaemon` directly. Consolidate to flag-only and remove the env var.

- **ts-morph long-term continuity risk (native/Go `tsc` transition)** `[needs design]` — no action possible yet; watch item. `@ts-morph/common@0.29.0` bundles a private, frozen copy of TS's classic compiler (`typescript.js` reports `version = "6.0.2"`), which is why it's unaffected by TS 7 removing the classic API from the host `typescript` package (see the now-closed [PR #188](https://github.com/yearofthedan/weaver/pull/188) investigation) — but that also means ts-morph will not gain any TS language feature shipped after 6.0.2 unless it's ported to whatever API Microsoft exposes for the native Go compiler. Per [ts-morph#1621](https://github.com/dsherret/ts-morph/issues/1621), maintainer dsherret is doubtful ts-morph continues past this transition: the new API will be IPC-based (cross-process, since the compiler is now Go, not in-process JS) and deliberately curated rather than comprehensive (per [microsoft/typescript-go#455](https://github.com/microsoft/typescript-go/discussions/455)), which he calls a "massive task" he may not have bandwidth for. The typescript-go team has said keeping ts-morph working is "an anti-goal to prevent," but nothing concrete has shipped — no newer `ts-morph`/`@ts-morph/common` release exists beyond what weaver already pins (28.0.0 / 0.29.0). No design work is possible until either Microsoft ships a concrete API or ts-morph/Volar commit to a direction. Revisit when either happens.

---

### P5 — Features & speculative (pull when demanded)

**Eval-confidence chain (all API-gated; do in this order when the gate lifts).** Per [`docs/eval-readiness.md`](eval-readiness.md), every shipped lane is `canary × simulated`; canary movement is assumed to predict the real audience but is never checked.

- **2. Harnessed end-to-end — real host + real bash + file-state** `[needs design]` — run the skill through a real agent host (not the API) executing real `weaver` commands against a live daemon, asserting on file state. Before building, evaluate Anthropic's `skill-creator` skill ([github.com/anthropics/skills](https://github.com/anthropics/skills)) — it already does with/without runs, output grading, and description optimization via subagents. Host: Claude Code headless gives real execution but a weak tool-call trail (file-state inference only); **opencode** is open-source and likely exposes the trail directly — evaluate as the alternative host. Subsystem-sized; gated (API + real execution; Ollama JSON-drop reappears for emission).

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
| Compiler/operation architecture, dispatcher design, `CompilerRegistry` | [`docs/architecture.md`](architecture.md) |
| Daemon lifecycle, auto-spawn, socket protocol, `DAEMON_STARTING` | [`docs/internals/daemon.md`](internals/daemon.md) |
| Vue compiler internals, virtual↔real path translation, `toVirtualLocation` | [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Implementation gotchas (`workspace` convention, Volar quirks, etc.) | [`docs/architecture.md`](architecture.md), [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Task specifications (ready and archived) | [`docs/specs/`](specs/) |
