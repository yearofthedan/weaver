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

- [ ] **AC1 — Idle timeout drops the diagnostic service and its parses.** Given a daemon that has loaded a diagnostic program (service + parse cache warm), after 5 minutes with no requests, the `DiagnosticService` and its `parsed` map for every tsconfig are dropped. The next `getTypeErrors` call rebuilds the program and re-parses every root from disk, producing identical diagnostics.

- [ ] **AC2 — Each operation request resets the idle timer; ping does not.** Given a daemon whose last operation request arrived 4 minutes ago, when any operation lands — read-only or mutating, arriving through `dispatchRequest` — the idle countdown resets to 5 minutes. A `ping` request (handled inline in `handleSocketRequest`, never reaching `dispatchRequest`) does NOT reset the timer — a health check should not pin diagnostic memory.

- [ ] **AC3 — Ts-morph projects are not evicted.** Given a daemon that has loaded both a ts-morph project and a diagnostic program, after 5 minutes idle, the ts-morph project is still warm — `findReferences`, `rename`, and `getDefinition` answer without reloading. Only `DiagnosticServiceCache.entries` is affected.

- [ ] **AC4 — Plugin engines are out of scope.** The idle eviction reaches `tsMorphEngineSingleton` only (same as `evictDiagnosticParse`). Volar/plugin engine memory is not evicted. The existing `evictDiagnosticParse` restriction is inherited, not widened.

## Structural criteria

- [ ] Idle-timer logic lives in a standalone, exported module (`src/daemon/idle-eviction.ts`) that accepts clock and eviction callbacks at construction, so every AC is testable with `vi.useFakeTimers`.

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

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated if public surface changed: (none — no public surface change)
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended