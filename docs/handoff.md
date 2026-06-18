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
  harness/             ← callModel (fetch to local OpenAI-compatible server; WEAVER_EVAL_API_KEY bearer auth), context builders, assertions, seed builder (incl. grep-primed habit-momentum seed), clutter prompt builder, competing-tool defs, config; unit-tested in test:eval lane
  cases/               ← cases.ts typed case table (trigger + command stages); *.llm.test.ts run only via `pnpm eval` (clean + adversarial trigger lanes); coverage.test.ts invariant runs in pnpm check
  fixtures/            ← canned CLI stdout JSON keyed by operation name; embedded as tool results in two-step cases
  vitest.config.ts     ← test:eval lane (helpers + invariants, runs in pnpm check)
  vitest.llm.config.ts ← pnpm eval lane (LLM cases; globalSetup probes the model server)
  global-setup.llm.ts  ← fails fast with ollama-pull instructions when server/model missing
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
    globs.ts           ← compileGlob() — validate + brace-expand a glob into a path predicate; globToRegex() per-pattern translation
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

- **Agent-SDK frontier cold-context eval rung** `[needs design]` — make the top rung of the consumer-fidelity ladder (a fresh frontier Claude session with no design history, the authoritative audience) *repeatable* rather than manual. Options: a documented manual procedure, a committed prompt, or an Agent SDK harness with real bash + live daemon + file-state assertions (highest fidelity, subsystem-sized). Gated on Anthropic API access, so out of reach for the local-only setup until that changes. Split out of the adversarial-lane spec, which covers the local rungs only. **Concrete motivation:** the single-shot first-call metric used by the trigger lanes cannot distinguish a *substitution* (grep instead of search-text) from a reasonable *precursor step* (find-references before a rename) — the adversarial lane scores `rename-at-position → find-references-first` as a loss even though renaming next would be correct. A multi-step/agentic run that checks the *eventual* operation, not just the first call, is the right instrument for these sequencing-sensitive cases.

- **Repeat-N fragility rates on the hosted calibration model** `[needs design]` — the adversarial lane runs at temperature 0, single-shot pass/fail, so it catches a poison only when it flips the model's top tool choice; it cannot see *sub-flip erosion* (P(skill) drops from 0.85→0.55 but the skill is still chosen). Quantifying that fragility needs repeat-N sampling at temperature > 0 — but the absolute rate is only trustworthy on a capable model, not the 7B canary. Design a repeat-N rate metric (sampling loop, `computeSelectionRate`, per-case rate reporting, a metric that reads movement not an absolute threshold) that runs against the hosted larger model reachable via `WEAVER_EVAL_API_KEY`. Decide: report-only vs a loose floor, N and temperature defaults, and how to surface clean-vs-poisoned rate deltas. Gated on the hosted calibration path being exercised.

---

### P3 — Medium-value features / bugs / tech debt

- **`search-text` / `replace-text` `excludeGlob` parameter** `[needs design]` — surfaced while dogfooding the skills-installer rename: a repo-wide rename had to manually revert hits under `docs/specs/archive/`. A declarative exclusion (e.g. `"excludeGlob": "docs/specs/archive/**"`) would make "find everywhere except X" safe without narrowing the glob and losing the find-everywhere benefit. (The former same-line `TEXT_MISMATCH` gap is already fixed — surgical edits apply last-position-first per file, regression-tested in `replaceText.test.ts`.)

- **Sharpen the habit-momentum primer to a "see who calls" grep** `[needs design]` — the adversarial lane's habit-momentum seed (`eval/harness/seed.ts`) primes the model with an *import* search (`grep -rn "import.*Logger"`, find-importers shaped). Observed live during a dogfooding session: the failure mode that actually bites is *identifier-usage* momentum — grep for one symbol's callers (`grep -rn "assertFileExists" src/`), it works, and the next symbol lookup greps again instead of switching to `find-references`. Rephrase the primer to a bare-identifier "see who calls X" grep so it reproduces that, and confirm the `trigger-code-inspection-find-references` case still wins under it. **Principle to encode:** a "who calls / where is X used" task is categorically `find-references`, never grep — grep matches text that spells the name, not the resolved symbol. Two more notes: (a) the flip happened with *no clutter prompt and no competing tools* — just real prior grep calls in the agent's own history — which is evidence the grep seed is the load-bearing poison in the whole adversarial apparatus; add a line to `eval-design.md` saying so. (b) Consider sharpening the `weaver-code-inspection` skill trigger to name the "see who calls" phrasing explicitly, since that's the phrasing that slips past. Validate any seed change with `pnpm eval` (`OLLAMA_CONTEXT_LENGTH=16384`).

- **Daemon discovery cache invalidation** `[needs design]` — `src/utils/ts-project.ts` caches `findTsConfig` and `isVueProject` results in module-level Maps for the daemon's whole lifetime. If a `tsconfig.json` is created/deleted/moved or `.vue` files appear during the daemon run, decisions go stale until restart. Fix: hook the watcher's `onFileAdded`/`onFileRemoved` callbacks to clear the relevant entries. Design choice: which path patterns invalidate which cache.

- **Slice-skill escalation rules for cheaper orchestrator sessions** `[chore]` — make `/slice` safe to run with a Sonnet-class orchestrator (`/model` choice; execution-agent already pins sonnet). Three text edits: (1) in `.claude/skills/slice/SKILL.md` step 3, replace "if autonomous, choose the approach that prioritises correctness" with an escalation rule — open decisions are never resolved by the orchestrator alone; present to the user or dispatch the built-in `Plan` agent with `model: "opus"` and record its reasoning in the spec. (2) Add a spec-reality tripwire (valuable regardless of model): if a batch fails for reasons requiring a change to an AC's *interface* — not just its implementation — stop, escalate, record the resolution in the spec before continuing; do not adapt the interface in-flight (lesson from the 2026-06-10 cli-eval-harness slice, where Ollama's tool-call behaviour invalidated AC2/AC3 mid-implementation). (3) One line in CLAUDE.md Rule 10: `/spec` sessions stay frontier-led; Sonnet-led `/slice` only for tasks with a finished spec. Optionally add `.claude/agents/design-consultant.md` if the Plan-agent-with-override pattern proves clumsy.

- **Agent-host hooks that redirect shell refactoring to weaver** `[needs design]` — skill descriptions alone may not pull agents in (this repo needed CLAUDE.md Rule 18 to force its own agent). A PreToolUse hook on Bash that pattern-matches shell refactoring commands (`sed -i` on source files, `mv` of a `.ts` file, `grep -r` for an identifier) and redirects to the matching weaver command would make adoption deterministic instead of probabilistic. The hook script is a pure function (command string → allow / redirect message) — unit-testable, no LLM needed. The now-shipped `weaver skills install` command is the natural place to offer hook installation into the consumer's settings (extend it rather than building a separate installer). Decide: block vs suggest semantics, false-positive policy (grep on logs is fine), and which host(s) to support. **Gate now lifted** — the adversarial-eval lane shipped ([archived spec](specs/archive/20260615-adversarial-eval-lane.md)) and its verdict leans toward fixing the text, not building hooks: the one genuine clean-pass/poisoned-fail case (`get-type-errors → tsc`) was resolved by sharpening a tool description, with no regression. That weakens — but doesn't kill — the case for a forcing mechanism; decide whether the residual adoption risk warrants it. Value is also contingent: hooks are Claude-Code-only and only reach users who opt into hook config.

---

- **Purify the domain layer (read-side port migration, slice 1)** → [`docs/specs/20260618-purify-domain-layer.md`](specs/20260618-purify-domain-layer.md) — make `src/domain/` import no `node:fs`/`node:os`: `isWithinWorkspace` becomes pure (symlink resolution moves to `WorkspaceScope`), workspace validation relocates to the daemon boundary with an injected `FileSystem`, plus a guard test. Spec-ready. Reframes the old "two domain files bypass the port" chore — the `assert-file.ts` half already shipped; the `import-rewriter.ts` `node:path` half was dropped (pure path math is not a platform dependency and doesn't belong on an I/O port).

- **Route the operations core through the `FileSystem` port (slice 2)** `[needs design]` — after the domain is pure, the application/operations core still reads disk directly: `findReferences`/`getDefinition`/`findImporters` (`existsSync` guards), `replaceText` (`realpathSync`), `moveDirectory` (`readdirSync`/`statSync`). Inject the port (via scope or the engine) and add a `readdir` method to the `FileSystem` port (+ both implementations + conformance suite). The engine and Vue-plugin adapters legitimately do I/O and stay as-is — the invariant is "domain + operations core don't touch `node:fs`," not "nothing does." Decide how the read-only ops (no current `scope` param) receive a `FileSystem`.

### P4 — Low priority (cheap hygiene; clear opportunistically)

- **Self-install weaver's bin for in-repo dogfooding** `[chore]` — `pnpm exec weaver` fails in this repo because the package's own `bin` isn't linked into `node_modules/.bin`, so agents/devs must call `node dist/adapters/cli/cli.js` directly even though CLAUDE.md Rule 9 says to use `pnpm exec weaver`. Adding `"@yearofthedan/weaver": "file:."` to `devDependencies` (a pnpm workspace self-link) makes `pnpm exec weaver` resolve after `pnpm install`. Low risk; improves dogfooding ergonomics. Re-runs needed after a clean install.

- **`VolarLanguageService` hand-typed interface** `[chore]` — `src/plugins/vue/compiler.ts` manually narrows the TS LanguageService surface used by the Vue compiler; an upstream signature change can compile but fail at runtime. Replace with `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>` for compile-time safety. May fall out naturally during further Volar refactoring.

- **Migrate remaining standalone-`copyFixture` callers** `[chore]` — after the fixture-seed-helpers slice ships, ~8 files still call the standalone `copyFixture(name): string`. (a) Seven integration tests in `src/{cli-workspace-default,daemon/*}.integration.test.ts` pair it with subprocess lifecycle tracking — migrate `dir` to `fixtureTest` + `seedNamedFixture`; keep custom `afterEach` for procs. (b) `src/operations/searchText.test.ts` uses `beforeAll` to share one dir across many tests — convert to per-test `seedNamedFixture` (small perf cost, ~10 tests × one fixture copy each). Once both done, delete the standalone `copyFixture` and `cleanup` exports as dead code.

- **Consolidate `WEAVER_VERBOSE` env var into flag-only** `[needs design]` — the daemon has both a `--verbose` CLI flag and a `WEAVER_VERBOSE` env var that do the same thing. The env var exists because auto-spawn can't pass CLI flags, but `ensureDaemon` could forward `--verbose` to `spawnDaemon` directly. Consolidate to flag-only and remove the env var.

---

### P5 — Features & speculative (pull when demanded)

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
