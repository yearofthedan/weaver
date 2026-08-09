# Daemon adapter FileSystem port migration

**type:** change
**date:** 2026-08-09
**tracks:** handoff.md # Daemon adapter follow-ups (port migration + mutation-noise) → docs/tech/mutation-testing.md

---

## Context

Two items surfaced while shipping the SIGTERM lifecycle extraction ([archived
spec](archive/20260621-daemon-sigterm-registration-race.md)), which moved
`runDaemon`'s startup/shutdown ordering into `lifecycle.ts` behind the
`FileSystem` port but deliberately left `runStop`/`stopDaemon`/`ensureDaemon`/
`readLockfile`/`removeDaemonFiles` on raw `node:fs`. Those functions still
bypass the port, and `daemon.ts` scores ~9% on a scoped mutation run — a
mix of genuine subprocess-only coverage gaps and real, fixable assertion
gaps in the lockfile-shape validation that the low score doesn't distinguish
between.

## User intent

*As a developer using weaver, I want `weaver daemon` and `weaver stop` to
behave correctly and verifiably when the on-disk lockfile is corrupted or
unexpectedly shaped, so that I can trust the daemon to fail safely instead of
relying on code paths no test exercises.*

## Relevant files

- `src/daemon/daemon.ts` — `readLockfile`, `isDaemonAlive`, `removeDaemonFiles`, `stopDaemon`, `runStop`, `runDaemon`; migration target
- `src/daemon/ensure-daemon.ts` — `ensureDaemon`; migration target
- `src/daemon/paths.ts` — `ensureCacheDir`; migration target (folded in — see Value/Effort)
- `src/daemon/lifecycle.ts` — `runLifecycle` already takes `fs: FileSystem`; the precedent this migration extends
- `src/ports/filesystem.ts` — `FileSystem` interface; already has every method needed (`readFile`, `exists`, `unlink`, `mkdir`) — no interface change
- `src/ports/node-filesystem.ts` — `NodeFileSystem`, stateless, safe to construct per-file as a default
- `src/ports/in-memory-filesystem.ts` — `InMemoryFileSystem`; `readFile`/`unlink` throw ENOENT on a missing key, matching `NodeFileSystem` semantics, so existing try/catch logic in `readLockfile`/`removeDaemonFiles` needs no change
- `src/utils/file-walk.ts` — `walkFiles(dir, extensions, fs: FileSystem = defaultFs)`; the existing default-parameter precedent this migration follows (module-level `const defaultFs = new NodeFileSystem()`, callers needing real disk omit the param, tests inject `InMemoryFileSystem`)
- `src/daemon/paths.test.ts` — houses the existing real-fs `isDaemonAlive`/`removeDaemonFiles` tests; new shape-validation unit tests land in its existing `describe("isDaemonAlive")` block
- `docs/tech/mutation-testing.md` — survivor table to extend; the `ensure-daemon.ts` table (lines 95–106) and the "Process-entry-point code has an inherent in-process coverage gap" lesson (line 233) are the format/precedent to mirror for `daemon.ts`'s entry
- `reports/stryker-incremental.json` — current `daemon.ts` baseline: 233 mutants, 16 Killed, 16 Survived, 139 NoCoverage, 62 Ignored (~9.4%)

### Red flags

- (none — this task is the cleanup)

**Layer-fit:** All ACs below are pure functions of their inputs (lockfile
content, workspace path) — unit-tested with `InMemoryFileSystem`, no real
disk or subprocess needed.

## Value / Effort

- **Value:** `readLockfile`'s shape-validation branches (is the parsed JSON
  an object, does it have a numeric `pid`, a numeric `startedAt`) are
  currently only exercised by fully-valid or fully-invalid (non-JSON)
  lockfile content — never a validly-parsed-but-wrong-shape object. That gap
  means a lockfile written by a future daemon version, or corrupted by a
  crash mid-write, could take an untested path through `isDaemonAlive`/
  `stopDaemon`/`runStop`. Closing it, plus documenting the confirmed
  subprocess-only noise, means mutation triage on `daemon.ts` stops
  re-discovering the same known-noise every run.
- **Effort:** Small-to-moderate. The default-parameter design (`fs: FileSystem
  = defaultFs`, matching `file-walk.ts`) means **zero changes to the ~7
  existing test files** that call these functions today — they keep omitting
  the param and get the same real-`NodeFileSystem` behaviour as before. Only
  three source files change (`daemon.ts`, `ensure-daemon.ts`, `paths.ts`),
  plus new unit tests, a mutation run, and a doc update. No `FileSystem`
  interface changes needed.

## Behaviour

> Layer-fit: all pure-function unit tests via `InMemoryFileSystem`, exercised
> through `isDaemonAlive` (the only exported entry point that surfaces
> `readLockfile`'s return value observably).

- [ ] Given a lockfile file whose content parses to a JSON value that is not
      an object (e.g. `"42"`), `isDaemonAlive` returns `false`.
- [ ] Given a lockfile file whose content is a JSON object missing `pid`
      (e.g. `{"startedAt": 1234}`), `isDaemonAlive` returns `false`.
- [ ] Given a lockfile file whose content is a JSON object where `pid` is not
      a number (e.g. `{"pid": "123", "startedAt": 1234}`), `isDaemonAlive`
      returns `false`.
- [ ] Given a lockfile file whose content is a JSON object missing
      `startedAt` (e.g. `{"pid": 123}`), `isDaemonAlive` returns `false`.

> Type matrix check: the varying dimension here is lockfile JSON *shape*, not
> file extension or engine path — the four cases above are the exhaustive
> partition of `readLockfile`'s validation clauses (non-object, missing
> `pid`, wrong-typed `pid`, missing `startedAt`). `pid`/`startedAt` typed as
> non-number is symmetric for both fields; one case per field is sufficient
> since the clause structure is identical.

## Structural criteria

- [ ] `readLockfile`, `isDaemonAlive`, `removeDaemonFiles`, `stopDaemon`
      (`daemon.ts`), `ensureDaemon` (`ensure-daemon.ts`), and `ensureCacheDir`
      (`paths.ts`) contain no direct `node:fs` calls — verified by the absence
      of a `node:fs` import used for file I/O in these functions.
- [ ] Each function above accepts an `fs: FileSystem = defaultFs` parameter,
      with `defaultFs` a module-level `new NodeFileSystem()`, matching
      `walkFiles`'s existing pattern in `file-walk.ts`.
- [ ] `isDaemonAlive`, `removeDaemonFiles`, and `stopDaemon` thread their
      received `fs` into every internal call to `readLockfile`/`isDaemonAlive`/
      `removeDaemonFiles` rather than re-reading the default — so a caller
      that injects `InMemoryFileSystem` gets fully isolated behaviour, not a
      partial swap.
- [ ] `ensureDaemon` threads its received `fs` into its own stale-socket
      `exists` check and into `isDaemonAlive`/`removeDaemonFiles`/`stopDaemon`.

## Interface

No CLI flag, socket protocol, or schema change — this is an internal
function-signature change only (covered by Structural criteria above). No
new field or parameter is exposed to an agent or end user.

## Open decisions

(none — both forks below were resolved during spec drafting)

- **Default-parameter vs. explicit threading at every call site:** resolved
  as default-parameter (`fs: FileSystem = defaultFs`), following the
  `file-walk.ts` precedent. Explicit threading (mirroring
  `validateWorkspace(opts.workspace, new NodeFileSystem())`) was rejected —
  these functions have ~7 existing test call sites that all want the same
  real-filesystem behaviour by default; threading explicitly would touch
  every one for no behavioural gain, where `walkFiles` already established
  the default-parameter shape for exactly this situation ("operations core
  testable in memory, adapters that legitimately touch real disk rely on
  this production default").
- **Whether to add a process port (`process.kill`/`spawn`/`process.exit`):**
  resolved as no. `InMemoryFileSystem` earns its keep because it's a
  conformance-tested, faithful alternate implementation of real filesystem
  semantics. No equivalent exists for process liveness/signal delivery —
  those are OS-kernel facts, and a "port" here would just relocate the
  `vi.mock("node:child_process")` / `vi.spyOn(process, "exit")` boundary
  that tests already use successfully. `DaemonHost` (`onSignal`/`exit`)
  stays scoped to the specific ordering bug it was built to fix
  ([archived spec](archive/20260621-daemon-sigterm-registration-race.md));
  broadening it now has no present force behind it.

## Security

> Reviewed against `docs/security.md`.

- **Workspace boundary:** N/A — no change to path validation; lockfile/socket
  paths are still derived from the workspace exactly as before, only the I/O
  call underneath changes.
- **Sensitive file exposure:** N/A — the daemon reads/writes only its own
  socket and lockfile, never user content.
- **Input injection:** N/A — no new user-supplied string reaches a new code
  path; the malformed-lockfile fixtures are test-only content written via
  `InMemoryFileSystem`.
- **Response leakage:** N/A — no change to error messages or response fields.

## Edges

- **Must NOT change:** observable behaviour of `isDaemonAlive`,
  `removeDaemonFiles`, `stopDaemon`, `runStop`, `runDaemon`, and `ensureDaemon`
  for any currently-tested scenario — this is a pure refactor, not a
  behaviour change.
- **Must NOT touch:** the currently-uncommitted, unrelated in-progress change
  to `startWatcher`'s extension-selection logic in `daemon.ts` (separate,
  pending work) — do not resolve or revert it as part of this task.
- **Out of scope:** `paths.ts`'s `workspaceHash`/`socketPath`/`lockfilePath`/
  `logfilePath` — see cut-list below. `process.kill`/`process.exit`/`spawn` —
  see Open decisions above.
- The ~7 existing test files calling these functions (`paths.test.ts`,
  `build-id.integration.test.ts`, `daemon.integration.test.ts`,
  `stop-daemon.integration.test.ts`, `run-functions.integration.test.ts`,
  `stop.integration.test.ts`, `ensure-daemon.test.ts`) must continue passing
  unmodified — the default-parameter design specifically avoids needing to
  touch them.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score improves for `src/daemon/daemon.ts` — run
      `pnpm test:mutate:file src/daemon/daemon.ts --force`; confirm the new
      tests kill the shape-validation survivors (lines 34–37 in the current
      baseline)
- [ ] Every remaining survivor on `daemon.ts` and `ensure-daemon.ts`
      classified and documented in `docs/tech/mutation-testing.md`'s survivor
      table (mirroring the existing `ensure-daemon.ts` table format):
      `RequestEnvelopeSchema` Zod-declaration mutants as noise (same class as
      `schema.ts`); `runDaemon`/`handleSocketRequest` body mutants as accepted
      subprocess-only noise (cross-reference the existing "Process-entry-point
      code has an inherent in-process coverage gap" lesson)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Docs updated: `docs/tech/mutation-testing.md` survivor table (see above);
      no command/internals doc changes needed (no public surface changed)
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended

