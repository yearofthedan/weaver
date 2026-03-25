# `stop.integration.test.ts` flaky timeout

**type:** bug
**date:** 2026-03-25
**tracks:** handoff.md # stop.integration.test.ts-flaky-timeout

---

## Symptom

"stops a running daemon" test in `stop.integration.test.ts` times out intermittently (~21s on a 10s CLI timeout). Reproduces on pre-change commits — not a regression. Occurs in dev container where daemon startup/stop latency is higher.

## Value / Effort

- **Value:** Flaky test breaks CI intermittently. No user-facing impact.
- **Effort:** Trivial — one constant change.

```
input:    run stop.integration.test.ts in slow dev container
actual:   test times out after ~21s (10s runCliCommand default)
expected: test passes reliably
```

## Expected

Test passes reliably in slow environments by allowing enough headroom for the stop command's internal 5s poll loop plus socket ping overhead.

## Root cause

`runCliCommand` defaults to 10s timeout. The `stop` command internally does: `isDaemonAlive()` socket ping + lockfile read + SIGTERM + 5s poll loop + final `isDaemonAlive()` check. In a slow environment, the socket pings and tsx subprocess overhead push total time past 10s.

## Fix

Pass `20_000` as the timeout argument to `runCliCommand` in the "stops a running daemon" test at `src/daemon/stop.integration.test.ts:40`.

## Security

- **Workspace boundary:** N/A — test-only change, no production code modified.
- **Sensitive file exposure:** N/A — no file reading changes.
- **Input injection:** N/A — no input handling changes.
- **Response leakage:** N/A — no response changes.

## Edges

- The second test ("no daemon running") uses the default 10s timeout and is fine — it doesn't spawn a daemon, so stop returns immediately.
- Other daemon integration tests (`stop-daemon.integration.test.ts`) already use a 15s test-level timeout.

## Done-when

- [x] Reproduction case now produces expected output
- [x] Regression test covers the exact failing case (the test itself is the regression test)
- [x] Mutation score ≥ threshold for touched files (test-only change, no mutations)
- [x] `pnpm check` passes
- [x] Docs updated if public surface changed — N/A
- [x] Tech debt discovered during investigation added to handoff.md — none
- [x] Non-obvious gotchas — none
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Reflection:** Straightforward fix. The 10s default was always marginal given the stop command's internal 5s poll. 20s gives comfortable headroom without masking real issues.

- Tests added: 0 (existing test was the failing case)
- Mutation score: N/A (test-only change)
- No architectural decisions needed
