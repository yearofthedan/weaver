# Daemon SIGTERM handler registration race

**type:** bug
**date:** 2026-06-21
**tracks:** handoff.md # Flaky daemon SIGTERM cleanup integration test

---

## Symptom

The daemon integration test "removes socket and lockfile on SIGTERM"
(`src/daemon/daemon.integration.test.ts`) intermittently fails under full-suite
load: the socket and lockfile are still present after the daemon is signalled.
Passes in isolation; reproduced 6/40 (signal the tsx wrapper) and 4–10/40
(signal the daemon PID directly) across full-suite loops. The flake blocks
unrelated commits because the pre-commit hook runs the full suite.

## Value / Effort

- **Value:** Two layers. (1) The test flake blocks all commits via the
  pre-commit hook — a recurring tax. (2) The flake is a true positive: it
  surfaces a real daemon defect — a startup window in which a SIGTERM kills the
  process without cleanup, leaving a stale socket/lockfile. In production this
  is mitigated (the stop paths do defensive `removeDaemonFiles` and
  `ensureDaemon` clears stale files on next spawn), but the daemon should clean
  up after itself rather than rely on every caller's defensiveness.
- **Effort:** Root cause confirmed by instrumentation. The fix is a moderate
  refactor — extract the startup/shutdown sequencing behind seams — not a
  two-line patch. Localised to the daemon startup path; does not touch
  `runStop`/`stopDaemon`/`ensureDaemon`.

```
input:    SIGTERM delivered to the daemon shortly after it becomes discoverable
          (lockfile written / "ready" emitted), under CPU contention
actual:   daemon terminated by default signal disposition; shutdown() never runs;
          socket + lockfile remain
expected: daemon runs shutdown(); socket + lockfile removed before it exits
```

## Expected

On SIGTERM or SIGINT delivered at **any** point after the daemon becomes
discoverable, the daemon runs its shutdown handler — removes the socket and
lockfile, then exits. There is no window in which a signal bypasses cleanup.

## Root cause

`runDaemon` (`src/daemon/daemon.ts`) makes the daemon **discoverable before it
installs its signal handlers**. It writes the lockfile (`:159`) and emits the
ready signal (`:212`) before registering `process.on("SIGTERM"/"SIGINT",
shutdown)` (`:223`–`:224`). A SIGTERM delivered in that window hits Node's
default disposition (terminate immediately) and `shutdown()` never runs.

Confirmed by per-PID lifecycle logging across every reproduction:
`LOCKFILE_WRITTEN` and `READY` were logged, `SHUTDOWN_ENTER` never was. Direct
PID signalling fails more often than wrapper signalling because faster delivery
lands in the window more reliably. The defect is **ordering**, not a throwing
handler (the handler is simply not installed yet).

## Fix

Extract the daemon's startup/shutdown sequencing out of the transport-bound
`runDaemon` into an inward "daemon lifecycle" unit with injected seams, so the
ordering invariant is **structural and unit-testable** rather than an accident
of line position. (The difficulty of writing a deterministic regression test
for the old code is the Dependency Rule failing out loud — the logic was in the
wrong layer.)

**Seams:**

- **`FileSystem` port (existing).** The lifecycle writes the lockfile and
  removes the socket/lockfile through the port (`writeFile`, `unlink`,
  `exists`, `readFile` are already on the interface). No raw `node:fs` in the
  lifecycle.
- **Process-host seam (new).**
  `interface DaemonHost { onSignal(signal: "SIGTERM" | "SIGINT", handler: () => void): void; exit(code: number): void; }`
  Production wraps `process.on`/`process.exit`; tests fake it to capture the
  handler and observe the exit. (Seam choice resolved with the user — see Open
  decisions.)
- **Deferred resource factories.** The server and watcher are constructed
  *after* handler registration, so the lifecycle takes factories
  (`startServer: () => DaemonServer`, `startWatcher: () => DaemonWatcher`) and
  attaches the results. `DaemonServer` is the minimal `{ listen(path), close() }`
  surface of `net.Server`; `DaemonWatcher` is `{ stop(): Promise<void> }`.

**Ordering, enforced in one named place:**

1. install the shutdown handler (`host.onSignal` for SIGTERM and SIGINT)
2. become discoverable: write the lockfile (port), then `startServer()` + listen
3. attach the server, `startWatcher()`, attach the watcher
4. signal readiness

`shutdown()` is **safe to fire at any stage**: stop the watcher if attached,
close the server if attached, clean the logger if present, remove the
socket + lockfile via the port, then `host.exit(0)`. Resources are optional
because a signal can now arrive before they exist.

`runDaemon` collapses to a thin adapter: construct `NodeFileSystem`, a real
`DaemonHost` wrapping `process`, the server factory (carrying the existing
request-mutex/`handleSocketRequest` wiring) and watcher factory (carrying the
existing extension selection), and the logger — then delegate to the lifecycle.

**Adjacent inputs / siblings to cover:**

- SIGINT must behave identically to SIGTERM (same handler).
- Signal at the earliest stage (handler installed, no server/watcher yet) —
  `shutdown()` must not throw and must still remove the lockfile.
- Signal after full startup — full cleanup.
- Startup leftover-file cleanup (current `removeDaemonFiles` before the lockfile
  write) is preserved.

**Test changes:**

- **New lifecycle unit test** with `InMemoryFileSystem` + a fake `DaemonHost`:
  drive the lifecycle to discoverable, fire the captured SIGTERM handler, assert
  the in-memory socket + lockfile are removed and `exit(0)` was called; fire at
  the earliest stage (no server/watcher) asserting safe cleanup; assert SIGINT
  parity. Deterministic — no spawn, no disk.
- **Existing integration test** "removes socket and lockfile on SIGTERM":
  reduce to a single real-wiring smoke — signal the daemon **PID** (from the
  lockfile) directly, matching the production stop path, and poll for removal
  with a bounded timeout instead of asserting synchronously.

## Security

> Reviewed against `docs/security.md`.

- **Workspace boundary:** N/A — no change to path validation. Lockfile/socket
  paths are derived from the workspace as before, now written/removed via the
  port.
- **Sensitive file exposure:** N/A — the lifecycle touches only the daemon's own
  socket and lockfile, never user content.
- **Input injection:** N/A — no user-supplied strings reach the new code paths.
- **Response leakage:** N/A — no change to error messages or response fields;
  the ready signal shape is unchanged.

## Edges

- **Must NOT change:** the ready-signal shape/timing as seen by clients (ready
  still emitted last); the lockfile JSON shape (`{ pid, startedAt }`); startup
  leftover-file cleanup; `isDaemonAlive` semantics.
- **Assumption:** `host.exit` is the only process-exit path in the lifecycle, so
  the unit test never actually exits the test process.
- **Happy-path regression risk:** normal startup and normal `weaver stop` must
  still work — covered by the existing daemon integration tests.

## Relevant files

- `src/daemon/daemon.ts` — `runDaemon` (startup sequence), `shutdown`,
  `removeDaemonFiles`, `isDaemonAlive`, `readLockfile`; the extraction target.
- `src/ports/filesystem.ts` — `FileSystem` port (already has
  `writeFile`/`exists`/`unlink`/`readFile`).
- `src/ports/in-memory-filesystem.ts` — backs the deterministic unit test.
- `src/daemon/paths.ts` — `socketPath`/`lockfilePath`.
- `src/daemon/watcher.ts` — `startWatcher` returns `{ stop(): Promise<void> }`
  (the `DaemonWatcher` shape).
- `src/daemon/daemon.integration.test.ts` — SIGTERM test to reduce to a smoke.
- `src/__testHelpers__/process-helpers.ts` — `spawnAndWaitForReady`,
  `killDaemon`, `lockfilePath`/`socketPath` helpers.

## Red flags

`runDaemon` is a long imperative startup procedure mixing validation, raw
`node:fs` I/O, server + request-mutex setup, watcher wiring, ready signalling,
and shutdown — low cohesion, and the bug is a direct symptom of it. The
extraction raises cohesion by pulling out the lifecycle ordering. Keep the
request-mutex/`handleSocketRequest` and the watcher-extension selection in the
adapter (passed in via factories) to avoid scope creep.

## Open decisions

**Resolved (2026-06-21, with user):** process-host seam (`onSignal`/`exit`)
chosen over a FileSystem-port-only approach, so the ordering invariant is
unit-testable without spawning a process. A phantom-typed builder (making
misorder a compile error) was considered and rejected as over-engineering —
the cohesive named unit plus the unit test is sufficient.

## Done-when

- [x] Reproduction (SIGTERM in the startup window) now runs `shutdown` and
      removes the files; the lifecycle unit test encodes it deterministically
- [x] Regression test covers earliest-stage signal, SIGTERM, and SIGINT parity
- [x] The daemon lifecycle's lockfile/socket I/O goes through the `FileSystem`
      port, not `node:fs`
- [x] Integration test reduced to one real-wiring smoke (signal PID + poll)
- [x] Mutation score ≥ threshold for the new source file (`lifecycle.ts` 100%);
      `daemon.ts` survivors classified as subprocess-noise (see Outcome)
- [x] `pnpm check` passes (lint + build + test)
- [x] `docs/internals/daemon.md` documents the startup ordering invariant
      (handlers installed before the daemon is discoverable) and the host seam
- [x] Tech debt discovered added to handoff.md as `[needs design]`
- [x] Spec moved to `docs/specs/archive/` with an Outcome section appended

## Outcome

**Shipped.** Confirmed root cause by instrumentation, extracted the startup/
shutdown sequencing into `src/daemon/lifecycle.ts` (`runLifecycle`) behind the
`FileSystem` port and a `DaemonHost` (`onSignal`/`exit`) seam, with `runDaemon`
reduced to a thin adapter. Signal handlers are now installed before the lockfile
write / socket listen; `shutdown()` is safe at any startup stage.

- **Tests added:** 10 unit tests in `lifecycle.test.ts`; the existing SIGTERM
  integration test rewritten to one real-wiring smoke (signal the daemon PID,
  poll for removal).
- **Mutation:** `lifecycle.ts` 100% (8/8). `daemon.ts` 9% — classified as
  structural noise: `runDaemon`/`handleSocketRequest` run only in the spawned
  daemon subprocess, invisible to in-process Stryker. The extraction *moved* the
  testable logic into `lifecycle.ts` (now 100%), so this is a net improvement,
  not a regression. Whether to exclude adapter bodies from `--mutate` is logged
  in handoff.
- **Empirical confirmation:** the flake reproduced ~15% under the real full-suite
  trigger (6/40); 0/25 after the fix.

**Reflection.**

- *What went well:* the architectural shape. Treating the test-difficulty as a
  Dependency-Rule smell (rather than hacking a test-only env barrier) produced a
  deterministic unit test that pins the ordering invariant — verified by
  temporarily reintroducing the bug and watching the test go red. The
  instrumentation that finally cracked it (per-PID lifecycle logging + running
  the real full-suite trigger in a loop) settled mechanism (A) vs (B)
  deductively.

- *What did not, and took far too long:* the diagnosis thrashed. The root cause
  was declared "confirmed" from reasoning plus a *green* isolation run; two
  fixes were shipped on unverified hypotheses (each made it worse); and a load
  harness silently applied no load because this sandbox reaps background process
  trees on every command return. Hours burned. The original sin was reclassifying
  a `[needs design]` bug to "direct fix, no spec" while its defining question
  (the root cause) was still unanswered.

- *Recommendation to the next agent:* this session directly motivated the
  `/investigate` skill + `[needs investigation]` tag (logged in handoff) — bug
  diagnosis needs a disciplined home that `/spec` and `/slice` don't provide.
  For daemon work specifically: `daemon.ts` is subprocess-only, so test lifecycle
  changes at the unit level via `lifecycle.ts`, never by spawning. And do not
  trust a passing test as evidence about a race — reproduce the red state and
  observe the mechanism.
