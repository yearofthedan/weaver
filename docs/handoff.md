**Purpose:** Current state, source layout, and prioritised next work items. Each task links to its feature doc for the detailed spec.
**Audience:** Engineers implementing features, AI agents working on the codebase.
**Status:** Current
**Related docs:** [Why](why.md) (product rationale), [Features](features/) (operations), [Tech Debt](tech/tech-debt.md) (known issues)

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

**Picking up a task?** Tasks are at one of two levels:
- **`[needs design]`** — the problem is understood but the solution isn't. First move: propose a design and acceptance criteria to the user. Do not write code until ACs are agreed.
- **No tag** — has acceptance criteria, ready to implement. Read the linked feature doc, then use the task entry for implementation notes not in the doc.

An agent discovering new work should add a `[needs design]` entry and move on — do not block on designing it in the same session.

**Finishing a task?** Before committing, verify:
1. Remove the task from the backlog below (or move to P5 if accepted/deferred)
2. If you added/removed MCP tools, changed CLI commands, or changed error codes: update `README.md`
3. If the feature spec changed: update the relevant `docs/features/*.md`
4. Write any new gotchas or decisions to `docs/agent-memory.md`
5. Commit with a conventional commit message (see `CLAUDE.md`)

---

## Current state

Directory layout matches domain boundaries:

```
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
- `searchText` — regex search across workspace files; glob filter, context lines, max-results cap; skips sensitive files
- `replaceText` — pattern mode (regex replace-all + optional glob) or surgical mode (edits array with oldText verification); skips sensitive files

---

## Next things to build

Priorities run top to bottom. Complete a tier before starting the next — later tiers depend on the quality signal from earlier ones.

---

### P1 — Fix now (bugs / correctness)

### P2 — Test quality (before adding more features)

Feature doc: [`quality.md`](quality.md) — covers mutation testing strategy, coverage targets by module, surviving mutants table, and what not to do.

Stryker mutation testing is operational: `pnpm test:mutate` runs across `src/operations/`, `src/utils/`, `src/security.ts`, `src/providers/`, and `src/daemon/ensure-daemon.ts`. See [`quality.md`](quality.md) for the full per-module breakdown, surviving mutants table, and hard-won lessons (including why TypeScript `strict` mode does not kill any surviving mutants).

**11. Scope an Agent+MCP eval approach with the owner before building**
Feature docs: [`quality.md`](quality.md), [`features/mcp-transport.md`](features/mcp-transport.md), [`README.md`](../README.md)
Current tests prove engine correctness and protocol behavior, but the right eval shape for agent behavior is product-direction dependent. Do a short scoping pass with the owner first, then implement only the agreed slice.

Acceptance criteria:
- a brief design note captures agreed goals/non-goals, success metrics, and where eval should run (CI, local-only, scheduled, etc.)
- scope is explicitly approved by the owner before implementation work starts
- the first implementation task in handoff references that approved scope doc instead of assuming a fixed eval architecture

**12. Agent triage on mutation score warning** `[needs design]`
When the Quality Feedback workflow warns (score below threshold), trigger a Claude Code agent run to inspect surviving mutants and either open a GitHub issue summarising gaps or attempt a fix branch. Key design questions: report-only vs auto-fix, what artifact the agent receives (HTML report, JSON report, or inline Stryker run), and guardrails on which files it can touch. Uses `claude-code-action` in a second job conditioned on the mutation step outcome.

---

### P3 — High-value features

**8. `getTypeErrors` — standalone tool + post-write diagnostics**

Two parts:
1. **Standalone `getTypeErrors` MCP tool** — check a specific file or the whole project for type errors. Optional `file` param (absolute path); if omitted, checks all project files. Returns `{ diagnostics: [{ file, line, col, code, message }], errorCount, truncated }`. Errors only (no warnings). Cap at 100 results.
2. **Post-write type diagnostics** — after every write operation (rename, moveFile, moveSymbol, replaceText), refresh modified files in the provider cache and check them for type errors. Append `typeErrors` array to the result. Cap at 20.

Both use the same diagnostic extraction logic via TsProvider. TS/TSX files only (Vue `.vue` SFC diagnostics are a follow-on — see P4 item 16).

Implementation notes:
- New `src/operations/getTypeErrors.ts` — shared diagnostic extraction
- `src/daemon/dispatcher.ts` — post-write hook after write ops; calls `invalidateFile()` then extracts diagnostics for `filesModified`
- `src/mcp.ts` — new tool entry (after `getDefinition`, before `searchText`)
- `src/schema.ts` / `src/types.ts` — schema + result types

Acceptance criteria:
- Standalone `getTypeErrors` tool returns type errors for a single file when `file` is provided
- Standalone `getTypeErrors` tool returns project-wide errors when `file` is omitted, capped at 100 with `truncated: true` when exceeded
- Write operations (rename, moveFile, moveSymbol, replaceText) include a `typeErrors` array in their response, containing errors from `filesModified` files only, capped at 20
- Dispatcher refreshes modified files in the provider cache before extracting diagnostics (no stale AST)
- Each diagnostic includes: `file` (absolute path), `line` (1-based), `col` (1-based), `code` (TS error number), `message`
- Errors only — warnings/suggestions are excluded
- `README.md` tool table updated, `docs/features/getTypeErrors.md` created
- Tests cover: single-file errors, project-wide with cap, post-write diagnostics on rename, clean file returns empty array

**9. `findReferences` by file path** `[needs design]`
Feature doc: [`features/findReferences.md`](features/findReferences.md) — covers the symbol-position variant; the file-path variant needs a design section added.
"Who imports this file?" is a different question from "who uses this symbol?". Options: union references across all exports (expensive), use `getEditsForFileRename` as a dry-run proxy (already available from `moveFile`), or scan import strings with the compiler's module resolver. Worth a separate design pass — keep separate from the symbol-position variant.

**9. `moveSymbol` for class methods** `[needs design]`
Feature doc: [`features/moveSymbol.md`](features/moveSymbol.md) — covers the current top-level-export behaviour; class method extraction needs a design section added.
Currently only top-level exported declarations are supported. "Extract this method to a standalone exported function in another module" is one of the most common refactoring patterns agents perform. The extraction involves removing the method from the class, writing a standalone `export function` at the destination, rewriting all call sites from `instance.method(args)` to `method(instance, args)` or `method(args)` depending on whether `this` is used. The ts-morph AST has everything needed: `MethodDeclaration`, `CallExpression`, `this` references. Discovered during Phase 2 dogfooding — `BaseEngine` methods couldn't be extracted with `moveSymbol` because they were class methods, not top-level exports.

**10. `deleteFile`** `[needs design]`
Remove a file and clean up its imports in referencing files. Simpler than `createFile` (no scaffolding logic); the compiler already knows all importers via `getEditsForFileRename`.

---

### P4 — Medium-value features and tech debt

**11. `buildVolarService` refactoring**
Feature docs: [`architecture.md`](architecture.md), [`tech/volar-v3.md`](tech/volar-v3.md)
`src/providers/vue-service.ts` is ~176 lines doing 8 distinct things in sequence: library imports, file-contents map, tsconfig parsing, file collection, Volar language setup, virtual-path mapping, service-host creation, service decoration. Extract named sub-functions for each phase; the top-level function orchestrates. Prerequisite before adding more Vue-specific operations.

**12. `moveSymbol` from a `.vue` source file**
Feature doc: [`features/moveSymbol.md`](features/moveSymbol.md)
Moving a top-level export *from* a `.ts` file in a Vue project is complete — ts-morph handles `.ts` importers; `VolarProvider.afterSymbolMove` patches `.vue` SFC importers. The remaining case is a symbol declared *inside* a `.vue` `<script setup>` block: use `@vue/compiler-sfc`'s `parse()` to locate and splice the `<script>` block (`@vue/language-core` re-exports it; already a transitive dep). Moving *into* a `.vue` destination is not worth supporting. Depends on #11.

**13. `createFile`** `[needs design]`
Scaffold a file with correct import paths inferred from its location.

**14. `extractFunction`** `[needs design]`
Pull a selection into a named function, updating the call site. High potential value but AST-level code generation is complex across all call-site shapes; wait until P1–P3 are stable.

**16. `getTypeErrors` Volar support for `.vue` files** `[needs design]`
Extend type error detection to `.vue` SFC `<script>` blocks via VolarProvider. Requires the same virtual-to-real path translation used by `findReferences` and `getDefinition` in Volar. Depends on P3 item 8 (TS-only `getTypeErrors`) shipping first. Design questions: whether to use `@volar/typescript` proxy's `getSemanticDiagnostics` or Volar's own diagnostic API, and how to map virtual-file positions back to SFC line numbers.

**15. Claude Code plugin distribution**
Feature docs: [`architecture.md`](architecture.md), [`features/daemon.md`](features/daemon.md)
npm distribution is complete (`@yearofthedan/light-bridge`). The remaining question is how to distribute as a Claude Code plugin — Claude Code has a plugin system supporting MCP servers, LSP servers, skills, and hooks. A plugin can declare `mcpServers` in `.claude-plugin/plugin.json` using `${CLAUDE_PLUGIN_ROOT}` paths and `lspServers` via `.lsp.json` for language diagnostics.

A `--write-only` flag on `serve` would let the plugin's MCP server omit read-only tools (`findReferences`, `getDefinition`, `searchText`) when Claude Code's native LSP handles navigation. This avoids tool duplication while keeping refactoring tools MCP-only (where they need daemon state).

Open concern — dual language server: if the plugin provides a Vue LSP (diagnostics/navigation) AND the MCP server uses Volar internally (refactoring), two TS language servers run simultaneously. They serve different purposes (LSP = diagnostics + go-to-definition; Volar engine = rename/move), but the memory/CPU overhead needs evaluation. Options: accept the overlap (different responsibilities), make `--write-only` also skip Volar initialization, or ship MCP-only without an LSP.

Tasks:
1. Add `--write-only` flag to `serve` — filter TOOLS array, extract `getToolList()` for testability
2. Create `.claude-plugin/plugin.json` with inline `mcpServers` using `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`
3. Create `.lsp.json` for Vue language server (prerequisite: `@vue/language-server` installed)
4. Evaluate dual language server overhead — decide whether to ship both or MCP-only

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

