# Tech Debt

Known issues to address before they compound. Reference the relevant source files before starting any of these.

---

## Test cleanup: leaked daemon processes

Tests that spawn `serve` (serve.test.ts, mcp/move.test.ts, mcp/rename.test.ts) leak a daemon process after each test. `serve` auto-spawns the daemon as a detached, unref'd child. The `afterEach` kills the serve process and calls `removeDaemonFiles`, which deletes the socket and lockfile but does not kill the daemon process.

Over a long test session this exhausts container memory and causes OOM kills (e.g. `tsc` exits 137).

**Fix:** in test `afterEach`, read the PID from the lockfile before calling `removeDaemonFiles`, then `process.kill(pid, "SIGTERM")` if the process is alive. A `killDaemon(dir)` helper in `tests/helpers.ts` would centralise this. All tests that push a serve proc should also call `killDaemon(dir)` in their cleanup.

There is also a related race in `waitForDaemon`: it resolves when the lockfile appears (step 5 of daemon startup) but `server.listen(sockPath)` is step 6, so an immediate `socketPath` existence check can fail. `waitForDaemon` should poll for the socket file, not just the lockfile PID.

---

## serve: ensureDaemon fires once at startup only

`src/mcp/serve.ts` calls `ensureDaemon(absWorkspace)` once during `runServe`, fire-and-forget. If the daemon dies after `serve` starts — crash, OOM, SIGKILL from tests — every subsequent tool call gets `ECONNREFUSED`, which `callDaemon` wraps as `{ ok: false, error: "DAEMON_STARTING" }`. The daemon is never re-spawned; `DAEMON_STARTING` becomes permanent until `serve` itself is restarted.

**Fix:** call `ensureDaemon` inside each tool handler before `callDaemon`, or retry spawn on connection failure. The simplest safe version: in the `catch` block of each tool handler, check if the error is `ECONNREFUSED` and if so call `ensureDaemon` then retry once.

---

## Daemon: no request serialisation

**Promoted to architecture slice A4 in `docs/handoff.md`.** See there for the fix plan.

Context preserved here for reference: `src/daemon/daemon.ts` dispatches requests with `void handleSocketRequest(...)` — concurrent socket connections run as interleaved async tasks with no queueing. Current exposure is low (agents make sequential tool calls), but MCP hosts can retry on timeout, creating overlapping requests.

---


## Dispatcher: operation-centric architecture

**Promoted to architecture slices A5 + A6 in `docs/handoff.md`.** The provider/engine separation (A5) addresses the engine-side duplication; data-driven dispatch (A6) addresses the dispatcher-side boilerplate. Together they replace the current engine-centric routing with a model where operations and providers are independently composable.

Original analysis preserved here: the operation set is growing faster than the engine set. Adding a new operation today requires a method on `RefactorEngine` and an implementation in every engine. The vue-scan post-step for `moveFile` was an early signal that operations need their own orchestration strategy.

---

## Missing provider/engine separation

**Promoted to architecture slice A5 in `docs/handoff.md`.** See there for the full plan including `LanguageProvider` interface and extraction of `VueEngine.buildService`.

---

## Wire protocol types (daemon ↔ serve)

The daemon socket speaks `{ method, params }` → `{ ok, ... }` but these shapes are typed inline with `as` casts at every usage (`dispatcher.ts`, `mcp.ts`, `daemon.ts`). If param names change, nothing catches it at compile time.

**Fix:** shared request/response types in `src/protocol.ts` or extend `src/schema.ts`. Reuse the Zod schemas already defined for MCP input validation.

**Priority:** low. The protocol is simple and stable. The cost of drift is a runtime error caught by the first test run, not a silent bug. Worth doing when the protocol surface grows (e.g. adding operation metadata or streaming responses).

---

## Use `Set<string>` for filesModified / filesSkipped

Both engines build `filesModified` and `filesSkipped` as arrays guarded by `if (!arr.includes(path))` — O(n) on every insert. `Set` expresses the dedup intent directly and is O(1).

**Priority:** low. Will happen naturally during the provider/engine separation (slice A5) since the shared engine layer should use Sets internally and convert to arrays at the return boundary.

---

## VolarLanguageService interface is hand-typed

Lines 16–37 of `src/engines/vue/engine.ts` manually define the TypeScript LanguageService methods used by the Vue engine. If an upstream API changes signature, this compiles fine but fails at runtime.

**Fix:** `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>`. Compile-time safety against upstream changes.

**Priority:** low. Will be resolved as part of the provider separation (slice A5) since `VolarProvider` will type its dependency on the real `ts.LanguageService`.
