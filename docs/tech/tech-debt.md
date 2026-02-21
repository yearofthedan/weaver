# Tech Debt

Known issues to address before they compound. Reference the relevant source files before starting any of these.

---

## Test cleanup: leaked daemon processes

Tests that spawn `serve` (serve.test.ts, mcp/move.test.ts, mcp/rename.test.ts) leak a daemon process after each test. `serve` auto-spawns the daemon as a detached, unref'd child. The `afterEach` kills the serve process and calls `removeDaemonFiles`, which deletes the socket and lockfile but does not kill the daemon process.

Over a long test session this exhausts container memory and causes OOM kills (e.g. `tsc` exits 137).

**Fix:** in test `afterEach`, read the PID from the lockfile before calling `removeDaemonFiles`, then `process.kill(pid, "SIGTERM")` if the process is alive. A `killDaemon(dir)` helper in `tests/helpers.ts` would centralise this. All tests that push a serve proc should also call `killDaemon(dir)` in their cleanup.

There is also a related race in `waitForDaemon`: it resolves when the lockfile appears (step 5 of daemon startup) but `server.listen(sockPath)` is step 6, so an immediate `socketPath` existence check can fail. `waitForDaemon` should poll for the socket file, not just the lockfile PID.

---

## Daemon: no request serialisation

`src/commands/daemon.ts` dispatches requests with `void handleSocketRequest(...)` — concurrent socket connections run as interleaved async tasks with no queueing. Two simultaneous `moveFile` calls could interleave at `await` points and corrupt each other's in-memory project state.

Two options:
- **Queue** — a single FIFO async queue in the daemon; each request waits for the previous to complete before starting. Simple, no rejected calls.
- **Reject-while-busy** — return an error (similar to `DAEMON_STARTING`) if a request arrives while another is in flight. The caller retries. Lower latency for the common case but requires retry logic in `serve.ts`.

**Current exposure:** low. AI agents make sequential tool calls. The race requires two simultaneous `move` calls from the same client. The cache invalidation added for the move-back fix (see `TsEngine.invalidateProject`, `VueEngine.invalidateService`) slightly widens the window between cache miss and cache fill, but correctness is preserved because Node.js is single-threaded — only wasted parallel rebuilds, no data corruption.

**Fix:** implement the queue approach in `src/commands/daemon.ts`. A per-workspace mutex (a `Promise` chain) is sufficient.

---

## Engine layer: Vue awareness leaking into TsEngine

`src/engines/ts-engine.ts` imports and calls `updateVueImportsAfterMove` from `vue-scan.js`. A TypeScript engine should have no knowledge of Vue.

The same function is also called by `VueEngine.moveFile`. It is a shared post-processing concern — a regex scan that patches `.vue` import paths after any file move — and belongs at the router level, not inside individual engines.

**Fix:** remove the `updateVueImportsAfterMove` call from both engines. Call it in the router after any `moveFile` operation. Engines become pure: each knows only about its own language.

---

## Engine layer: `applyTextEdits` is private to VueEngine

`applyTextEdits` (bottom of `src/engines/vue-engine.ts`) is a pure text utility with no Vue-specific logic. It is only accessible to `VueEngine` today but is likely needed by any engine that applies raw text edits.

**Fix:** move to a shared `src/utils.ts` or similar.

---

## Missing provider/engine separation

Both `TsEngine` and `VueEngine` collapse two distinct responsibilities into one class:

- **Provider** — assembles and owns the language service (`ts-morph` Project, Volar `buildService`). Computes rename locations and file move edits. No file I/O.
- **Engine** — calls the provider, applies edits to disk, returns structured results.

The provider work is the hard, language-specific part. The engine work (apply edits, collect modified files, return JSON-shaped results) is mechanical and largely identical between the two engines.

Separating these would reduce duplication, make each layer independently testable, and make it easier to add new language providers without re-implementing the dispatch logic.

**Note:** this is a meaningful structural change. Do it as a dedicated refactor session after the daemon and MCP transport are stable — not incrementally alongside feature work.
