**Purpose:** Current state, source layout, and prioritised next work items. Each task either links to a spec file (ready to implement) or is marked `[needs design]` (needs a `/spec` pass first).
**Audience:** Engineers implementing features, AI agents working on the codebase.
**Status:** Current
**Related docs:** [Why](why.md) (product rationale), [Features](features/) (operations), [Tech Debt](tech/tech-debt.md) (known issues), [Specs](specs/) (task specifications)

---

# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

**New to the codebase?** Read in this order:
1. [`docs/why.md`](why.md) — what this is and why it exists
2. [`docs/features/daemon.md`](features/daemon.md) — understand the daemon before touching `serve`
3. [`docs/features/mcp-transport.md`](features/mcp-transport.md) — how `serve` connects to the daemon
4. [`docs/architecture.md`](architecture.md) — provider/operation architecture; read before touching anything in `src/`
5. [`docs/quality.md`](quality.md) — testing and reliability expectations

**Picking up a task?** Tasks have one of two states:
- **Has a spec link** → ready to implement. Read the spec, then run `/slice`.
- **`[needs design]`** → problem understood, solution not yet agreed. Run `/spec` to create a spec with the user before writing code.

An agent discovering new work should add a `[needs design]` entry and move on — do not design it in the same session.

**Finishing a task?** The spec's Done-when section is the checklist. Key items:
1. Archive the spec to `docs/specs/archive/` with an Outcome section
2. Remove or update the entry below
3. Update docs if public surfaces changed (see Done-when in the spec)
4. Write gotchas or decisions to `docs/agent-memory.md`

---

## Current state

Directory layout matches domain boundaries:

```
eval/
  fixture-server.ts    ← socket server that impersonates the daemon for eval runs; exports startFixtureServer
  run-eval.ts          ← entry point: starts fixture server, runs promptfoo, tears down
  promptfooconfig.yaml ← PromptFoo config; 5 positive cases + 1 negative case; inline test definitions
  fixtures/            ← pre-recorded daemon JSON responses keyed by method name
  cases/               ← (reserved for per-tool case files if extracted in future)
src/
  cli.ts          ← registers only: daemon, serve, stop
  schema.ts
  types.ts        ← result types + LanguageProvider + ProviderRegistry interfaces
  security.ts     ← isWithinWorkspace() + isSensitiveFile() — boundary + sensitive file blocklist
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts         ← socket server; promise-chain mutex; isDaemonAlive + removeDaemonFiles lifecycle fns; starts watcher
    ensure-daemon.ts  ← ensureDaemon (version check + auto-spawn); callDaemon (socket client); spawnDaemon
    paths.ts          ← socketPath, lockfilePath, ensureCacheDir only
    dispatcher.ts     ← dispatchRequest; provider singletons; invalidateFile/invalidateAll
    watcher.ts        ← startWatcher(root, extensions, callbacks); chokidar + 200ms debounce
  operations/
    rename.ts        ← rename(provider, filePath, line, col, newName, workspace)
    findReferences.ts← findReferences(provider, filePath, line, col)
    getDefinition.ts ← getDefinition(provider, filePath, line, col)
    getTypeErrors.ts ← getTypeErrors(tsProvider, file?, workspace) — errors-only, cap 100
    moveFile.ts      ← moveFile(provider, oldPath, newPath, workspace)
    moveSymbol.ts    ← moveSymbol(tsProvider, projectProvider, sourceFile, symbolName, destFile, workspace)
    searchText.ts    ← searchText(pattern, workspace, { glob, context, maxResults })
    replaceText.ts   ← replaceText(workspace, { pattern, replacement, glob } | { edits })
  providers/
    ts.ts         ← TsProvider: compiler calls via ts-morph Project; refreshFile() for selective invalidation
    volar.ts      ← VolarProvider: compiler calls via Volar proxy + virtual↔real translation; afterSymbolMove scans .vue files
    vue-scan.ts   ← updateVueImportsAfterMove + updateVueNamedImportAfterSymbolMove (regex scans; enforces workspace boundary)
    vue-service.ts← buildVolarService() — Volar service factory
  utils/
    errors.ts     ← EngineError class + ErrorCode union
    text-utils.ts ← applyTextEdits(), offsetToLineCol()
    file-walk.ts  ← walkFiles() + SKIP_DIRS + TS_EXTENSIONS + VUE_EXTENSIONS
    ts-project.ts ← findTsConfig, findTsConfigForFile, isVueProject
```

**Operations shipped:**
- `rename` — TS + Vue
- `moveFile` — TS + Vue
- `moveSymbol` — TS + Vue
- `findReferences` — TS + Vue; read-only, returns all references to a symbol by position
- `getDefinition` — TS + Vue; read-only, returns definition location(s) for a symbol by position
- `getTypeErrors` — TS only; read-only, returns type errors for a single file or whole project; capped at 100
- `searchText` — regex search across workspace files; glob filter, context lines, max-results cap; skips sensitive files
- `replaceText` — pattern mode (regex replace-all + optional glob) or surgical mode (edits array with oldText verification); skips sensitive files

---

## Next things to build

Priorities run top to bottom. Complete a tier before starting the next — later tiers depend on the quality signal from earlier ones.

---

### P1 — Fix now (bugs / correctness)

*(none)*

---

### P2 — Test quality (before adding more features)

Stryker mutation testing is operational: `pnpm test:mutate`. See [`quality.md`](quality.md) for per-module breakdown and surviving mutants.


- Agent triage on mutation score warning `[needs design]` — when quality feedback warns (score below threshold), trigger an agent run to inspect surviving mutants and either open an issue or attempt a fix branch

---

### P3 — High-value features

- `getTypeErrors` post-write diagnostics `[needs design]` — after write operations, refresh cache and check for type errors; append `typeErrors` array to result
- `moveSymbol` for class methods `[needs design]` — extract a method to a standalone exported function; see [moveSymbol.md](features/moveSymbol.md)
- `extractFunction` `[needs design]` — pull a selection into a named function, updating the call site
- `deleteFile` `[needs design]` — remove a file and clean up imports in referencing files

---

### P4 — Medium-value features and tech debt

- `findReferences` by file path `[needs design]` — "who imports this file?"; see [findReferences.md](features/findReferences.md)
- `getTypeErrors` Volar support for `.vue` files `[needs design]` — extend type error detection to `.vue` SFC `<script>` blocks
- `buildVolarService` refactoring `[needs design]` — extract named sub-functions from the ~176-line monolith; prerequisite for more Vue operations
- `moveSymbol` from a `.vue` source file `[needs design]` — symbol declared in `<script setup>` block; depends on buildVolarService refactoring; see [moveSymbol.md](features/moveSymbol.md)
- `createFile` `[needs design]` — scaffold a file with correct import paths
- Claude Code plugin distribution `[needs design]` — `.claude-plugin/plugin.json`, `--write-only` flag, dual language server evaluation; see [daemon.md](features/daemon.md)

---

### P5 — Low priority / accepted

- **`inlineVariable` / `inlineFunction`** — less common refactoring pattern; complex to implement safely
- **Rollback / `--dry-run`** — multi-file operations have no all-or-nothing guarantee; documented precondition (clean git working tree) is workable for now
- **Watcher own-writes redundant invalidation** — safe as-is; only adds one extra rebuild per write-heavy op (see tech-debt.md)
- **Daemon discovery cache invalidation** — only hurts if `tsconfig.json` moves at runtime (see tech-debt.md)
- **`VolarLanguageService` hand-typed interface** — low urgency; will resolve naturally during further Volar refactoring (see tech-debt.md)
- **TOCTOU symlink race** — accepted risk; revisit only if deployment model changes (see tech-debt.md)

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue provider works around TypeScript's refusal to process `.vue` files. Read this before touching `src/providers/volar.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues. Includes the `ensureDaemon` one-shot bug.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions of `@volar/language-core`, causing type mismatches. Fixed via `pnpm.overrides` in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `volar.ts`.
- **`moveFile` does not update imports in files outside `tsconfig.include`** — `tsconfig.json` includes only `src/`; test files are not in the ts-morph project. Two failure modes: (a) if a source file is moved, any test files that import it will not have their import paths updated; (b) if a test file itself is moved to a different directory depth, its own imports to `src/` will not be rewritten. Both require manual `replaceText` fixes. If tests are added outside `src/` for a new operation, remember to update their paths by hand. Tracked in tech-debt.md.

---

## Where to find architecture detail

Each concern has a dedicated doc. Read those — don't rely on handoff for design specifics.

| Topic | Doc |
|-------|-----|
| Provider/operation architecture, dispatcher design, `ProviderRegistry` | [`docs/architecture.md`](architecture.md) |
| MCP wire protocol, tool interface, `DAEMON_STARTING`, `filesSkipped` | [`docs/features/mcp-transport.md`](features/mcp-transport.md) |
| Daemon lifecycle, auto-spawn, socket protocol | [`docs/features/daemon.md`](features/daemon.md) |
| Vue provider internals, virtual↔real path translation, `toVirtualLocation` | [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Implementation gotchas, hard-won decisions (MCP naming, read-only `workspace` convention, etc.) | [`docs/agent-memory.md`](agent-memory.md) |
| Known structural issues and their fixes | [`docs/tech/tech-debt.md`](tech/tech-debt.md) |
| Task specifications (ready and archived) | [`docs/specs/`](specs/) |
