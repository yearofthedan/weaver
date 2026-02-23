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

**125/125 tests passing.** Security controls, project restructure, all five operations plus `getDefinition`, and architecture slices A1–A6 complete. The file layout reflects domain boundaries:

```
src/
  cli.ts          ← registers only: daemon, serve
  schema.ts
  workspace.ts    ← isWithinWorkspace() — shared boundary utility
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts     ← socket server; promise-chain mutex; isDaemonAlive + removeDaemonFiles lifecycle fns
    paths.ts      ← socketPath, lockfilePath, ensureCacheDir only
    dispatcher.ts ← dispatchRequest; engine singletons; vue scan post-step
  engines/
    errors.ts     ← EngineError class + ErrorCode union
    types.ts      ← result types + LanguageProvider interface
    engine.ts     ← BaseEngine: shared rename/findReferences/getDefinition/moveFile
    text-utils.ts ← applyTextEdits(), offsetToLineCol() — shared by both engines
    file-walk.ts  ← walkFiles(dir, extensions) + SKIP_DIRS — git-aware, shared by both engines
    providers/
      ts.ts       ← TsProvider: compiler calls via ts-morph Project
      volar.ts    ← VolarProvider: compiler calls via Volar proxy + virtual↔real translation
    ts/
      engine.ts   ← TsEngine extends BaseEngine; moveSymbol (ts-morph AST)
      project.ts  ← findTsConfig, findTsConfigForFile, isVueProject
    vue/
      engine.ts   ← VueEngine extends BaseEngine; moveSymbol stub (NOT_SUPPORTED)
      scan.ts     ← updateVueImportsAfterMove (regex scan for .vue SFC imports)
      service-builder.ts ← buildVolarService() — extracted from VueEngine
```

**Known remaining gap** — `updateVueImportsAfterMove` (vue/scan) does not enforce workspace boundary on its regex scan. Low risk in practice (search root is clamped to tsconfig directory), tracked in tech-debt.md.

**Operations shipped:**
- `rename` — TS + Vue
- `move` — TS + Vue
- `moveSymbol` — TS only; Vue throws `NOT_SUPPORTED` (dispatcher constraint, not Volar)
- `findReferences` — TS + Vue; read-only, returns all references to a symbol by position
- `getDefinition` — TS + Vue; read-only, returns definition location(s) for a symbol by position

---

## Next things to build

Evaluate each candidate: does the daemon's stateful engine make it meaningfully better than the agent editing directly? `rename`, `move`, and `findReferences` benefit strongly because they require project-wide reference tracking.

- **Filesystem watcher** — the daemon loads the project graph once on startup and only invalidates on operations it performs itself. If the user edits, creates, or deletes files outside our tools (e.g. in their editor), the engine's in-memory state goes stale silently. See design notes below.
- **Lazy engine initialisation** — the daemon currently warms both the TS and Vue engines at startup regardless of project type. A TS-only project pays the full Volar startup cost unnecessarily. Engines should be initialised on first use: the dispatcher already selects the correct engine per workspace (via `isVueProject`), so the change is to defer `warmupEngine()` until the first request arrives for that engine rather than calling it eagerly at daemon start. This also improves daemon startup time for projects that only ever use one engine.
- **`findReferences` by file path** — "who imports this file?" is a different question from "who uses this symbol?". Options: union references across all exports (expensive), use `getEditsForFileRename` as a dry-run proxy (already available from `moveFile`), or scan import strings with the compiler's module resolver. Worth a separate design pass — keep separate from the symbol-position variant.
- **`extractFunction`** — pull a selection into a named function, updating the call site
- **`inlineVariable` / `inlineFunction`** — collapse a trivially-used binding
- **`deleteFile`** — remove a file and clean up its imports in other files
- **`createFile`** — scaffolding with correct import paths inferred from location

---

## Filesystem watcher — design notes

### Problem
The daemon's ts-morph `Project` and Volar service are loaded once on startup. Out-of-band file changes (edits in an editor, git checkouts, code generators) leave the engine with a stale view. The next operation may use wrong symbol positions, miss new files, or still see deleted ones.

### Likely approach
Use **chokidar** (the de-facto Node.js file-watching library; used by Vite, webpack, Jest) to watch the workspace root. On change, invalidate only the affected engine rather than rebuilding the full project graph.

```
file changed/added/deleted
  → debounce ~200 ms
  → call TsProvider.invalidateProject() and/or VolarProvider.invalidateService()
  → engine rebuilds lazily on next request
```

Lazy rebuild keeps watch latency near zero — the cost is paid on the next incoming tool call, not immediately. This matches how most LSP servers work.

### UX considerations
- **What does the agent see?** The next tool call after a file change may take longer than usual (cold rebuild). The latency should be surfaced — either via the `message` field in the result or a new `rebuiltEngine: true` flag — so the agent knows why a call was slow and can set expectations.
- **`DAEMON_STARTING` vs stale** — currently the daemon has one warm state and one error state. With watching, there is a third state: engine is warming after invalidation. Consider returning a distinct code (e.g. `ENGINE_REBUILDING`) or just absorbing the delay transparently.
- **File deletions** — if the watched file is the one being renamed or moved, the watcher may fire before the operation completes. The post-operation invalidation already handles this; the watcher's invalidation would be redundant but harmless. Guard against double-invalidation triggering two rebuilds.

### Performance considerations
- **Debounce is mandatory** — `git checkout`, code generators, and `pnpm install` can touch hundreds of files in milliseconds. A 150–300 ms debounce collapses a burst into one invalidation.
- **Selective invalidation** — ts-morph supports `project.getSourceFile(path)?.refreshFromFileSystemSync()` to update a single file without rebuilding the whole project. Worth using for `change` events; full invalidation only needed for `add`/`unlink` (structural changes).
- **Volar** — `VolarProvider` wraps a Volar service that keeps its own `fileContents` map. On an out-of-band change, invalidating the whole service is safest until we understand whether Volar supports incremental file refresh.
- **Watch scope** — only watch files matching the engine's extensions (`ts`, `tsx`, `js`, `jsx`, `vue`); ignore `node_modules` and build output directories (`dist`, `.tsbuildinfo`). `chokidar` supports glob ignore patterns.

### Profiling gap
Before implementing, we should know how long a cold engine rebuild takes on a realistic project (e.g. 500–2000 TypeScript files). If rebuild is <200 ms, full invalidation on every change is fine and selective refresh adds complexity for no benefit. If rebuild is >1 s, selective refresh (single-file refresh for edits, full rebuild for adds/deletes) becomes important.

There is currently no benchmarking infrastructure. Suggested approach before landing the watcher:
1. Add a `--bench` flag to the CLI that loads the engine, records wall-clock time to first ready state, and prints it.
2. Measure on a fixture that approximates a real project (e.g. copy a known open-source TS project into `tests/fixtures/`).
3. Use results to decide between full-invalidation-on-change vs. selective-refresh strategy before writing the watcher code.

---


## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer. Includes the `ensureDaemon` one-shot bug.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions of `@volar/language-core`, causing type mismatches. Fixed via `pnpm.overrides` in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `vue-engine.ts`.

---

## Architecture decisions

- **Per-workspace engine selection — a known limitation** — `dispatcher.ts` picks one engine per workspace: if any `.vue` files are present, `VueEngine` handles everything, including `.ts` files. This is correct for `rename`, `moveFile`, and `findReferences` (Volar understands the full project graph). But it means `moveSymbol` in a Vue project hits `NOT_SUPPORTED` even when both files are plain `.ts`. The fix is per-operation engine selection or a fallback path inside `VueEngine.moveSymbol` that delegates to `TsEngine`. The current approach is kept because it is simpler and the broken case is uncommon; tracked in tech-debt.md.

- **`moveSymbol` for Vue sources (`.vue` → `.ts`) is buildable — no new deps needed** — `@vue/language-core` re-exports `parse()` (wraps `@vue/compiler-sfc` internally), returning an `Sfc` with `script.ast` as a `ts.SourceFile` plus block offsets. Extract the declaration from a `<script setup>` block, write to the destination `.ts`, and patch importers. `parseScriptSetupRanges` can locate `defineProps`/`defineEmits` declarations to avoid moving them. Moving *into* a `.vue` destination is not worth supporting. See `docs/tech/volar-v3.md` § "Package ecosystem" for the full API inventory.

- **Read-only operations do not take a `workspace` parameter in the engine interface** — `findReferences` returns all references including those outside the workspace; it is up to the dispatcher to validate the input file is within the workspace. Write operations (`rename`, `moveFile`, `moveSymbol`) take `workspace` because they need to know which collateral writes to skip.

- **`VueEngine.translateLocations` is the shared virtual→real mapping helper** — extracted from the inline loop in `rename`; reused by `findReferences` and `getDefinition`. Any future operation that reads positions from a Vue project should call this method rather than duplicating the source-map traversal.

- **`VueEngine.toVirtualLocation` for operations that don't auto-translate** — `findRenameLocations` and `getReferencesAtPosition` in Volar's proxy translate real `.vue` paths → `.vue.ts` automatically. `getDefinitionAtPosition` does NOT — it calls TypeScript's internal implementation directly and throws `Could not find source file: App.vue`. Fix: call `toVirtualLocation(absPath, pos)` first to map to the virtual `.vue.ts` coordinate space, then pass those to `getDefinitionAtPosition`. Results still go through `translateLocations` for the reverse mapping. Any future operation that hits the same error pattern needs this treatment.

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
