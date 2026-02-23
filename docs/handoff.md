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

**132/132 tests passing.** Security controls, project restructure, all five operations plus `getDefinition`, provider/engine separation, data-driven dispatch, and filesystem watcher are complete. The file layout reflects domain boundaries:

```
src/
  cli.ts          ← registers only: daemon, serve
  schema.ts
  workspace.ts    ← isWithinWorkspace() — shared boundary utility
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts     ← socket server; promise-chain mutex; isDaemonAlive + removeDaemonFiles lifecycle fns; starts watcher
    paths.ts      ← socketPath, lockfilePath, ensureCacheDir only
    dispatcher.ts ← dispatchRequest; engine singletons; invalidateFile/invalidateAll
    watcher.ts    ← startWatcher(root, extensions, callbacks); chokidar + 200ms debounce
  engines/
    errors.ts     ← EngineError class + ErrorCode union
    types.ts      ← result types + LanguageProvider interface
    engine.ts     ← BaseEngine: shared rename/findReferences/getDefinition/moveFile
    text-utils.ts ← applyTextEdits(), offsetToLineCol() — shared by both engines
    file-walk.ts  ← walkFiles() + SKIP_DIRS + TS_EXTENSIONS + VUE_EXTENSIONS — shared by engines and watcher
    providers/
      ts.ts       ← TsProvider: compiler calls via ts-morph Project; refreshFile() for selective invalidation
      volar.ts    ← VolarProvider: compiler calls via Volar proxy + virtual↔real translation
    ts/
      engine.ts   ← TsEngine extends BaseEngine; moveSymbol (ts-morph AST); invalidateFile()
      project.ts  ← findTsConfig, findTsConfigForFile, isVueProject
    vue/
      engine.ts   ← VueEngine extends BaseEngine; moveSymbol stub (NOT_SUPPORTED); invalidateFile()
      scan.ts     ← updateVueImportsAfterMove (regex scan for .vue SFC imports)
      service-builder.ts ← buildVolarService() — extracted from VueEngine
```

**Known remaining gap** — `updateVueImportsAfterMove` (vue/scan) does not enforce workspace boundary on its regex scan. Low risk in practice (search root is clamped to tsconfig directory), tracked in tech-debt.md.

**Operations shipped:**
- `rename` — TS + Vue
- `moveFile` — TS + Vue
- `moveSymbol` — TS only; Vue throws `NOT_SUPPORTED` (dispatcher constraint, not Volar)
- `findReferences` — TS + Vue; read-only, returns all references to a symbol by position
- `getDefinition` — TS + Vue; read-only, returns definition location(s) for a symbol by position

---

## Next things to build

Evaluate each candidate: does the daemon's stateful engine make it meaningfully better than the agent editing directly? `rename`, `moveFile`, and `findReferences` benefit strongly because they require project-wide reference tracking.

- **Action-centric dispatcher refactor** — replace the engine-per-workspace model with a `ProviderRegistry` that actions pull from. Design is settled (see Architecture decisions below). Implement in three phases, each independently releasable:

  - **Phase 1 — add `ProviderRegistry` alongside engines (no behaviour change).** Add the `ProviderRegistry` interface (`projectProvider()` / `tsProvider()`) and `makeRegistry(filePath)` factory to the dispatcher. Add `afterSymbolMove(sourceFile, symbolName, destFile, workspace)` to `LanguageProvider` with no-op implementations on both providers. Wire the existing OPERATIONS table to receive a registry instead of an engine — keep `BaseEngine` and the engine classes alive, just thread the registry through. Delete `warmupEngine()` (lazy init falls out for free). All tests pass unchanged.

  - **Phase 2 — extract operations to action functions (delete `BaseEngine`).** Move `rename`, `findReferences`, `getDefinition`, and `moveFile` out of `BaseEngine` into standalone functions under `src/engines/actions/`. Each takes a `LanguageProvider` directly. Wire them into the OPERATIONS table via `registry.projectProvider()`. Delete `BaseEngine`. **Good dogfooding opportunity:** use `mcp__light-bridge__moveSymbol` on the light-bridge source itself to extract each method — this is a TS-only project so `moveSymbol` works today without the Vue gap.

  - **Phase 3 — fix `moveSymbol` and delete engine classes.** Implement `VolarProvider.afterSymbolMove` to scan `.vue` files for imports of the moved symbol and rewrite them (surgical — only the named symbol, unlike `afterFileRename` which rewrites all imports of the old path). Extract `TsEngine.moveSymbol` to `src/engines/actions/moveSymbol.ts`, taking `TsProvider` for AST surgery and `LanguageProvider` for the post-move hook. Delete `TsEngine` and `VueEngine`. `moveSymbol` now works in Vue projects; `NOT_SUPPORTED` is gone.

- **`findReferences` by file path** — "who imports this file?" is a different question from "who uses this symbol?". Options: union references across all exports (expensive), use `getEditsForFileRename` as a dry-run proxy (already available from `moveFile`), or scan import strings with the compiler's module resolver. Worth a separate design pass — keep separate from the symbol-position variant.
- **`searchText` + `replaceText`** — server-side grep-and-replace pair. Neither operation needs the daemon's project graph — implement as a lightweight module alongside the dispatcher, not as an engine method. `replaceText` accepts either a pattern+glob (blind replace-all) or an array of `{file, line, col, oldText, newText}` locations (surgical). `searchText` is its natural feed: returns match locations with optional surrounding context lines (`context` parameter, same semantics as `grep -C`); each hit is `{file, line, col, matchText, context: [{line, text, isMatch}]}`. For bash-less agents (Claude.ai, Cursor MCP-only), `searchText` is the only path to locating targets before replacing — without it `replaceText` has no feeder. For agents with bash, `rg --json` provides equivalent search but in a different schema; `searchText` removes the transformation step and makes the pipeline zero-friction. Implement as a pair.
- **`extractFunction`** — pull a selection into a named function, updating the call site
- **`inlineVariable` / `inlineFunction`** — collapse a trivially-used binding
- **`deleteFile`** — remove a file and clean up its imports in other files
- **`createFile`** — scaffolding with correct import paths inferred from location

---


## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer. Includes the `ensureDaemon` one-shot bug.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions of `@volar/language-core`, causing type mismatches. Fixed via `pnpm.overrides` in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `vue-engine.ts`.

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
