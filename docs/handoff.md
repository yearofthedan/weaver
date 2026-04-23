**Purpose:** Current state, source layout, and prioritised next work items. Each task either links to a spec file (ready to implement) or is marked `[needs design]` (needs a `/spec` pass first).
**Audience:** Engineers implementing features, AI agents working on the codebase.
**Status:** Current
**Related docs:** [Why](why.md) (product rationale), [Features](features/) (features & tools), [Tech Debt](tech/tech-debt.md) (known issues), [Specs](specs/) (task specifications)

---

# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

**New to the codebase?** Read in this order:
1. [`docs/why.md`](why.md) — what this is and why it exists
2. [`docs/agent-users.md`](agent-users.md) — how agents differ from human users; read before speccing any feature
3. [`docs/features/daemon.md`](features/daemon.md) — understand the daemon before touching `serve`
4. [`docs/features/mcp-transport.md`](features/mcp-transport.md) — how `serve` connects to the daemon
5. [`docs/architecture.md`](architecture.md) — compiler/operation architecture; read before touching anything in `src/`
6. [`docs/quality.md`](quality.md) — testing and reliability expectations

**Picking up a task?** Tasks have one of three states:
- **`[chore]`** → implementation is unambiguous; implement directly, no spec needed. Any decision context is in the task description.
- **`[needs design]`** → problem understood, solution not yet agreed. Run `/spec` to create a spec with the user before writing code.
- **Has a spec link** → already designed. Read the spec, then run `/slice`.

An agent discovering new work should add a `[needs design]` entry and move on — do not design it in the same session.

**Finishing a task?** The spec's Done-when section is the checklist. Key items:
1. Archive the spec to `docs/specs/archive/` with an Outcome section
2. Remove or update the entry below
3. Update docs if public surfaces changed (see Done-when in the spec)
4. Write gotchas to the relevant `docs/features/` or `docs/tech/` doc; cross-cutting process rules go in `.claude/MEMORY.md`

---

## Current state

Directory layout matches domain boundaries:

```
eval/
  fixture-server.ts    ← socket server that impersonates the daemon for eval runs; exports startFixtureServer
  run-eval.ts          ← entry point: starts fixture server, runs promptfoo, tears down
  promptfooconfig.yaml ← PromptFoo config; 15 tests across two providers (weaver-only + with-shell-alternatives); inline test definitions
  fixtures/            ← pre-recorded daemon JSON responses keyed by method name
  cases/               ← (reserved for per-tool case files if extracted in future)
.github/workflows/
  ci.yml               ← lint + build + test on push/PR
  quality-feedback.yml ← mutation testing (weekly + on push to main); Claude Code triage step on score < 75
.claude/skills/
  mutate-triage/       ← /mutate-triage skill: classify survivors, open issues for noise, fix PRs for fixable gaps
  search-and-replace/ ← shipped with npm; agent guidance for search-text + replace-text
  move-and-rename/    ← shipped with npm; agent guidance for rename, move-file, move-directory, move-symbol, delete-file, extract-function
  code-inspection/    ← shipped with npm; agent guidance for find-references, get-definition, get-type-errors
src/
  adapters/
    schema.ts         ← Zod schemas + inferred arg types for all operations (used by tools.ts + dispatcher)
    cli/
      cli.ts          ← CLI entry point; registers daemon, serve, stop commands + operation subcommands
      operations.ts   ← data-driven registration of 11 operation subcommands (rename, move-file, etc.)
    mcp/
      mcp.ts          ← MCP server (connects to daemon); runServe + startMcpServer + classifyDaemonError
      tools.ts        ← TOOLS table (11 tool definitions) + ToolDefinition interface + TOOL_NAMES
      classify-error.ts ← classifyDaemonError — maps socket error codes to DAEMON_STARTING / INTERNAL_ERROR
      classify-error.test.ts ← unit tests for classifyDaemonError
      *.integration.test.ts  ← MCP integration tests (find-references, rename, move-file, security, etc.)
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
      plugin.ts   ← createVueLanguagePlugin(); Vue/Volar LanguagePlugin factory (project detection, lifecycle)
      engine.ts   ← VolarEngine: implements Engine; delegates TS work to TsMorphEngine; scans .vue files for imports
      scan.ts     ← updateVueImportsAfterMove + removeVueImportsOfDeletedFile + updateVueNamedImportAfterSymbolMove
      service.ts  ← buildVolarService() — Volar service factory
      *.test.ts   ← colocated unit tests
  operations/
    rename.ts          ← rename(engine, filePath, line, col, newName, scope: WorkspaceScope)
    findReferences.ts  ← findReferences(engine, filePath, line, col)
    findImporters.ts   ← findImporters(engine, filePath) — "who imports this file?"; returns {fileName, references[]}
    getDefinition.ts   ← getDefinition(engine, filePath, line, col)
    getTypeErrors.ts   ← getTypeErrors(tsEngine, file?, scope: WorkspaceScope) — errors-only, cap 100; exports toDiagnostic + MAX_DIAGNOSTICS
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
    mcp-helpers.ts    ← MCP test utilities (useMcpContext, parseMcpResult)
    process-helpers.ts ← subprocess spawning utilities
    fake-daemon.ts    ← fake daemon script for protocol tests
    fixtures/
      fixtures.ts  ← copyFixture() — copies a named fixture to a temp dir
      simple-ts/   ← minimal TS project scaffold (and 9 others: vue-project, cross-boundary, etc.)
```

**Features shipped:** see [`docs/features/README.md`](features/README.md) for the full tool index.

---

## Next things to build

Priorities run top to bottom. Complete a tier before starting the next. 
**IMPORTANT**: Priority is the only thing that matters. Skipping an item without a design is a failure. If a priority item needs design, spec it. 

---

### P2 — High-value features / bugs / tech debt

---

### P3 — Medium-value features / bugs / tech debt

- `getTypeErrors` Volar support for `.vue` files `[needs design]` — extend type error detection to `.vue` SFC `<script>` blocks
- **`nameMatches` for Vue renames** `[needs design]` — `VolarEngine.rename` does not call `scanNameMatches` in v1; adding it requires parsing `<script>` blocks and handling SFC virtual↔real line/col translation. See `docs/features/rename.md` Constraints for the v1 exclusion.
- `extractFunction` Vue support `[needs design]` — extend extractFunction to `.vue` SFC `<script setup>` blocks
- `moveSymbol` from a `.vue` source file `[needs design]` — symbol declared in `<script setup>` block; see [moveSymbol.md](features/moveSymbol.md)
---

### P4 — Low priority

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
- **Watcher own-writes redundant invalidation** — safe as-is; only adds one extra rebuild per write-heavy op (see tech-debt.md)
- **Daemon discovery cache invalidation** — only hurts if `tsconfig.json` moves at runtime (see tech-debt.md)
- **`VolarLanguageService` hand-typed interface** — low urgency; will resolve naturally during further Volar refactoring (see tech-debt.md)
- **TOCTOU symlink race** — accepted risk; revisit only if deployment model changes (see tech-debt.md)
- **Action hook registry for plugin composition** `[needs design]` — Currently VolarCompiler implements every Engine action method by manually composing "call TS action, then do Vue cleanup." A registry pattern where plugins register pre/post hooks per action (e.g. Vue plugin registers a post-moveFile hook that scans `.vue` imports) would make composition declarative. Not needed with one plugin, but the manual approach won't scale to two. Revisit when a second plugin (Svelte, Angular) is on the horizon.

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue compiler works around TypeScript's refusal to process `.vue` files. Read this before touching `src/plugins/vue/engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues. Includes the `ensureDaemon` one-shot bug.

---

## Where to find architecture detail

Each concern has a dedicated doc. Read those — don't rely on handoff for design specifics.

| Topic | Doc |
|-------|-----|
| Agent user characteristics — design constraints for tool interfaces | [`docs/agent-users.md`](agent-users.md) |
| Compiler/operation architecture, dispatcher design, `CompilerRegistry` | [`docs/architecture.md`](architecture.md) |
| MCP wire protocol, tool interface, `DAEMON_STARTING`, `filesSkipped` | [`docs/features/mcp-transport.md`](features/mcp-transport.md) |
| Daemon lifecycle, auto-spawn, socket protocol | [`docs/features/daemon.md`](features/daemon.md) |
| Vue compiler internals, virtual↔real path translation, `toVirtualLocation` | [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Implementation gotchas (MCP naming, `workspace` convention, Volar quirks, etc.) | [`docs/architecture.md`](architecture.md), [`docs/tech/volar-v3.md`](tech/volar-v3.md), [`docs/tech/tech-debt.md`](tech/tech-debt.md) |
| Known structural issues and their fixes | [`docs/tech/tech-debt.md`](tech/tech-debt.md) |
| Task specifications (ready and archived) | [`docs/specs/`](specs/) |
