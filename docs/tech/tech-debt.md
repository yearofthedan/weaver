**Purpose:** Known structural issues, bugs, and their proposed fixes.
**Audience:** Engineers deciding what to work on next, anyone hitting one of these issues in practice.
**Status:** Current (as of last session)
**Related docs:** [Handoff](../handoff.md) (next work), [Agent Memory](../agent-memory.md) (gotchas)

---

# Tech Debt

Known issues to address before they compound. Reference the relevant source files before starting any of these.

---

## Test cleanup: leaked daemon processes

Tests that spawn `serve` (serve.test.ts, mcp/moveFile.test.ts, mcp/rename.test.ts) leak a daemon process after each test. `serve` auto-spawns the daemon as a detached, unref'd child. The `afterEach` kills the serve process and calls `removeDaemonFiles`, which deletes the socket and lockfile but does not kill the daemon process.

Over a long test session this exhausts container memory and causes OOM kills (e.g. `tsc` exits 137).

**Fix:** in test `afterEach`, read the PID from the lockfile before calling `removeDaemonFiles`, then `process.kill(pid, "SIGTERM")` if the process is alive. A `killDaemon(dir)` helper in `tests/helpers.ts` would centralise this. All tests that push a serve proc should also call `killDaemon(dir)` in their cleanup.

There is also a related race in `waitForDaemon`: it resolves when the lockfile appears (step 5 of daemon startup) but `server.listen(sockPath)` is step 6, so an immediate `socketPath` existence check can fail. `waitForDaemon` should poll for the socket file, not just the lockfile PID.

---

## serve: ensureDaemon fires once at startup only

`src/mcp/serve.ts` calls `ensureDaemon(absWorkspace)` once during `runServe`, fire-and-forget. If the daemon dies after `serve` starts — crash, OOM, SIGKILL from tests — every subsequent tool call gets `ECONNREFUSED`, which `callDaemon` wraps as `{ ok: false, error: "DAEMON_STARTING" }`. The daemon is never re-spawned; `DAEMON_STARTING` becomes permanent until `serve` itself is restarted.

**Fix:** call `ensureDaemon` inside each tool handler before `callDaemon`, or retry spawn on connection failure. The simplest safe version: in the `catch` block of each tool handler, check if the error is `ECONNREFUSED` and if so call `ensureDaemon` then retry once.

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

## Daemon: stale process not detected on protocol version change

When a new operation is added, a daemon running from a previous session will accept connections (so `isDaemonAlive` returns `true`) but silently lack the new handler. `ensureDaemon` reuses the old process and the MCP server never registers the new tool from the client's perspective until the daemon is manually killed.

**Fix:** embed a `PROTOCOL_VERSION` constant (increment on every operation add/remove). Add a lightweight `ping` RPC to the daemon that returns `{ ok: true, version: PROTOCOL_VERSION }`. In `ensureDaemon`, after confirming the process is alive, call `ping`. If the version doesn't match (or the call fails), call `removeDaemonFiles` then respawn. This makes version upgrades automatic and invisible to users.

**Priority:** medium. The current workaround is to kill the daemon manually (`kill <pid>`) and restart the MCP server. Pain is low in day-to-day use but high when dogfooding during development.

---

## VolarLanguageService interface is hand-typed

Lines 16–37 of `src/engines/vue/engine.ts` manually define the TypeScript LanguageService methods used by the Vue engine. If an upstream API changes signature, this compiles fine but fails at runtime.

**Fix:** `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>`. Compile-time safety against upstream changes.

**Priority:** low. Will be resolved as part of further provider refactoring since `VolarProvider` should type its dependency on the real `ts.LanguageService`.
