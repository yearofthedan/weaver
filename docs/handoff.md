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

**Picking up a task?** Tasks have one of two states:
- **Has a spec link** → ready to implement. Read the spec, then run `/slice`.
- **`[needs design]`** → problem understood, solution not yet agreed. Run `/spec` to create a spec with the user before writing code.

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
  promptfooconfig.yaml ← PromptFoo config; 15 tests across two providers (light-bridge-only + with-shell-alternatives); inline test definitions
  fixtures/            ← pre-recorded daemon JSON responses keyed by method name
  cases/               ← (reserved for per-tool case files if extracted in future)
.github/workflows/
  ci.yml               ← lint + build + test on push/PR
  quality-feedback.yml ← mutation testing (weekly + on push to main); Claude Code triage step on score < 75
.claude/skills/
  mutate-triage/       ← /mutate-triage skill: classify survivors, open issues for noise, fix PRs for fixable gaps
  light-bridge-refactoring/ ← shipped with npm; agent workflow guidance for light-bridge tools (when to use, response handling, sequences)
src/
  cli.ts          ← registers only: daemon, serve, stop
  schema.ts
  ports/
    filesystem.ts         ← FileSystem interface + barrel re-exports
    node-filesystem.ts    ← NodeFileSystem wrapping node:fs (production)
    in-memory-filesystem.ts ← InMemoryFileSystem Map-backed (unit tests)
  domain/
    workspace-scope.ts    ← WorkspaceScope boundary tracking + modification recording
    import-rewriter.ts    ← ImportRewriter — rewrites named imports/re-exports of a moved symbol across files
    symbol-ref.ts         ← SymbolRef — resolved exported symbol value object (lookup, unwrap, remove)
  types.ts        ← result types + LanguagePlugin + Compiler + CompilerRegistry interfaces
  security.ts     ← isWithinWorkspace() + isSensitiveFile() + validateFilePath() — boundary, sensitive file blocklist, path validation
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts                    ← socket server; promise-chain mutex; isDaemonAlive + removeDaemonFiles lifecycle fns; starts watcher
    ensure-daemon.ts             ← ensureDaemon (version check + auto-spawn); callDaemon (socket client); spawnDaemon
    paths.ts                     ← socketPath, lockfilePath, ensureCacheDir only
    dispatcher.ts                ← dispatchRequest; OPERATIONS table; re-exports registry functions
    language-plugin-registry.ts  ← LanguagePlugin registry; makeRegistry; invalidateFile/invalidateAll; registers built-in Vue plugin
    watcher.ts                   ← startWatcher(root, extensions, callbacks); chokidar + 200ms debounce
  plugins/
    vue/
      plugin.ts   ← createVueLanguagePlugin(); Vue/Volar LanguagePlugin factory (project detection, lifecycle)
      compiler.ts ← VolarCompiler: compiler calls via Volar proxy + virtual↔real translation; afterSymbolMove scans .vue files
      scan.ts     ← updateVueImportsAfterMove + removeVueImportsOfDeletedFile + updateVueNamedImportAfterSymbolMove (regex scans; uses WorkspaceScope for boundary enforcement)
      service.ts  ← buildVolarService() — Volar service factory
  operations/
    rename.ts          ← rename(compiler, filePath, line, col, newName, scope: WorkspaceScope)
    findReferences.ts  ← findReferences(compiler, filePath, line, col)
    getDefinition.ts   ← getDefinition(compiler, filePath, line, col)
    getTypeErrors.ts   ← getTypeErrors(tsCompiler, file?, scope: WorkspaceScope) — errors-only, cap 100
    moveFile.ts        ← moveFile(compiler, oldPath, newPath, scope: WorkspaceScope)
    moveDirectory.ts   ← moveDirectory(compiler, oldPath, newPath, scope: WorkspaceScope)
    moveSymbol.ts      ← moveSymbol(tsCompiler, projectCompiler, sourceFile, symbolName, destFile, scope: WorkspaceScope)
    extractFunction.ts ← extractFunction(tsCompiler, file, startLine, startCol, endLine, endCol, functionName, scope: WorkspaceScope)
    searchText.ts      ← searchText(pattern, scope: WorkspaceScope, { glob, context, maxResults })
    replaceText.ts     ← replaceText(scope: WorkspaceScope, { pattern, replacement, glob } | { edits })
    deleteFile.ts      ← deleteFile(tsCompiler, file, scope: WorkspaceScope)
  compilers/
    ts.ts              ← TsMorphCompiler: compiler calls via ts-morph Project; refreshFile() for selective invalidation
    ts-move-symbol.ts  ← tsMoveSymbol(): compiler work for moveSymbol (symbol lookup, AST surgery, import rewriting)
  utils/
    errors.ts     ← EngineError class + ErrorCode union
    text-utils.ts ← applyTextEdits(), offsetToLineCol()
    file-walk.ts  ← walkFiles() + SKIP_DIRS + TS_EXTENSIONS + VUE_EXTENSIONS
    ts-project.ts ← findTsConfig, findTsConfigForFile, isVueProject
```

**Features shipped:** see [`docs/features/README.md`](features/README.md) for the full tool index.

---

## Next things to build

Priorities run top to bottom. Complete a tier before starting the next — later tiers depend on the quality signal from earlier ones.

---

### P1 — Very high value bugs and tech debt

- **Test colocation and mutation speed** → [`docs/specs/20260305-colocate-tests.md`](specs/20260305-colocate-tests.md) — Two-stage refactor: (1) move unit tests next to source, integration tests to `__tests__/`; (2) refactor source files mixing concerns (`searchText` utilities, `security` concerns, `getTypeErrors` dispatcher plumbing) and optimize fixture copying for `perTest` coverage analysis.

- **`getTypeErrors` / write operations: add `warn` status level** `[needs design]` — Currently status is binary (`ok: true/false`). Type errors after a write operation (e.g. `moveFile` returns `ok: true` with `typeErrorCount > 0`) should surface as `status: "warn"` so agents know the operation succeeded structurally but left unresolved references. Supersedes the P4 "moveFile type error return contract" entry.

---

### P2 — High-value features / bugs / tech debt

- **CLI-first transport: expose operations as CLI subcommands** `[needs design]` — Currently operations are only reachable via MCP. Add CLI subcommands (e.g. `light-bridge rename --symbol Foo --to Bar`) that talk to the existing daemon. Benefits: zero context-token cost (MCP schemas consume input tokens every turn), no `.mcp.json` setup friction, works with any agent that can shell out, enables Unix piping and composition, enables interactive selection workflows (e.g. `replaceText --interactive` presenting matches one-by-one like `git add -p`), and `--dry-run` previews. MCP remains as an optional transport. The daemon architecture already supports this — the new layer is thin (arg parsing → daemon request → JSON output).

- **Pre-public release infrastructure** → [`docs/specs/20260304-pre-public-infra.md`](specs/20260304-pre-public-infra.md) — Release Please pipeline, CodeQL, branch protection, LICENSE, SECURITY.md, `package.json` modernisation
- `buildVolarService` refactoring `[needs design]` — extract named sub-functions from the ~176-line monolith; prerequisite for more Vue operations
- `findReferences` by file path `[needs design]` — "who imports this file?"; see [findReferences.md](features/findReferences.md)
---

### P3 — Medium-value features / bugs / tech debt

- **: Claude Code plugin** `[needs design]` — package as a Claude Code plugin (`.claude-plugin/plugin.json`); complements existing `typescript-lsp` code intelligence plugin with refactoring tools; one-command install via `/plugin install`
- **Workspace split: `app` + `tooling` (`conventions` + `evals`)** `[needs design]` — move `agent:check`, `agent:doctor`, and `eval` scripts plus related tests into a tooling project; keep app unit tests and mutation testing with app initially; define dependency ownership and migration steps that preserve CI and publish flows
- **: Claude Code Marketplace submission** `[needs design]` — submit to official Anthropic marketplace; position alongside LSP code intelligence plugins
- `getTypeErrors` Volar support for `.vue` files `[needs design]` — extend type error detection to `.vue` SFC `<script>` blocks
- `extractFunction` Vue support `[needs design]` — extend extractFunction to `.vue` SFC `<script setup>` blocks; depends on buildVolarService refactoring
- `moveSymbol` from a `.vue` source file `[needs design]` — symbol declared in `<script setup>` block; depends on buildVolarService refactoring; see [moveSymbol.md](features/moveSymbol.md)
- **`TsMorphCompiler.afterSymbolMove` fallback scan tests are in the wrong layer** `[needs design]` — Tests live in `tests/operations/moveSymbol-fallback.test.ts` but should be in `tests/compilers/ts-after-symbol-move.test.ts` calling `afterSymbolMove` directly. The "no-op" test formerly in `ts.test.ts` was a smoke test, not real coverage. The integration path (`moveSymbol` operation -> `tsMoveSymbol` -> `afterSymbolMove`) also needs a proper integration test in `moveSymbol_tsCompiler.test.ts`.
- **`moveSymbol` cannot move non-exported local functions** `[needs design]` — `moveSymbol` only handles top-level exported declarations. Attempting to move an unexported helper returns `SYMBOL_NOT_FOUND`. Workaround: manually create the destination file with the symbol exported, remove from source, add import. See handoff.md "Agent reflection" section for context.
- `createFile` `[needs design]` — scaffold a file with correct import paths
- **`searchText`/`replaceText` file enumeration bypasses `FileSystem` port** `[needs design]` — `walkWorkspaceFiles` (used by both operations) uses `spawnSync("git", ["ls-files", ...])` and `fs.readdirSync` directly instead of going through the `FileSystem` port. The `FileSystem` interface lacks a `readdir` method, so directory listing cannot be abstracted today. This is a DDD boundary violation: file enumeration is I/O that should go through the port for testability and consistency. Fix: add `readdir` (or a higher-level `walkFiles`) to the `FileSystem` interface, then migrate `walkWorkspaceFiles` and `walkRecursive` to use it.
- **`searchText` output optimization** `[needs design]` — context array adds ~70% JSON overhead (~150-200 bytes/match). Consider: (a) return `line`/`col` only; (b) only include context when explicitly requested; (c) sparse representation for non-matching lines. Low priority, large-result-set efficiency.
- **Agent guidance on type errors in tool responses** `[needs design]` — all write operations return `typeErrors`; agents need to know this is an action item (something wasn't fully updated) and follow up with `replaceText`. Currently nothing teaches this pattern. Decision needed: shipped skill file, tool description addition, CLAUDE.md guidance snippet, or combination?
- **`rename` doesn't catch derived variable names** `[needs design]` — `rename` follows the compiler's reference graph, which is correct for type-checked references. But when renaming `TsProvider` → `TsMorphCompiler`, variables like `tsProviderSingleton`, `pluginProviders`, `stubProvider` are untouched — they're just strings to the compiler. During the providers→compilers rename this meant ~100 extra tool calls for what should have been automatic. Possible approaches: (a) `rename --derived` flag that does a substring text pass after the compiler rename; (b) smarter `findReferences` that can return construct types (variable, type, import, parameter) like IntelliJ's "Find Usages" — let the caller filter by kind and batch-rename; (c) `rename` automatically identifies variables whose names derive from the renamed symbol (e.g. local variables typed as the renamed interface, or variables assigned from an import of the renamed symbol) and offers to rename them too. The IntelliJ model is worth studying — it distinguishes types, variables, imports, and string occurrences in its rename dialog.
- **Agents don't reach for the tools even when loaded** `[needs design]` — The `light-bridge-refactoring` skill is loaded on the execution agent and explicitly tells it to use `moveSymbol`, `rename`, `findReferences` etc. for cross-file changes. It still reaches for manual Edit + Grep instead. Observed during the `extensions.ts` extraction: agent manually moved constants and fixed imports by hand instead of calling `moveSymbol`. The skill file, tool descriptions, and MCP server instructions are all present — the agent ignores them. This is the existential problem for the project: if the tool's own development agent won't use the tools, external consumers won't either. Needs investigation into why agents bypass MCP tools in favour of built-in editing, and what (if anything) can make them prefer compiler-aware tools. Possible angles: tool description phrasing, latency/cost perception, response format, or fundamental model behaviour that can't be influenced by descriptions alone.

---

### P4 — Low priority

- **`moveSymbol` for class methods** — extract a method to a standalone exported function. Deferred: the only safe subset (static methods / no-`this` instance methods) doesn't update call sites, so it always leaves broken code. Without call-site rewriting, the value over manual `searchText` + `replaceText` is low. Revisit if call-site rewriting becomes tractable.
- **`inlineVariable` / `inlineFunction`** — less common refactoring pattern; complex to implement safely
- **Rollback / `--dry-run`** — multi-file operations have no all-or-nothing guarantee; documented precondition (clean git working tree) is workable for now
- **Watcher own-writes redundant invalidation** — safe as-is; only adds one extra rebuild per write-heavy op (see tech-debt.md)
- **Daemon discovery cache invalidation** — only hurts if `tsconfig.json` moves at runtime (see tech-debt.md)
- **`VolarLanguageService` hand-typed interface** — low urgency; will resolve naturally during further Volar refactoring (see tech-debt.md)
- **TOCTOU symlink race** — accepted risk; revisit only if deployment model changes (see tech-debt.md)

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue compiler works around TypeScript's refusal to process `.vue` files. Read this before touching `src/plugins/vue/compiler.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues. Includes the `ensureDaemon` one-shot bug.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions of `@volar/language-core`, causing type mismatches. Fixed via `pnpm.overrides` in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `volar.ts`.

---

## Agent reflection: `moveSymbol` limitation — only exported declarations

During the `moveFile` workspace-scope spec, the spec directed the agent to try `mcp__light-bridge__moveSymbol` to move `makeMockCompiler` from `tests/operations/rename.test.ts` to `tests/compilers/__helpers__/mock-compiler.ts`. The call returned `SYMBOL_NOT_FOUND` because `makeMockCompiler` is a local (non-exported) function.

`moveSymbol` only handles **top-level exported declarations** (`export function`, `export const`, `export class`, etc.). It cannot move unexported helpers. When a symbol needs to be extracted and made public for the first time, the workflow is:

1. Try `moveSymbol` — if it returns `SYMBOL_NOT_FOUND`, the symbol is not exported.
2. Fall back to: create the destination file manually with the symbol exported, then remove it from the source and add the import.

There is no light-bridge tool for "add export keyword + move". This is a known gap — if it becomes a recurring friction point, add a `[needs design]` entry.

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
