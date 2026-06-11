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

**Picking up a task?** Tasks have one of three states:
- **`[chore]`** → implementation is unambiguous; implement directly, no spec needed. Any decision context is in the task description. Use for deferred admin tasks (dependency bumps, doc edits, config changes, dead code removal). Inline refactors spotted during a session don't need an entry — apply them in a separate commit and move on.
- **`[needs design]`** → problem understood, solution not yet agreed. Run `/spec` to create a spec with the user before writing code.
- **Has a spec link** → already designed. Read the spec, then run `/slice`.

An agent discovering new work should add a `[needs design]` entry and move on — do not design it in the same session.

**Finishing a task?** The spec's Done-when section is the checklist. Key items:
1. Archive the spec to `docs/specs/archive/` with an Outcome section
2. Remove or update the entry below
3. Update docs if public surfaces changed (see Done-when in the spec)
4. Write gotchas to the relevant `docs/internals/` or `docs/tech/` doc; cross-cutting process rules go in `.claude/MEMORY.md`

---

## Current state

Directory layout matches domain boundaries:

```
eval/
  harness/             ← callModel (fetch to local OpenAI-compatible server), context builders, assertions, seed builder, config; unit-tested in test:eval lane
  cases/               ← cases.ts typed case table (trigger + command stages); *.llm.test.ts run only via `pnpm eval`; coverage.test.ts invariant runs in pnpm check
  fixtures/            ← canned CLI stdout JSON keyed by operation name; embedded as tool results in two-step cases
  vitest.config.ts     ← test:eval lane (helpers + invariants, runs in pnpm check)
  vitest.llm.config.ts ← pnpm eval lane (LLM cases; globalSetup probes the model server)
  global-setup.llm.ts  ← fails fast with ollama-pull instructions when server/model missing
.github/workflows/
  ci.yml               ← lint + build + test on push/PR
  quality-feedback.yml ← mutation testing (weekly + on push to main); Claude Code triage step on score < 75
.claude/skills/
  mutate-triage/       ← /mutate-triage skill: classify survivors, open issues for noise, fix PRs for fixable gaps
  search-and-replace/ ← shipped with npm; agent guidance for search-text + replace-text
  refactor/           ← shipped with npm; agent guidance for rename, move-file, move-directory, move-symbol, delete-file, extract-function
  code-inspection/    ← shipped with npm; agent guidance for find-references, get-definition, get-type-errors
src/
  adapters/
    schema.ts         ← Zod schemas + per-field descriptions + inferred arg types (used by dispatcher + CLI --help)
    cli/
      cli.ts          ← CLI entry point; registers daemon, stop commands + operation subcommands
      operations.ts   ← data-driven registration of 12 operation subcommands; SUBCOMMANDS table; renders --help from schemas
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
    security.ts           ← validateFilePath(), validateWorkspace(), isWithinWorkspace(), isSensitiveFile() — all security policy
    errors.ts             ← EngineError class + ErrorCode union
    *.test.ts              ← colocated unit tests
  daemon/
    daemon.ts                    ← socket server; promise-chain mutex; isDaemonAlive + removeDaemonFiles lifecycle fns; starts watcher; --verbose per-request logging
    ensure-daemon.ts             ← ensureDaemon (version check + auto-spawn); callDaemon (socket client); spawnDaemon; forwards --verbose
    logger.ts                    ← DaemonLogger: structured JSON log file, 10 MB cap, workspace-prefix stripping
    paths.ts                     ← socketPath, lockfilePath, logfilePath, ensureCacheDir
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
    globs.ts           ← globToRegex() — glob pattern to RegExp conversion
    ts-project.ts      ← findTsConfig, findTsConfigForFile, isVueProject
    *.test.ts          ← colocated unit tests
  *.integration.test.ts ← cross-cutting integration tests (cli-workspace-default, eval, agent-conventions, skill-file)
  __testHelpers__/
    helpers.ts        ← shared test utilities (cleanup, readFile, fileExists, PROJECT_ROOT); re-exports copyFixture
    process-helpers.ts ← subprocess spawning utilities
    fake-daemon.ts    ← fake daemon script for protocol tests
    fixtures/
      fixtures.ts  ← copyFixture() — copies a named fixture to a temp dir
      simple-ts/   ← minimal TS project scaffold (and 9 others: vue-project, cross-boundary, etc.)
```

**Commands shipped:** see [`docs/commands/README.md`](commands/README.md) for the full command index.

---

## Next things to build

Priorities run top to bottom. Complete a tier before starting the next. 
**IMPORTANT**: Priority is the only thing that matters. Skipping an item without a design is a failure. If a priority item needs design, spec it. 

---

### P2 — High-value features / bugs / tech debt

- **Agent-host hooks that redirect shell refactoring to weaver** `[needs design]` — skill descriptions alone may not pull agents in (this repo needed CLAUDE.md Rule 18 to force its own agent). A PreToolUse hook on Bash that pattern-matches shell refactoring commands (`sed -i` on source files, `mv` of a `.ts` file, `grep -r` for an identifier) and redirects to the matching weaver command would make adoption deterministic instead of probabilistic. The hook script is a pure function (command string → allow / redirect message) — unit-testable, no LLM needed. Design with the `weaver install` item below: the installer is the natural place to offer hook installation into the consumer's settings. Decide: block vs suggest semantics, false-positive policy (grep on logs is fine), and which host(s) to support.

- **Built-in skills installer (`weaver skills install`)** → [`docs/specs/20260611-skills-installer.md`](specs/20260611-skills-installer.md) — copies the shipped, namespaced (`weaver-*`) skills from the installed package into the consumer's skills directory (`--dir`, default `.claude/skills`), with `--force` to overwrite diverged files. Replaces the `npx skills add` distribution.

---

### P3 — Medium-value features / bugs / tech debt

- **Skill-description findings from the first eval run** `[needs design]` — the 2026-06-10 eval run (21/23) surfaced two skill-content issues. (1) Description overlap: `code-inspection` ("before using grep to find references") and `search-and-replace` ("searching for all occurrences of a pattern") compete for text-pattern tasks — the model picked code-inspection for "find all TODO comments" (`trigger-search-and-replace-todos-grep-tempting`). Decide how the two descriptions should divide the "find X" space. (2) Pattern format ambiguity: the search-and-replace skill never says the `pattern` arg is a bare regex string — the model emitted `"/TODO/"` with regex delimiters (`command-search-text`). Changing descriptions is a product decision: re-run `pnpm eval` to verify improvements.

- **Adversarial trigger lane for the eval** `[needs design]` — the current trigger stage is a clean room: skills compete against a single `bash` tool in a near-empty prompt, so the 2026-06-10 pass rate reads optimistic (a frontier agent working in this very repo skipped the skills entirely under real context pressure). Build a second lane that intentionally *reduces* skill selection without changing the skill files — the skills are the constant, the pressure is the variable. Candidate poisons, separable: (1) realistic competing toolset — declare `Edit`/`Grep`/`Glob`/`Read`-style tools next to the skills so failures name which habit won; (2) cluttered system prompt — thousands of tokens of plausible agent scaffolding around the descriptions; constrained by Ollama's server-side context default (4096; skills already ~3.2k tokens — needs `OLLAMA_CONTEXT_LENGTH` raised and documented); (3) habit momentum — pre-seed turns where the model already used grep successfully on an unrelated sub-task (seed machinery exists in `eval/harness/seed.ts`). Design decisions: keep the clean lane as the regression baseline (clean-pass + poisoned-fail = pressure problem → hooks; both-fail = text problem); switch poisoned-lane metric from single-shot pass/fail to repeat-N trigger rates at temperature > 0 (knife-edge results flap at temp 0); how much poison before the 7B canary's context handling — not the descriptions — becomes what's being measured. Caveat to record in the spec: synthetic clutter is a guess at a real host's prompt; this narrows the realism gap, doesn't close it — and the Agent SDK end-to-end rung requires Anthropic API access, so it stays out of reach for the local-only setup. Remote execution option (weigh in the spec): the harness already targets any OpenAI-compatible endpoint via `WEAVER_EVAL_BASE_URL`/`WEAVER_EVAL_MODEL`; the only code gap is an Authorization header (`call-model.ts` sends none — add `WEAVER_EVAL_API_KEY`, also on the global-setup probe). Two shapes: (a) own Ollama on a rented GPU box (SSH-tunnelled — Ollama has no auth; per-hour cost, no new billing relationships beyond the box) or (b) hosted open-model APIs (Together/Fireworks/DeepInfra; a full run is ~150–200k tokens ≈ cents even on 70B-class models, but it is a new account/billing surface). Either dissolves both lane constraints — the 4096-token Ollama context ceiling for clutter prompts, and the 7B-canary-collapses-under-poison risk (run the poisoned lane on 32B/72B) — and hosted servers may not need the per-skill-tools/text-emission workarounds, since those exist for Ollama's silent tool-call dropping.

- **Stryker survivors on `schema.ts` module-level constraints** `[needs design]` — `src/adapters/schema.ts` is module-level Zod schema declarations. After adding `replaceText` refine tests it scores ~64% (not the ~1% an earlier run reported — that measurement was wrong), and the refine (runtime-function) mutants are killable by tests, so a blanket "ESM static-mutant, unkillable" explanation does NOT hold. The real puzzle: a cluster of module-level *constraint* mutants survive despite tests that should catch them — e.g. removing the `^` anchor from the `newName` identifier regex survives even though a test asserts `"1invalid"` is rejected (which should fail under that mutant). Needs hands-on investigation: run one such mutant in isolation and inspect whether the mutated schema is actually constructed when a static mutant is active under the vitest runner. Once understood, options: targeted `ignoreStatic`, restructure to factory functions so constraints evaluate per-call, or accept and document. Do not chase the threshold meanwhile — `pnpm check` does not run mutation.

---

### P4 — Low priority

- **Slice-skill escalation rules for cheaper orchestrator sessions** `[chore]` — make `/slice` safe to run with a Sonnet-class orchestrator (`/model` choice; execution-agent already pins sonnet). Three text edits: (1) in `.claude/skills/slice/SKILL.md` step 3, replace "if autonomous, choose the approach that prioritises correctness" with an escalation rule — open decisions are never resolved by the orchestrator alone; present to the user or dispatch the built-in `Plan` agent with `model: "opus"` and record its reasoning in the spec. (2) Add a spec-reality tripwire (valuable regardless of model): if a batch fails for reasons requiring a change to an AC's *interface* — not just its implementation — stop, escalate, record the resolution in the spec before continuing; do not adapt the interface in-flight (lesson from the 2026-06-10 cli-eval-harness slice, where Ollama's tool-call behaviour invalidated AC2/AC3 mid-implementation). (3) One line in CLAUDE.md Rule 10: `/spec` sessions stay frontier-led; Sonnet-led `/slice` only for tasks with a finished spec. Optionally add `.claude/agents/design-consultant.md` if the Plan-agent-with-override pattern proves clumsy.

- **Check `agent-conventions` for dead MCP-era validation** `[chore]` — `eval/agent-conventions.test.ts` + `scripts/agent-conventions.js` validate `.mcp.json` MCP server configs, which likely no longer exist after the MCP transport removal. If `.mcp.json` is gone and nothing else calls the script, delete both; if a config remains, trim validation to what's still real.

- **Migrate remaining standalone-`copyFixture` callers** `[chore]` — after the fixture-seed-helpers slice ships, ~8 files still call the standalone `copyFixture(name): string`. (a) Seven integration tests in `src/{cli-workspace-default,daemon/*}.integration.test.ts` pair it with subprocess lifecycle tracking — migrate `dir` to `fixtureTest` + `seedNamedFixture`; keep custom `afterEach` for procs. (b) `src/operations/searchText.test.ts` uses `beforeAll` to share one dir across many tests — convert to per-test `seedNamedFixture` (small perf cost, ~10 tests × one fixture copy each). Once both done, delete the standalone `copyFixture` and `cleanup` exports as dead code.

- **`moveSymbol` for non-exported functions** `[needs design]` — `moveSymbol` returns `SYMBOL_NOT_FOUND` for unexported helpers. Supporting them requires deciding whether to auto-export at the destination, what happens if the function is private and still used in source, and how to handle the case where source calls the now-exported helper. Spec separately.

- **Explore uses for ts-morph `printStructure`** `[needs design]` — ts-morph 28 ships a standalone `printStructure(structure)` function that serialises a structure object back to TypeScript source. Potential directions: a `generateFromStructure` tool that lets agents produce scaffolded code from a JSON description, or a read-side `readStructure` that extracts a node's structure for inspection/diffing. Investigate what agent workflows this could enable before committing to an interface.


- **Consolidate `WEAVER_VERBOSE` env var into flag-only** `[needs design]` — the daemon has both a `--verbose` CLI flag and a `WEAVER_VERBOSE` env var that do the same thing. The env var exists because auto-spawn can't pass CLI flags, but `ensureDaemon` could forward `--verbose` to `spawnDaemon` directly. Consolidate to flag-only and remove the env var.

- **`--dry-run` / rollback** `[needs design]` — add `--dry-run` flag to CLI operation subcommands that previews what would change without writing. Requires daemon-level support (compute-only mode that returns edits without applying them). Multi-file operations have no all-or-nothing guarantee; documented precondition (clean git working tree) is workable for now. Agents already have git as their undo mechanism. Revisit if non-git workflows emerge.
- **CLI `--interactive` selection mode** `[needs design]` — interactive confirmation workflow for `replace-text` (present matches one-by-one like `git add -p`). Human-friendly; not useful for agents. Requires TTY detection and incremental confirmation loop.
- **CLI human-friendly flag interface** `[needs design]` — add `--flag` aliases for JSON params on CLI subcommands (e.g. `weaver rename --file src/a.ts --line 5 --col 3 --new-name bar`). Syntactic sugar that constructs the same JSON. Layers on top of the JSON interface without breaking it.
- **`moveBlock`: move a contiguous code block between files** `[needs design]` — Move a block of code (e.g. a `describe(...)` block in a test file) from one file to another by line range: `moveBlock(sourceFile, startLine, endLine, destFile, insertAfterLine?)`. The block is self-contained — no callers to update, no reference graph involved. Main challenges: (1) import carrying — identify which imports the moved block uses, add missing ones to the destination; (2) import cleanup — remove now-unused imports from the source (ts-morph `organizeImports`); (3) insertion point — default is append to end of file. Primary use case: reorganising large test files by moving `describe` blocks without manual cut/paste + import fixup.
- `createFile` `[needs design]` — scaffold a file with correct import paths
- **Workspace split: `app` + `tooling` (`conventions` + `evals`)** `[needs design]` — move `agent:check`, `agent:doctor`, and `eval` scripts plus related tests into a tooling project; keep app unit tests and mutation testing with app initially; define dependency ownership and migration steps that preserve CI and publish flows
- **`moveSymbol` for class methods** — extract a method to a standalone exported function. Deferred: the only safe subset (static methods / no-`this` instance methods) doesn't update call sites, so it always leaves broken code. Without call-site rewriting, the value over manual `searchText` + `replaceText` is low. Revisit if call-site rewriting becomes tractable.
- **`inlineVariable` / `inlineFunction`** — less common refactoring pattern; complex to implement safely
- **Watcher own-writes redundant invalidation** `[needs design]` — The daemon's own writes emit FS events that fire `invalidateFile`/`invalidateAll` ~200ms after the write, by which time the operation has already invalidated. Safe (no correctness issue, mutex-serialised), but if a second call arrives within the debounce window, the next `getEngine()` pays a cold rebuild. Sketch: maintain a skip-set of paths the daemon just wrote, drain after a grace period; populated and drained inside the mutex so no concurrency guard needed. Design choice: grace-period length, drain trigger.
- **Daemon discovery cache invalidation** `[needs design]` — `src/utils/ts-project.ts` caches `findTsConfig` and `isVueProject` results in module-level Maps for the daemon's whole lifetime. If a `tsconfig.json` is created/deleted/moved or `.vue` files appear during the daemon run, decisions go stale until restart. Fix: hook the watcher's `onFileAdded`/`onFileRemoved` callbacks to clear the relevant entries. Design choice: which path patterns invalidate which cache.
- **`VolarLanguageService` hand-typed interface** `[chore]` — `src/plugins/vue/compiler.ts` manually narrows the TS LanguageService surface used by the Vue compiler; an upstream signature change can compile but fail at runtime. Replace with `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>` for compile-time safety. May fall out naturally during further Volar refactoring.
- **Two domain-layer files bypass the `FileSystem` port** `[chore]` — (1) `src/utils/assert-file.ts` calls `fs.existsSync` directly, forcing unit tests with `InMemoryFileSystem` to pass paths that physically exist on disk. (2) `src/ts-engine/import-rewriter.ts` imports `node:path` directly for `dirname` and `resolve`. The port already exposes `resolve`; adding `dirname` and routing both through `scope.fs` removes the domain layer's last direct platform dependency.
- **Action hook registry for plugin composition** `[needs design]` — Currently VolarCompiler implements every Engine action method by manually composing "call TS action, then do Vue cleanup." A registry pattern where plugins register pre/post hooks per action (e.g. Vue plugin registers a post-moveFile hook that scans `.vue` imports) would make composition declarative. Not needed with one plugin, but the manual approach won't scale to two. Revisit when a second plugin (Svelte, Angular) is on the horizon.

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
