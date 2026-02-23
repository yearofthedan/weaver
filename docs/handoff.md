**Purpose:** Current state, source layout, architecture decisions, and next work items for engineers implementing features.
**Audience:** Engineers implementing features, AI agents working on the codebase.
**Status:** Current
**Related docs:** [Vision](vision.md) (roadmap), [Features](features/) (operations), [Tech Debt](tech/tech-debt.md) (known issues)

---

# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

Read the docs in this order:
1. `docs/vision.md` — what this is and where it's going
2. `docs/features/daemon.md` — understand the daemon before touching `serve`
3. `docs/features/mcp-transport.md` — how `serve` connects to the daemon
4. `docs/features/engines.md` — understand the engine boundary before touching anything
5. `docs/quality.md` — testing and reliability expectations

---

## Current state

**200/200 tests passing.** Security controls (including sensitive file blocklist), all seven operations, provider separation, data-driven dispatch, filesystem watcher, `stop` CLI command, and full action-centric refactor (Phases 1–3) are complete. Directory layout matches domain boundaries:

```
src/
  cli.ts          ← registers only: daemon, serve, stop
  schema.ts
  types.ts        ← result types + LanguageProvider + ProviderRegistry interfaces
  workspace.ts    ← isWithinWorkspace() — workspace boundary utility
  security.ts     ← isSensitiveFile() — sensitive file blocklist (.env, *.pem, keys, certs…)
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

### Features

Evaluate each candidate: does the daemon's stateful engine make it meaningfully better than the agent editing directly? `rename`, `moveFile`, and `findReferences` benefit strongly because they require project-wide reference tracking.

- **`findReferences` by file path** — "who imports this file?" is a different question from "who uses this symbol?". Options: union references across all exports (expensive), use `getEditsForFileRename` as a dry-run proxy (already available from `moveFile`), or scan import strings with the compiler's module resolver. Worth a separate design pass — keep separate from the symbol-position variant.
- **`moveSymbol` for class methods** — currently only top-level exported declarations are supported. "Extract this method to a standalone exported function in another module" is one of the most common refactoring patterns agents perform, and light-bridge can't help with it today. The extraction involves removing the method from the class, writing a standalone `export function` at the destination, rewriting all call sites from `instance.method(args)` to `method(instance, args)` or `method(args)` depending on whether `this` is used. The ts-morph AST has everything needed: `MethodDeclaration`, `CallExpression`, `this` references. Discovered during Phase 2 dogfooding — `BaseEngine` methods couldn't be extracted with `moveSymbol` because they were class methods, not top-level exports.
- **`extractFunction`** — pull a selection into a named function, updating the call site
- **`inlineVariable` / `inlineFunction`** — collapse a trivially-used binding
- **`deleteFile`** — remove a file and clean up its imports in other files
- **`createFile`** — scaffolding with correct import paths inferred from location

---

## Security & Architecture Issues

**`docs/security-architecture-review.md`** — high-priority bugs and architectural gaps. Read this before implementing features or touching security-sensitive code. Includes three critical issues (ReDoS, unvalidated socket params, workspace boundary in Vue scanning) and nine medium/low-severity findings with mitigation strategies and test cases.

**Recommended fix order:** ReDoS guard → socket validation → workspace boundary → timeout → error masking.

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue provider works around TypeScript's refusal to process `.vue` files. Read this before touching `src/providers/volar.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues. Includes the `ensureDaemon` one-shot bug.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions of `@volar/language-core`, causing type mismatches. Fixed via `pnpm.overrides` in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `volar.ts`.
- **`moveFile` does not update imports in files outside `tsconfig.include`** — `tsconfig.json` includes only `src/`; test files are not in the ts-morph project. Any file move that has importers in `tests/` requires manual import fixes. If tests are added outside `src/` for a new operation, remember to update their paths by hand. Tracked in tech-debt.md.

---

## Architecture decisions

- **Action-centric dispatcher — settled design** — operations are the core construct, not engines. Each action function pulls the provider capabilities it needs from a `ProviderRegistry` rather than being a method on an engine class. The registry has two named slots:

  ```typescript
  interface ProviderRegistry {
    projectProvider(): Promise<LanguageProvider>  // Volar in Vue projects, TsProvider otherwise
    tsProvider(): Promise<TsProvider>             // always ts-morph; for AST-level operations
  }
  ```

  `projectProvider` is scoped by `findTsConfigForFile(inputFile)` — in a monorepo, each package resolves to its own tsconfig and gets the right provider. No monorepo-specific design needed. Both providers are lazy singletons; each manages a per-tsconfig cache internally (`Map<tsconfig, Project|CachedService>`).

  `LanguageProvider` gains `afterSymbolMove(sourceFile, symbolName, destFile, workspace)` — a post-step hook symmetric with `afterFileRename`. `TsProvider` implements it as a no-op (TS import paths are handled by ts-morph AST edits in the action). `VolarProvider` implements it by scanning `.vue` files for imports of the specific `symbolName` and rewriting them to point at `destFile` (surgical — unlike `afterFileRename`, which rewrites all imports of the old path).

  Operations that need neither provider (e.g. `searchText`) receive the registry but simply ignore it.

- **`moveSymbol` for Vue sources (`.vue` → `.ts`) is buildable — no new deps needed** — `@vue/language-core` re-exports `parse()` (wraps `@vue/compiler-sfc` internally), returning an `Sfc` with `script.ast` as a `ts.SourceFile` plus block offsets. Extract the declaration from a `<script setup>` block, write to the destination `.ts`, and patch importers. `parseScriptSetupRanges` can locate `defineProps`/`defineEmits` declarations to avoid moving them. Moving *into* a `.vue` destination is not worth supporting. See `docs/tech/volar-v3.md` § "Package ecosystem" for the full API inventory.

- **Read-only operations do not take a `workspace` parameter in the engine interface** — `findReferences` returns all references including those outside the workspace; it is up to the dispatcher to validate the input file is within the workspace. Write operations (`rename`, `moveFile`, `moveSymbol`) take `workspace` because they need to know which collateral writes to skip.

- **`VueEngine.translateLocations` is the shared virtual→real mapping helper** — extracted from the inline loop in `rename`; reused by `findReferences` and `getDefinition`. Any future operation that reads positions from a Vue project should call this method rather than duplicating the source-map traversal.

- **`VueEngine.toVirtualLocation` for operations that don't auto-translate** — `findRenameLocations` and `getReferencesAtPosition` in Volar's proxy translate real `.vue` paths → `.vue.ts` automatically. `getDefinitionAtPosition` does NOT — it calls TypeScript's internal implementation directly and throws `Could not find source file: App.vue`. Fix: call `toVirtualLocation(absPath, pos)` first to map to the virtual `.vue.ts` coordinate space, then pass those to `getDefinitionAtPosition`. Results still go through `translateLocations` for the reverse mapping. Any future operation that hits the same error pattern needs this treatment.

- **MCP tool names and daemon method names are intentionally 1:1** — the MCP handler passes `tool.name` directly as the daemon method. There is no translation layer. A proposal to split the naming (e.g. different names at each layer to cover "file rename" vs "symbol rename") was rejected: the daemon is an internal IPC detail with no independent users, and "file rename" is already covered by `moveFile` (same code path, same operation). Splitting would add a translation table for no benefit.

- **MCP transport uses `@modelcontextprotocol/sdk`** — the agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`). The internal daemon↔serve socket uses plain newline-delimited JSON, no library needed.
- **SDK wire format is newline-delimited JSON — NOT Content-Length framed** — `StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. `McpTestClient` must match this format.
- **SDK is Zod v3/v4 agnostic** — pass Zod v3 schemas from `src/schema.ts` directly to `registerTool`. No version conflict.
- **Daemon socket: one connection per call** — `serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, closes.
- **`callDaemon` error → `DAEMON_STARTING`** — if the socket connection fails (e.g. daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent.
- **`ensureDaemon` fires once at startup** — if the daemon dies after `serve` starts, tool calls return `DAEMON_STARTING` permanently. See tech-debt.md for the fix.
- **Test helper: `McpTestClient`** — handles newline-delimited framing and the initialize handshake. `spawnAndWaitForReady` requires `{ pipeStdin: true }` for MCP tests.
- **Vertical slice tests assert before and after** — always read fixture files before the operation to confirm original state, then assert both old string is gone and new string present.
- **`filesSkipped` in engine results** — collateral writes outside the workspace are skipped and listed in `filesSkipped`. Agents should surface this to the user.
- **`ts-engine.moveFile` uses language service directly** — `ls.getEditsForFileRename()` applied file-by-file, then `fs.renameSync`. `sourceFile.move()` + `project.save()` has no per-file whitelist API. ts-morph project invalidated after the operation and rebuilt on next call.
