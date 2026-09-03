# Internals: Filesystem Watcher

**Purpose:** How the daemon detects out-of-band file changes and keeps its engine state fresh.
**Related:** [daemon.md](./daemon.md), [../architecture.md](../architecture.md)

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
         │  filter 1: extension ∈ VUE_EXTENSIONS   (always; see Extension selection)
         │  filter 2: no path segment ∈ SKIP_DIRS  (node_modules, dist, .git…)
         │
         ▼ debounce 200 ms — last event type wins per file path
         │
         ▼ ledger: was this the daemon's own write?  (see Daemon own-writes)
         │         yes ──► drop, invalidate nothing
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
| any | Vue project | Full Volar service drop | Volar has no incremental file refresh API. The rebuild is not cheap — 330–490ms on a real 170-file project — but it is lazy, so a burst of events costs one rebuild, not one per event |

Lazy rebuild: the engine is not rebuilt immediately on invalidation. The cost is paid on the next incoming tool call. This keeps watcher latency near zero — the same model most LSP servers use.

## Extension selection

The watcher always watches `VUE_EXTENSIONS` — `.ts` `.tsx` `.js` `.jsx` `.vue` — regardless of project type.

Choosing the set at startup from the project type is self-defeating: in a workspace with no `.vue` files, the watcher would filter out `.vue` events, so the daemon never observes edits to a `.vue` file added after it started. Engine *selection* is unaffected either way, since `dispatchRequest` re-runs discovery every dispatch (see `resetDiscoveryCaches` in [`daemon.md`](daemon.md)) — this is only about observing later edits to files the daemon did not know about at startup.

Watching `.vue` in a TypeScript-only project costs nothing: `refreshFile` returns early when the project holds no such source file, so the extra events are no-ops.

Extension constants are shared with the file-walk module, which also owns `SKIP_DIRS`. The watcher reuses both — all "what files matter" knowledge lives in one place.

## Daemon own-writes

The daemon's own operations write files to disk, and those writes come back as watcher events ~200ms later — indistinguishable, at the filesystem, from someone editing in an editor. The operation has already refreshed the engines with the content it wrote, so acting on those events throws away correct state.

The daemon recognises its own writes and skips invalidating for them. Every dispatcher operation writes through one shared `RecordingFileSystem` (`src/daemon/self-write-state.ts`), which reports each mutation to a `SelfWriteLedger`; `buildWatcherCallbacks` consults that ledger before calling `invalidateFile` or `invalidateAll`.

**Recognition is by mtime, not by a time window.** The ledger stamps each path with its `mtimeMs` immediately after the daemon writes it, and suppresses an event only while the file's current mtime still matches. A window would have to exceed the ~1.2s these events take to arrive, and a genuine external edit landing inside it would be dropped, leaving a stale compiler serving wrong answers. With mtime, an edit landing on top of the daemon's write moves the file past the stamp and is never swallowed. A matched entry is consumed, so a *second* event for the same untouched path invalidates normally.

**A directory rename is ledgered per file.** The watcher never reports a directory — it reports one `unlink` per child at the old path and one `add` per child at the new one — so `RecordingFileSystem` expands a directory rename into its constituent files. Recording only the two directory paths suppresses nothing on the operation with the largest event burst.

Two properties keep this safe:

1. **Mutex serialisation** — the daemon processes one request at a time via a promise-chain mutex declared once in `runDaemon`, so it is global across connections, not per socket. Watcher callbacks are synchronous and can only fire *between* requests, never mid-operation.

2. **Drop affects the next call only** — `invalidateAll()` sets the engine singletons to `undefined`. An executing request holds its engine in local scope, so a drop only affects the next `getEngine()`.

### A burst of events is not N rebuilds

Invalidation is a `Map.delete` and the rebuild is lazy, so a burst coalesces on its own: the deletes are free, and the next query pays for one rebuild however many events preceded it. Most invalidations in a burst hit an already-empty cache.

What costs time is a burst *separated* by a query. `add` and `unlink` for a moved file are different paths, so the per-path debounce never merges them and they arrive as two waves; each wave discards whatever the query between them rebuilt. Suppression is aimed at that, which is why a per-file Volar refresh would not help — the `change` path it would optimise is the one already costing almost nothing.

## Shutdown

`watcher.stop()` is called in the daemon's `SIGTERM`/`SIGINT` handler. It clears all pending debounce timers and calls `chokidar.close()` to release OS file-watch handles.
