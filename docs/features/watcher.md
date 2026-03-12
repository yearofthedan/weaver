**Purpose:** How the daemon detects out-of-band file changes and keeps its engine state fresh.
**Audience:** Engineers modifying the daemon, engine layer, or invalidation strategy.
**Status:** Current
**Related docs:** [Daemon](daemon.md), [Architecture](../architecture.md), [Tech Debt](../tech/tech-debt.md)

---

# Filesystem Watcher

## Problem

The daemon loads its TypeScript or Volar project graph once at startup. If files change outside of the daemon's own operations — the user edits in their editor, runs a code generator, switches git branches — the engine's in-memory state goes stale silently. The next tool call may use wrong symbol positions, miss new files, or still see deleted ones.

## Solution

`src/daemon/watcher.ts` uses **chokidar** (Node.js file-watching library) to watch the workspace root. File events are debounced, then routed to one of two invalidation paths depending on the event type.

## Event flow

```
Out-of-band file change (editor, git, codegen…)
         │
         ▼ OS kernel (inotify / kqueue / FSEvents)
    chokidar FSWatcher
         │  filter 1: extension ∈ watchExtensions  (project-type-aware)
         │  filter 2: no path segment ∈ SKIP_DIRS  (node_modules, dist, .git…)
         │
         ▼ debounce 200 ms — last event type wins per file path
         │
         ├─ "change" ──► invalidateFile(path)
         │                   │
         │                   ├─ TsMorphCompiler → sourceFile.refreshFromFileSystemSync()
         │                   │              (single file; project graph preserved)
         │                   └─ VolarCompiler → volarCompiler.invalidateService(path)
         │                                  (full service drop; Volar has no incremental API)
         │
         └─ "add" / "unlink" ──► invalidateAll()
                                     │
                                     ├─ tsEngine  = undefined
                                     └─ vueEngine = undefined

Next tool call arriving at the daemon socket
         │
         ▼ dispatchRequest()
    getEngine(filePath)
         │
         ├─ compiler is undefined  →  create fresh TsMorphCompiler / VolarCompiler
         │                          (project graph rebuilt lazily from tsconfig)
         │
         └─ engine exists  →  use cached instance
                               (already refreshed by invalidateFile above)
         │
         ▼ operation executes with up-to-date project graph
```

## Invalidation strategy

| Event | Trigger | Strategy | Reason |
|-------|---------|----------|--------|
| `change` | file content edited | Selective (ts-morph single-file refresh) | Project graph structure unchanged; cheap to update one node |
| `add` | new file created | Full engine drop | New file may be included by tsconfig; project graph is structurally stale |
| `unlink` | file deleted | Full engine drop | Source file node must be removed; no ts-morph API for single-file removal |
| any | Vue project | Full Volar service drop | Volar has no incremental file refresh API; service rebuild is fast |

Lazy rebuild: the engine is not rebuilt immediately on invalidation. The cost is paid on the next incoming tool call. This keeps watcher latency near zero — the same model most LSP servers use.

## Extension selection

Extensions to watch are determined at daemon startup from the project type:

| Project type | Watched extensions |
|--------------|--------------------|
| TypeScript / React | `.ts` `.tsx` `.js` `.jsx` |
| Vue | `.ts` `.tsx` `.js` `.jsx` `.vue` |

Extension constants are shared with the file-walk module, which also owns `SKIP_DIRS`. The watcher reuses both — all "what files matter" knowledge lives in one place.

## Daemon own-writes

The daemon's own operations (`rename`, `moveFile`, `moveSymbol`) write files to disk, which emit inotify events the watcher picks up. These fire `invalidateFile` or `invalidateAll` ~200ms after the write — after the operation has already performed its own invalidation.

The redundant callbacks are safe for two reasons:

1. **Mutex serialisation** — the daemon processes one request at a time via a promise-chain mutex. Watcher callbacks are synchronous and execute on the Node.js event loop, so they can only fire *between* requests, never mid-operation. There is no risk of nulling an engine that is currently in use.

2. **Drop affects the next call only** — `invalidateAll()` sets the engine singletons to `undefined`. Any currently-executing request holds a reference to the engine object in its local scope; dropping the singleton only affects the next `getEngine()` call. The in-flight request completes against the engine it already has.

The net effect is one unnecessary cold rebuild on the tool call immediately following a write-heavy operation. See [tech-debt.md](../tech/tech-debt.md) for the known gap and a proposed suppress-set fix.

## Shutdown

`watcher.stop()` is called in the daemon's `SIGTERM`/`SIGINT` handler. It clears all pending debounce timers and calls `chokidar.close()` to release OS file-watch handles.
