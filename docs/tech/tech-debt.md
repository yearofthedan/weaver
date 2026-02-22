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

`src/daemon/daemon.ts` dispatches requests with `void handleSocketRequest(...)` — concurrent socket connections run as interleaved async tasks with no queueing. Two simultaneous `moveFile` calls could interleave at `await` points and corrupt each other's in-memory project state.

Two options:
- **Queue** — a single FIFO async queue in the daemon; each request waits for the previous to complete before starting. Simple, no rejected calls.
- **Reject-while-busy** — return an error (similar to `DAEMON_STARTING`) if a request arrives while another is in flight. The caller retries. Lower latency for the common case but requires retry logic in `serve.ts`.

**Current exposure:** low. AI agents make sequential tool calls. The race requires two simultaneous `move` calls from the same client. The cache invalidation added for the move-back fix (see `TsEngine.invalidateProject`, `VueEngine.invalidateService`) slightly widens the window between cache miss and cache fill, but correctness is preserved because Node.js is single-threaded — only wasted parallel rebuilds, no data corruption.

**Fix:** implement the queue approach in `src/commands/daemon.ts`. A per-workspace mutex (a `Promise` chain) is sufficient.

---


## Dispatcher: operation-centric architecture

The dispatcher currently routes by engine first (`getEngine(filePath)` → call the operation on it). This is engine-centric: the `RefactorEngine` interface groups all operations under a single capability provider.

The alternative is operation-centric: each operation (rename, moveFile, moveSymbol) is its own action type that knows which engine(s) it needs and how to orchestrate them. The dispatcher finds the right action for the request method and executes it, without knowing anything about engine selection or post-steps.

**Why it matters:** the operation set is growing faster than the engine set. Adding a new operation today requires adding a method to `RefactorEngine` and implementing it in every engine. An action-per-operation model would contain each operation's full strategy in one place and scale more naturally with new operations. The vue scan leak was an early signal — the `moveFile` operation needed two-part orchestration that didn't fit the engine interface and bled into the dispatcher.

**Tradeoff:** adding a new tech stack (engine) would require touching every action rather than implementing one interface. Acceptable if new engines are rare, which for a TS/Vue bridge they are.

**Note:** do this as a dedicated refactor, not incrementally. It changes the primary abstraction boundary across the whole codebase.

---

## Missing provider/engine separation

Both `TsEngine` and `VueEngine` collapse two distinct responsibilities into one class:

- **Provider** — assembles and owns the language service (`ts-morph` Project, Volar `buildService`). Computes rename locations and file move edits. No file I/O.
- **Engine** — calls the provider, applies edits to disk, returns structured results.

The provider work is the hard, language-specific part. The engine work (apply edits, collect modified files, return JSON-shaped results) is mechanical and largely identical between the two engines.

Separating these would reduce duplication, make each layer independently testable, and make it easier to add new language providers without re-implementing the dispatch logic.

**Note:** this is a meaningful structural change. Do it as a dedicated refactor session after the daemon and MCP transport are stable — not incrementally alongside feature work.
