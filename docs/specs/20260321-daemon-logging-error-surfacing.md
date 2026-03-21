# Daemon logging and error surfacing

**type:** change
**date:** 2026-03-21
**tracks:** handoff.md # daemon-request-logging + audit-silent-error-swallowing → docs/features/daemon.md

---

## Context

The daemon has no logging after the startup ready signal. Stderr is disconnected from the parent after spawn. Debugging daemon-only bugs requires patching source, rebuilding, and manually wiring stderr to a file. Two real investigations (VolarCompiler moveFile, walkFiles ENOENT) each required manual `console.error` tracing, rebuild, daemon restart, and reproduction.

Separately, several operations silently catch errors and `continue`, hiding bugs that should be visible. The pattern is inconsistent — `remove-importers.ts` correctly calls `scope.recordSkipped()` on read failure, but `searchText.ts`, `replaceText.ts`, and `scan.ts` swallow the same failure silently.

## User intent

*As a developer debugging a daemon issue in a project that uses light-bridge, I want opt-in request logging and honest error surfacing, so that I can diagnose failures from a log file and from tool responses instead of patching source and rebuilding.*

## Relevant files

- `src/daemon/daemon.ts` — `handleSocketRequest` (log site), `runDaemon` (flag plumbing), `shutdown` (cleanup)
- `src/daemon/paths.ts` — `socketPath`, `lockfilePath`, `ensureCacheDir`; new `logfilePath` goes here
- `src/adapters/cli/cli.ts` — CLI entry; `--verbose` flag added to `daemon` command
- `src/daemon/ensure-daemon.ts` — `spawnDaemon`; must forward `--verbose` when auto-spawning
- `src/daemon/language-plugin-registry.ts` — `invalidateFile`, `invalidateAll` catch blocks
- `src/operations/searchText.ts` — `catch { continue }` after `scope.fs.readFile`
- `src/operations/replaceText.ts` — `catch { continue }` after `scope.fs.readFile`
- `src/plugins/vue/scan.ts` — `catch { continue }` after `scope.fs.readFile` (two sites)
- `src/ts-engine/remove-importers.ts` — model for correct pattern (`catch { scope.recordSkipped(); continue }`)

### Red flags

- `daemon.ts` line 170: `socket.on("error", () => {})` — completely silent socket error handler. Should log when verbose.
- `scan.ts` has two `catch { continue }` blocks; one of them (in `removeVueImportsOfDeletedFile`) doesn't call `scope.recordSkipped()` even though the sibling function does — inconsistent.

## Value / Effort

- **Value:** Eliminates the rebuild-restart-reproduce loop for daemon debugging. When a user reports "moveFile silently did nothing," the verbose log shows the request, the error, and the stack trace. The error swallowing fixes make `filesSkipped` in tool responses trustworthy — agents (and humans reading responses) can see which files were skipped and investigate, instead of getting a clean response that hides a real problem.
- **Effort:** Small-medium. `--verbose` flag plumbing is ~30 lines across `cli.ts`, `daemon.ts`, `ensure-daemon.ts`. Log writing is ~20 lines in `daemon.ts`. The error swallowing fixes are 1-2 line changes each across 4 files. New `logfilePath` function is trivial (follows `socketPath` pattern).

## Behaviour

- [ ] **AC1: Opt-in verbose logging via `--verbose` flag.** `light-bridge daemon --workspace /path --verbose` writes structured JSON log lines to `~/.cache/light-bridge/<workspace-hash>.log`. Without `--verbose`, no log file is created. The env var `LIGHT_BRIDGE_VERBOSE=1` is equivalent to `--verbose` (flag takes precedence). When `serve` auto-spawns a daemon via `ensureDaemon`, it forwards the verbose setting to `spawnDaemon`.

- [ ] **AC2: Per-request log entry.** Each `handleSocketRequest` invocation writes one JSON line to the log file (when verbose). Fields: `ts` (ISO 8601), `method` (string), `durationMs` (number), `ok` (boolean). On error: adds `error` (error code string) and `message`. On success for write operations: adds `filesModified` (count, not paths). On any thrown error: adds `stack` with the workspace prefix stripped from absolute paths (e.g. `/home/user/project/src/foo.ts` becomes `src/foo.ts`).

- [ ] **AC3: Log file cleaned up on clean shutdown.** `shutdown()` in `daemon.ts` deletes the log file alongside the socket and lockfile. On crash (unhandled exception, SIGKILL), the log file survives — that's when it's most needed.

- [ ] **AC4: Silent file-read catches record skipped files.** In `searchText.ts`, `replaceText.ts`, and both sites in `scan.ts`, the `catch { continue }` blocks after `scope.fs.readFile()` call `scope.recordSkipped(filePath)` before continuing. This makes `filesSkipped` in tool responses accurate.

- [ ] **AC5: Socket error handler logs when verbose.** `socket.on("error", () => {})` in `daemon.ts` logs the error code and message to the log file when verbose is enabled. Remains a no-op when verbose is off (connection resets are normal; they shouldn't pollute stderr).

## Interface

### CLI

```
light-bridge daemon --workspace <path> [--verbose]
```

`--verbose` is a boolean flag, default `false`. Env var `LIGHT_BRIDGE_VERBOSE=1` is equivalent.

### Log file

Path: `~/.cache/light-bridge/<workspace-hash>.log` (same hash as socket/lockfile, same `paths.ts` module).

Each line is a self-contained JSON object. No multi-line entries. Example:

```json
{"ts":"2026-03-21T14:30:00.123Z","method":"moveFile","durationMs":42,"ok":true,"filesModified":3}
{"ts":"2026-03-21T14:30:01.456Z","method":"rename","durationMs":5,"ok":false,"error":"SYMBOL_NOT_FOUND","message":"No symbol at line 10, col 5 in src/foo.ts","stack":"EngineError: No symbol at line 10, col 5 in src/foo.ts\n    at TsMorphEngine.resolveOffset (src/ts-engine/engine.ts:230:7)"}
```

Note: paths in `stack` are workspace-relative. The `message` field mirrors what the socket response already contains — no new information is exposed, just persisted.

### `filesSkipped` in tool responses

Already exists in the response shape via `WorkspaceScope.skipped`. AC4 makes it accurate for file-read failures, not just workspace boundary violations.

## Open decisions

### Resolved: Log file vs stderr

**Decision:** Where do verbose log lines go?

**Chosen approach:** Dedicated log file at `~/.cache/light-bridge/<hash>.log`.

**Reasoning:** Stderr is disconnected after `spawnDaemon` reads the ready signal (`child.unref()`). Keeping stderr connected would require architectural changes to the spawn model. A log file in the existing cache dir is simple, doesn't require process supervision, and can be `tail -f`'d during reproduction.

**Consequence:** `paths.ts` gets a new `logfilePath` export. `shutdown()` must delete it.

### Resolved: Always-on vs opt-in

**Decision:** Should logging be always-on or opt-in?

**Chosen approach:** Opt-in via `--verbose` / `LIGHT_BRIDGE_VERBOSE=1`.

**Reasoning:** light-bridge is a library installed into other people's projects. Always-on logging creates privacy risk (stack traces contain project paths) and disk accumulation risk. Opt-in matches the pattern used by Claude Code (`--debug`) and other developer tools. The tradeoff — "I wish I had logging when the bug happened" — is acceptable because the reproduction workflow (stop → restart with `--verbose` → reproduce) is fast.

**Consequence:** Users must know to use `--verbose` to get logs. The flag should be mentioned in error responses and documentation so it's discoverable.

## Security

- **Workspace boundary:** N/A — no new file reads or writes to user project files. The log file is written to `~/.cache/`, outside the workspace.
- **Sensitive file exposure:** Stack traces can contain absolute file paths from the user's project. AC2 requires stripping the workspace prefix so only relative paths appear in the log. Error `message` fields may still contain paths — these already appear in socket responses today, so no new exposure surface.
- **Input injection:** N/A — no new string parameters reach the filesystem or shell. The `--verbose` flag is a boolean.
- **Response leakage:** N/A — AC4 changes what goes into `filesSkipped` (file paths already in scope), not new information.
- **Log file permissions:** The log file should be created with mode `0o600` (owner read/write only) to prevent other users on shared machines from reading project paths.

## Edges

- Log file must not grow unbounded during a long daemon session. Cap at 10 MB; when exceeded, truncate from the head (oldest entries removed). This keeps the implementation simple — no rotation, no numbered files.
- `--verbose` must not measurably affect request latency. Log writes are appended synchronously (`fs.appendFileSync`) — this is acceptable because log lines are small (<1 KB) and the daemon already serialises requests.
- Plugin isolation in `invalidateFile`/`invalidateAll` must not change — errors are caught and logged, not propagated. The catch blocks already have the right control flow; AC5-level logging (write to log file when verbose) is sufficient.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/features/daemon.md` updated with verbose logging section
      - `README.md` CLI command table updated if daemon flags are listed there
      - `handoff.md` current-state section updated (daemon.ts description)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
