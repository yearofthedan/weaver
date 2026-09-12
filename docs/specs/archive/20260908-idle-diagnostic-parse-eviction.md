# Idle diagnostic service eviction

**type:** change
**date:** 2026-09-08
**tracks:** handoff.md # The daemon holds two compilers per tsconfig, and it is expensive

---

## Context

The daemon loads a ts-morph project (find-references, rename, etc.) and a diagnostic program (type checking), then keeps both resident forever. Measured on this repo after cold start: **524 MB** after ts-morph-only `find-references`, **876 MB** after a project-wide `get-type-errors` adds the diagnostic program and its parse cache, **1342 MB** with a second tsconfig. The diagnostic half — the `DiagnosticService` and its retained `parsed: Map<string, ts.SourceFile>` — is ~350 MB per tsconfig. Dropping it costs one rebuild (~540 ms on the next check).

Dropping only the parse map would free nothing: the `DiagnosticService` holds a `ts.Program` that references every `SourceFile` the map holds. Both must be dropped together. That is what `refreshFile` and `evictFile` already do per file on a write — by setting `entry.service = undefined`. Here the operation runs bulk across every tsconfig on the idle timer.

## User intent

*As a developer using weaver in a long-lived daemon session, I want the daemon to release unused memory after I stop sending it requests, so background daemon processes don't consume hundreds of MB indefinitely.*

## Relevant files

- `src/ts-engine/diagnostic-service.ts` — `DiagnosticServiceCache` holds entries with `{ parsed, service? }`; idle eviction drops `service` and clears `parsed` across all entries, leaving the keys
- `src/ts-engine/engine.ts` — `TsMorphEngine` wraps the cache; needs a pass-through method for idle eviction
- `src/daemon/language-plugin-registry.ts` — `evictDiagnosticParse` reaches `tsMorphEngineSingleton` only; the idle sibling inherits that scope
- `src/daemon/daemon.ts` — `runDaemon` starts the server/watcher; wires the idle timer and passes teardown into `runLifecycle`
- `src/daemon/lifecycle.ts` — `DaemonLifecycleOpts` gains an `onIdle` callback; `shutdown` calls it
- `src/daemon/dispatcher.ts` — `dispatchRequest` lands every operation request; the idle-tracking timestamp is updated after dispatching (not inside `handleSocketRequest`, so `ping` does not reset it)
- New: `src/daemon/idle-eviction.ts` — exported `startIdleTimer({ now, evict, timeoutMs, intervalMs })` returning `{ reset: () => void, stop: () => void }`; the testable unit behind the `setInterval` in `runDaemon`

### Red flags

(none)

## Value / Effort

- **Value:** A developer runs `weaver daemon` in the background. After finishing a refactoring session, the diagnostic program and its parse cache sit in the daemon's heap indefinitely. With idle eviction, both are dropped after 5 minutes of inactivity, freeing ~350 MB per tsconfig for reuse within V8's heap. The ts-morph project stays warm, so find-references and rename remain instant.
- **Effort:** One new method on `DiagnosticServiceCache`, one passthrough each on `TsMorphEngine` and `language-plugin-registry.ts`, a new pure `startIdleTimer` module tested with fake timers, and wiring in `runDaemon`/`runLifecycle`/`dispatcher`. No new CLI surface, no new infrastructure.

## Behaviour

- [x] **AC1 — Idle timeout drops the diagnostic service and its parses.** Given a daemon that has loaded a diagnostic program (service + parse cache warm), after 5 minutes with no requests, the `DiagnosticService` and its `parsed` map for every tsconfig are dropped. The next `getTypeErrors` call rebuilds the program and re-parses every root from disk, producing identical diagnostics.

- [x] **AC2 — Each operation request resets the idle timer; ping does not.** Given a daemon whose last operation request arrived 4 minutes ago, when any operation lands — read-only or mutating, arriving through `dispatchRequest` — the idle countdown resets to 5 minutes. A `ping` request (handled inline in `handleSocketRequest`, never reaching `dispatchRequest`) does NOT reset the timer — a health check should not pin diagnostic memory.

- [x] **AC3 — Ts-morph projects are not evicted.** Given a daemon that has loaded both a ts-morph project and a diagnostic program, after 5 minutes idle, the ts-morph project is still warm — `findReferences`, `rename`, and `getDefinition` answer without reloading. Only `DiagnosticServiceCache.entries` is affected.

- [x] **AC4 — Plugin engines are out of scope.** The idle eviction reaches `tsMorphEngineSingleton` only (same as `evictDiagnosticParse`). Volar/plugin engine memory is not evicted. The existing `evictDiagnosticParse` restriction is inherited, not widened.

## Structural criteria

- [x] Idle-timer logic lives in a standalone, exported module (`src/daemon/idle-eviction.ts`) that accepts clock and eviction callbacks at construction, so every AC is testable with `vi.useFakeTimers`.

## Interface

No public surface changes. No CLI flag, no response field, no new error code. The timeout is hardcoded at 5 minutes.

## Open decisions

(none — resolved in the spec conversation: diagnostic service + parses only, any operation request resets timer, hardcoded 5 minutes, no configuration, test seam via `startIdleTimer`)

## Security

- **Workspace boundary:** N/A — no new file reads or writes.
- **Sensitive file exposure:** N/A — no new file content access.
- **Input injection:** N/A — no new user-supplied parameters.
- **Response leakage:** N/A — no change to error messages or response fields.

## Edges

- A write operation that calls `evictDiagnosticParse` is an operation request — it resets the timer (covered by AC2).
- An entry with warm `parsed` and no `service` is the normal post-write state (`evictFile`/`refreshFile` set `service = undefined` and keep `parsed`). The idle eviction handles this correctly: clearing `parsed` on every entry, regardless of whether `service` is currently set.
- The idle check polls at 60-second granularity, so eviction can fire up to ~60s after the 5-minute idle mark. The daemon makes no real-time promise.
- Dropping the diagnostic service loses the roots `addScriptFile` added (a separate known issue — `handoff.md:195`). Harmless here: roots are re-derived from the ts-morph project on the next `get`, producing the same set.
- The interval handle is stored and passed to `clearInterval` in `runLifecycle`'s `shutdown`, so in-process daemon tests don't hang on a live handle. The interval uses `unref()` so it does not keep the process alive on its own.
- V8 does not reliably return freed heap to the OS; verify AC1 by asserting the cache is empty, not by watching RSS.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] `/review-changes` run over the whole change and its findings applied
- [x] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [x] Docs updated if public surface changed: (none — no public surface change)
- [x] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [x] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

---

## Outcome

**Verification.** Driven through the built CLI against a live daemon. The wiring is the part no test can reach — `runDaemon` and `handleSocketRequest` only run in a spawned process, and the timeout is not injectable — so it was exercised by patching `DEFAULT_TIMEOUT_MS` to 3 s and the poll interval to 500 ms in a throwaway worktree, building there, and driving that daemon's socket. Against this repo, 88 files in the program:

| Step | ms |
|---|---|
| cold (spawn + first project-wide check) | 2591 |
| warm | 248 |
| `ping`, 1.5 s after the last request | — |
| next operation call, 2 s after the ping | **1509** |
| following call | 241 |

The 1509 ms is the rebuild that follows an eviction; had `ping` reset the countdown, that call would have been warm. The same shape holds on a 3,000-file fixture carrying one deliberate `TS2322`: cold 1442, warm 261, post-idle 630, then 256, with that single diagnostic byte-identical in all four responses. A separate run on a 400-file fixture with the real 5-minute timeout took resident memory from **413 MB to 53 MB** across a 370 s idle window, and its post-idle response was byte-identical to the warm one.

**Memory actually released.** Across `evictAllDiagnosticParses` on this repo, `heapUsed` goes 466 MB → 189 MB (277 MB for one tsconfig), and `find-references` still answers in 3 ms afterwards. That is AC3 measured rather than inferred: the ts-morph project is genuinely still loaded, not silently rebuilt.

**Tests.** 1461 main tests (from 1455), 531 eval unchanged. Added: the timer's exact-timeout boundary, engine evicts-and-then-reads-from-disk, engine project-wide diagnostics unchanged across an eviction, the registry passthrough reaching the loaded engine (and being a no-op with none loaded), and the lifecycle calling its shutdown hook. The dispatcher's two activity tests were rewritten to pass the callback explicitly, and one that could not fail was replaced.

**Mutation**, scoped to the seven touched files: `idle-eviction` 92.00%, `lifecycle` 100%, `language-plugin-registry` 90.24%, `dispatcher` 93.39%, `engine` 84.15%, `diagnostic-service` 77.11%, `daemon` 18.31%. Every mutant on a line this change introduced is killed. Two survivors are recorded rather than killed, each with its reason at the line or in `docs/tech/mutation-testing.md`: `handle.unref()` (unobservable in-process) and the `runDaemon` wiring (subprocess-only, outside the lane's test config). Every remaining survivor sits on a line this change did not touch — `src/ts-engine/**` and `src/daemon/**` are commented out of the default `mutate` array, so this run was their first measurement. That gap is queued as its own `[needs design]` entry rather than fixed here.

**What the review changed.** Four review passes over the diff (reuse, simplicity, efficiency, architecture) plus an independent spec-fit review. Both halves of the change moved as a result:

- The activity signal was a module-global callback that `runDaemon` installed on startup and unset on shutdown. It is now a parameter passed beside the logger, so the only idle state stays in `runDaemon`; the shutdown unset and the cross-test reset both disappear.
- It fired *before* the operation ran, where the spec said after dispatching. Moved into `finally`, so idle is measured from the end of the last request rather than its start.
- `evictAll` kept its entry keys "so which tsconfigs the daemon has seen is not lost". Nothing reads them, and the test that claimed to pin the property could not fail — it passed with an empty body and with `entries.clear()`. It now clears outright.
- A comment claimed the wiring "is verified end to end against a live daemon" when no such test existed; it now says only what is true, and the manual procedure lives in `docs/internals/daemon.md`.
- Two missing guards were added: the project-wide result is unchanged across an eviction, and the registry actually reaches the engine rather than merely not clearing plugin caches.
- The documented rebuild cost was the single-file figure. Project-wide — the operation that builds the program, and the one a user runs — is 1.1–1.5 s, about 2.5× what the doc (and this spec's Context, above) claimed.

**Deviations from this spec.** Two, both deliberate and recorded rather than reverted. The activity signal is a parameter to `dispatchRequest` that fires after the request completes, where the spec sketched a timestamp the dispatcher updated; `ping` stays excluded because it never reaches the dispatcher at all. And `evictAll` drops the entry keys instead of preserving them, because the property the preservation existed to protect has no reader.

**Reflection.** The change itself was small; the review is what took the time, and it earned it twice over — the module-global was a real design smell the tests could not see, and the tautological test would have sat there passing forever.

What went wrong here was continuity, not code. The implementation landed as two commits and stopped: no review, no mutation run, no verification, no archive, and the handoff entry left pointing at it as live work. This session spent its first stretch reconstructing what had and had not been done, from commit messages and the state of the tree. A slice that stops mid-flight leaves work that is worse than not started, because the next agent cannot tell the difference between "reviewed and clean" and "never looked at" from the outside.

Verification was also wrong twice before it was right, and both failures were mine rather than the code's: the first run passed no JSON argument to the CLI, so every call errored without touching the daemon; the second passed a fixture whose generator produced no type errors, so "identical diagnostics" compared two empty lists. The fixture mattered — a run where the shared state is empty cannot distinguish a rebuild from a no-op.

Three things are worth carrying forward. The 30-second wiring check (patch the timeout, build, spawn, drive the socket) is now written into `docs/internals/daemon.md`, so nobody should rediscover it. Two 20-minute mutation runs plus a `pnpm check` per commit dominated the wall clock; scoping the second run to the files the review had actually touched would have been enough. And the advisory review on a stronger model was the highest-value step in the slice — it found the tautological test, the spec deviation and the false comment that four same-model lenses plus the author had all read past.
