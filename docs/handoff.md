**Purpose:** Current state, source layout, and prioritised next work items. Each task links to its feature doc for the detailed spec.
**Audience:** Engineers implementing features, AI agents working on the codebase.
**Status:** Current
**Related docs:** [Vision](vision.md) (roadmap), [Features](features/) (operations), [Tech Debt](tech/tech-debt.md) (known issues)

---

# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

**New to the codebase?** Read in this order:
1. [`docs/vision.md`](vision.md) — what this is and where it's going
2. [`docs/features/daemon.md`](features/daemon.md) — understand the daemon before touching `serve`
3. [`docs/features/mcp-transport.md`](features/mcp-transport.md) — how `serve` connects to the daemon
4. [`docs/features/architecture.md`](features/architecture.md) — provider/operation architecture; read before touching anything in `src/`
5. [`docs/quality.md`](quality.md) — testing and reliability expectations

**Picking up a task?** Each item in "Next things to build" links to its feature doc. The feature doc is the detailed spec — start there, then come back to the task entry for the implementation notes that aren't in the doc. If no feature doc is linked, writing the design doc is the first step.

---

## Current state

**320/320 tests passing. Mutation score: 80.11% overall (full run as of 309 tests). Per-module highlights: `getDefinition.ts` 93.33%, `searchText.ts` 80.77%, `moveSymbol.ts` 80.58%, `file-walk.ts` 86.67% (all above threshold), `volar.ts` 73.91% (below threshold — many accepted survivors). Coverage: operations 95.68% lines / 84.49% branches; providers 91.61% / 66.04%; utils 98.70% / 96.55%; security 94.11% / 100%; daemon folder 60.4% statements / 58.65% lines (at threshold); mcp.ts 33.67% (subprocess-level gap remains).** Security controls (sensitive file blocklist), all seven operations, provider separation, data-driven dispatch, filesystem watcher, `stop` CLI command, action-centric architecture, protocol version check in `ensureDaemon`, mutation testing across `src/operations/`, `src/utils/`, `src/security.ts`, and `src/providers/`, portable `.mcp.json` defaults, npm distribution (`@yearofthedan/light-bridge`), and response contract consistency (success/failure semantics locked in docs and code) are complete. Directory layout matches domain boundaries:

```
src/
  cli.ts          ← registers only: daemon, serve, stop
  schema.ts
  types.ts        ← result types + LanguageProvider + ProviderRegistry interfaces
  security.ts     ← isWithinWorkspace() + isSensitiveFile() — boundary + sensitive file blocklist
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts     ← socket server; promise-chain mutex; isDaemonAlive + removeDaemonFiles lifecycle fns; starts watcher
    paths.ts      ← socketPath, lockfilePath, ensureCacheDir only
    dispatcher.ts ← dispatchRequest; provider singletons; invalidateFile/invalidateAll
    watcher.ts    ← startWatcher(root, extensions, callbacks); chokidar + 200ms debounce
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

Stryker mutation testing is operational: `pnpm test:mutate` runs across `src/operations/`, `src/utils/`, `src/security.ts`, and `src/providers/` in ~13 minutes. Overall score: **76.23% (79.50% covered)**. See [`quality.md`](quality.md) for the full per-module breakdown and surviving mutants table.

**7. Next mutation round: `volar.ts` (73.91%)** — below 80% threshold. `moveSymbol.ts` (80.58%) and `file-walk.ts` (86.67%) are above threshold. The 24 surviving mutants in `volar.ts` are dominated by accepted ones (caching guards, toVirtualLocation fallback branches, translateSingleLocation Volar-glue paths). See the "Worth fixing" table in `quality.md` for specific remaining gaps.

**9. Coverage improvement: `src/mcp.ts`** — 33.67%. `src/daemon/` is at the 60%+ folder-level target (60.4% statements). The remaining `mcp.ts` gap is in `ensureDaemon`, `startMcpServer`, and `spawnDaemon` — code that only runs when the full MCP server is spawned over stdio. `spawnDaemon` uses `process.execPath` + `dist/cli.js`. Reaching 60% requires either subprocess-level instrumentation or extracting those functions into a separately testable module.

**10. Documentation freshness guardrails (process + automation)**
Feature docs: [`features/cli.md`](features/cli.md), [`features/mcp-transport.md`](features/mcp-transport.md), [`features/architecture.md`](features/architecture.md)
Recent drift showed docs can silently lag code (tool list, command list, watcher status, path layout). Add guardrails at three layers:
- **Agent workflow:** update `.claude/skills/slice/SKILL.md` so every completed slice explicitly updates affected feature docs/README and validates doc links before commit.
- **Project policy:** add a CLAUDE rule for doc-sync triggers (new/renamed MCP tool, CLI command, error code, provider/operation layout change) and required files to touch.
- **Automated check:** add `pnpm docs:check` in CI to compare canonical runtime surfaces (`src/mcp.ts` TOOLS, `src/cli.ts` commands) against documented surfaces and fail on mismatch.

Acceptance criteria:
- docs drift on MCP tool names / CLI command names fails CI
- slice skill contains an explicit doc-sync step with a checklist
- CLAUDE guidance defines when doc updates are mandatory vs optional

**11. Scope an Agent+MCP eval approach with the owner before building**
Feature docs: [`quality.md`](quality.md), [`features/mcp-transport.md`](features/mcp-transport.md), [`README.md`](../README.md)
Current tests prove engine correctness and protocol behavior, but the right eval shape for agent behavior is product-direction dependent. Do a short scoping pass with the owner first, then implement only the agreed slice.

Acceptance criteria:
- a brief design note captures agreed goals/non-goals, success metrics, and where eval should run (CI, local-only, scheduled, etc.)
- scope is explicitly approved by the owner before implementation work starts
- the first implementation task in handoff references that approved scope doc instead of assuming a fixed eval architecture

---

### P3 — High-value features

**9. `findReferences` by file path**
Feature doc: [`features/findReferences.md`](features/findReferences.md) — covers the symbol-position variant; the file-path variant needs a design section added.
"Who imports this file?" is a different question from "who uses this symbol?". Options: union references across all exports (expensive), use `getEditsForFileRename` as a dry-run proxy (already available from `moveFile`), or scan import strings with the compiler's module resolver. Worth a separate design pass — keep separate from the symbol-position variant.

**9. `moveSymbol` for class methods**
Feature doc: [`features/moveSymbol.md`](features/moveSymbol.md) — covers the current top-level-export behaviour; class method extraction needs a design section added.
Currently only top-level exported declarations are supported. "Extract this method to a standalone exported function in another module" is one of the most common refactoring patterns agents perform. The extraction involves removing the method from the class, writing a standalone `export function` at the destination, rewriting all call sites from `instance.method(args)` to `method(instance, args)` or `method(args)` depending on whether `this` is used. The ts-morph AST has everything needed: `MethodDeclaration`, `CallExpression`, `this` references. Discovered during Phase 2 dogfooding — `BaseEngine` methods couldn't be extracted with `moveSymbol` because they were class methods, not top-level exports.

**10. `deleteFile`**
Feature doc: none yet — write the design doc as the first step.
Remove a file and clean up its imports in referencing files. Simpler than `createFile` (no scaffolding logic); the compiler already knows all importers via `getEditsForFileRename`.

---

### P4 — Medium-value features and tech debt

**11. `buildVolarService` refactoring**
Feature docs: [`features/architecture.md`](features/architecture.md), [`tech/volar-v3.md`](tech/volar-v3.md)
`src/providers/vue-service.ts` is ~176 lines doing 8 distinct things in sequence: library imports, file-contents map, tsconfig parsing, file collection, Volar language setup, virtual-path mapping, service-host creation, service decoration. Extract named sub-functions for each phase; the top-level function orchestrates. Prerequisite before adding more Vue-specific operations.

**12. `moveSymbol` from a `.vue` source file**
Feature doc: [`features/moveSymbol.md`](features/moveSymbol.md)
Moving a top-level export *from* a `.ts` file in a Vue project is complete — ts-morph handles `.ts` importers; `VolarProvider.afterSymbolMove` patches `.vue` SFC importers. The remaining case is a symbol declared *inside* a `.vue` `<script setup>` block: use `@vue/compiler-sfc`'s `parse()` to locate and splice the `<script>` block (`@vue/language-core` re-exports it; already a transitive dep). Moving *into* a `.vue` destination is not worth supporting. Depends on #11.

**13. `createFile`**
Feature doc: none yet — write the design doc as the first step.
Scaffold a file with correct import paths inferred from its location.

**14. `extractFunction`**
Feature doc: none yet — write the design doc as the first step.
Pull a selection into a named function, updating the call site. High potential value but AST-level code generation is complex across all call-site shapes; wait until P1–P3 are stable.

**15. Claude Code plugin distribution**
Feature docs: [`features/architecture.md`](features/architecture.md), [`features/daemon.md`](features/daemon.md)
npm distribution is complete (`@yearofthedan/light-bridge`). The remaining question is how to distribute as a Claude Code plugin — Claude Code has a plugin system supporting MCP servers, LSP servers, skills, and hooks. A plugin can declare `mcpServers` in `.claude-plugin/plugin.json` using `${CLAUDE_PLUGIN_ROOT}` paths and `lspServers` via `.lsp.json` for language diagnostics.

A `--write-only` flag on `serve` would let the plugin's MCP server omit read-only tools (`findReferences`, `getDefinition`, `searchText`) when Claude Code's native LSP handles navigation. This avoids tool duplication while keeping refactoring tools MCP-only (where they need daemon state).

Open concern — dual language server: if the plugin provides a Vue LSP (diagnostics/navigation) AND the MCP server uses Volar internally (refactoring), two TS language servers run simultaneously. They serve different purposes (LSP = diagnostics + go-to-definition; Volar engine = rename/move), but the memory/CPU overhead needs evaluation. Options: accept the overlap (different responsibilities), make `--write-only` also skip Volar initialization, or ship MCP-only without an LSP.

Tasks:
1. Add `--write-only` flag to `serve` — filter TOOLS array, extract `getToolList()` for testability
2. Create `.claude-plugin/plugin.json` with inline `mcpServers` using `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`
3. Create `.lsp.json` for Vue language server (prerequisite: `@vue/language-server` installed)
4. Evaluate dual language server overhead — decide whether to ship both or MCP-only

**16. Docs IA pass: decide `architecture.md` placement**
Feature doc: [`features/architecture.md`](features/architecture.md)
`architecture.md` is now correctly named, but placement is still a docs-information-architecture question: keep under `features/` (current "operations + infrastructure" convention) or move to top-level `docs/` as a cross-cutting architecture doc. Do this as a single IA pass, not piecemeal:
- choose canonical location and naming convention for cross-cutting docs (`architecture`, `security`, `quality`, etc.)
- migrate links in one commit
- preserve compatibility for deep links (stub file at old path or explicit redirect note)
- update `docs/README.md` grouping to match the chosen structure

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
| Provider/operation architecture, dispatcher design, `ProviderRegistry` | [`docs/features/architecture.md`](features/architecture.md) |
| MCP wire protocol, tool interface, `DAEMON_STARTING`, `filesSkipped` | [`docs/features/mcp-transport.md`](features/mcp-transport.md) |
| Daemon lifecycle, auto-spawn, socket protocol | [`docs/features/daemon.md`](features/daemon.md) |
| Vue provider internals, virtual↔real path translation, `toVirtualLocation` | [`docs/tech/volar-v3.md`](tech/volar-v3.md) |
| Implementation gotchas, hard-won decisions (MCP naming, read-only `workspace` convention, etc.) | [`docs/agent-memory.md`](agent-memory.md) |
| Known structural issues and their fixes | [`docs/tech/tech-debt.md`](tech/tech-debt.md) |

---

## Completed: agent tool adoption improvements

The MCP server includes server-level `instructions` (via `McpServer` constructor) providing orientation about supported file types, the compiler reference graph advantage, and token savings over manual file reading. Tool descriptions lead with triggers ("when renaming an identifier", "before modifying a symbol") rather than capabilities. No skill file yet — revisit if dogfooding reveals workflow gaps the descriptions can't cover.
