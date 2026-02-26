**Purpose:** Known structural issues, bugs, and their proposed fixes.
**Audience:** Engineers deciding what to work on next, anyone hitting one of these issues in practice.
**Status:** Current (as of last session)
**Related docs:** [Handoff](../handoff.md) (next work), [Agent Memory](../agent-memory.md) (gotchas)

---

# Tech Debt

Known issues to address before they compound. Reference the relevant source files before starting any of these.

---

## Daemon: no request serialisation

**Addressed in request serialisation: promise-chain mutex in `daemon.ts`.** The fix was to add a promise-chain mutex so concurrent socket connections are queued rather than interleaved.

Context preserved here for reference: `src/daemon/daemon.ts` dispatches requests with `void handleSocketRequest(...)` — concurrent socket connections run as interleaved async tasks with no queueing. Current exposure is low (agents make sequential tool calls), but MCP hosts can retry on timeout, creating overlapping requests.

---


## Dispatcher: operation-centric architecture

**Addressed in provider/engine separation and data-driven dispatch.** The provider/engine separation addresses the engine-side duplication; data-driven dispatch addresses the dispatcher-side boilerplate. Together they replace the engine-centric routing with a model where operations and providers are independently composable.

Original analysis preserved here: the operation set is growing faster than the engine set. Adding a new operation today requires a method on `RefactorEngine` and an implementation in every engine. The vue-scan post-step for `moveFile` was an early signal that operations need their own orchestration strategy.

---

## Missing provider/engine separation

**Addressed in provider/engine separation.** See `docs/agent-memory.md` for the full design decisions including the `LanguageProvider` interface and extraction of `VueEngine.buildService`.

---

## Watcher: own-writes trigger redundant invalidation

The daemon's own operations (`rename`, `moveFile`, `moveSymbol`) write files to disk. Those writes emit inotify/FSEvents events that the watcher picks up, firing `invalidateFile` or `invalidateAll` ~200ms after the write — by which time the operation has already performed its own invalidation. The redundant callbacks are currently no-ops (refreshing a project that is already dropped), so there is no correctness issue.

The risk is latency: if a second tool call arrives within the 200ms debounce window after an operation, the debounce timer will fire mid-call and null out the engine. The promise-chain mutex means this cannot interleave with an in-flight request, and nulling the engine only affects the *next* `getEngine()` call, so it is still safe — but it adds an unnecessary cold-rebuild to the call that follows.

**Fix:** maintain an in-memory skip-set of file paths the daemon itself just wrote. Before writing a file, add the path to the set; in the watcher callback, skip paths in the set and drain them after a short grace period. The skip-set is populated and drained entirely within the mutex-serialised operation, so no concurrency guard is needed.

**Priority:** low. The current behaviour is safe. The overhead is one extra project rebuild on the call immediately following a write-heavy operation — noticeable only for large projects.

---

## Security: TOCTOU race in symlink checks

`isWithinWorkspace` resolves symlinks at check-time, but the actual write happens later. Between the check and the write, a symlink could be swapped to point outside the workspace.

**Impact:** Low in practice — the tool is local-only with no multi-tenant exposure.

**Mitigation options:**
- Use `O_NOFOLLOW` on write operations (Unix-specific, non-trivial in Node.js)
- Add a second symlink re-check immediately before write (shrinks the window, doesn't close it)
- Accept the race as reasonable risk given the use case

**Decision:** accepted risk for now. Revisit if the tool ever runs in a shared or networked environment.

**Priority:** low.

---

## Daemon: process-lifetime discovery caches have no invalidation

`src/utils/ts-project.ts` caches `findTsConfig` and `isVueProject` results in module-level `Map`s for the daemon's entire lifetime. The file watcher calls `invalidateAll()` on providers but never clears these discovery caches.

If a `tsconfig.json` is created, deleted, moved, or `.vue` files are added to a previously non-Vue project while the daemon is running, the daemon will serve stale project-type decisions until it is restarted.

**Fix:** hook the watcher's `onFileAdded`/`onFileRemoved` callbacks to clear the relevant cache entries when a `tsconfig.json` or `.vue` file changes.

**Priority:** low. `tsconfig.json` is usually static. Most likely to surface during monorepo restructuring.

---

## VolarLanguageService interface is hand-typed

`src/providers/volar.ts` manually narrows the TypeScript LanguageService surface used by the Vue provider. If an upstream API changes signature, this can compile but fail at runtime.

**Fix:** `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>`. Compile-time safety against upstream changes.

**Priority:** low. Will be resolved as part of further provider refactoring since `VolarProvider` should type its dependency on the real `ts.LanguageService`.
