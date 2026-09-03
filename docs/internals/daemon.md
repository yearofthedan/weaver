# Internals: Daemon

**Purpose:** Lifecycle, discovery, and how `serve` connects to the daemon.

User-facing reference: [docs/commands/daemon.md](../commands/daemon.md), [docs/commands/serve.md](../commands/serve.md), [docs/commands/stop.md](../commands/stop.md).

## Why it exists

Two requirements conflict if you try to solve them in a single process-per-session model:

1. **Low startup latency** — loading a TypeScript or Vue project into memory is expensive. Paying that cost on every agent session makes the first tool call slow.
2. **Persistence across sessions** — the project graph stays loaded between sessions so subsequent sessions start instantly.

The daemon solves both: load once, stay alive.

## Lifecycle

```
weaver daemon --workspace /path/to/project
  ├── resolve and validate workspace path
  ├── register SIGTERM/SIGINT shutdown handlers   ← before anything discoverable
  ├── write lockfile with PID
  ├── open Unix socket at ~/.cache/weaver/<workspace-hash>.sock
  ├── start filesystem watcher for the workspace
  └── write ready signal to stderr, wait for connections
```

The daemon runs until it receives SIGTERM or SIGINT. It does not exit when all client sessions disconnect.

Engines are loaded lazily on first request. The dispatcher picks `TsMorphCompiler` or `VolarCompiler` per operation based on project type and request path.

## Daemon discovery

`serve` locates the daemon for a workspace using a socket file at a deterministic path derived from the workspace root (`src/daemon/paths.ts`). A corresponding lockfile records the daemon PID so stale sockets can be detected.

If the socket file exists but the process is not running (stale lockfile), the stale socket and lockfile are removed and a new daemon is spawned.

## Auto-spawn

`serve` auto-spawns the daemon if none is running for the workspace. The spawned daemon runs as a detached, unref'd child process so it outlives the `serve` session that created it.

`serve` calls `ensureDaemon` at startup and again per tool call. If the daemon dies mid-session, the next tool call attempts to reconnect/spawn and may briefly return `DAEMON_STARTING` while the new daemon is coming up.

## Readiness

The daemon signals readiness by writing to stderr after the project graph is fully loaded:

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

If `serve` connects while the daemon is still loading, incoming tool calls are rejected with `DAEMON_STARTING`. The agent retries.

## Request serialisation

The daemon processes one request at a time using a promise-chain mutex in `daemon.ts`. Concurrent socket connections are queued rather than interleaved. This prevents concurrent mutations from corrupting the in-memory project graph.

## Filesystem watcher

Implemented in `src/daemon/watcher.ts` using chokidar.

- Watches the workspace root.
- Filters to `.ts`, `.tsx`, `.js`, `.jsx` and `.vue` — always all five, whatever the project type.
- Debounces file events (200ms) to avoid thrash during save bursts.
- Skips events for writes the daemon made itself, which are already reflected in the engines.
- Calls `invalidateFile(path)` on content changes.
- Calls `invalidateAll()` on add/remove events.

The watcher keeps provider state fresh when files are edited outside weaver (editor saves, generators, branch switches). Full behavior and invalidation strategy are documented in [watcher.md](watcher.md).

## Implementation notes

**The daemon routes through `VolarCompiler` only when the tsconfig includes `.vue` files.**
`isVueProject` (`src/utils/ts-project.ts`) calls `ts.parseJsonConfigFileContent` with a `.vue` extra extension to check whether any `.vue` file sits in the project graph, respecting the tsconfig's `include`/`exclude`. Only `.vue` files matched by the tsconfig trigger `VolarCompiler` routing. When debugging a daemon-only bug, confirm which compiler is handling the request before investigating compiler internals — the real project (with `node_modules`, `.vue` fixtures, cached compiler state) may route differently than a simplified copy.

**Project discovery is memoised per dispatch, not for the daemon's lifetime.**
`findTsConfig` and `isVueProject` both memoise in module-level Maps, and `dispatchRequest` calls `resetDiscoveryCaches()` as its first statement — before `makeRegistry`, which runs `findTsConfigForFile` while choosing the engine. A daemon outlives many CLI calls, so a lifetime memo makes every structural change to the project invisible: the dominant failure was a workspace gaining its first `.vue` file, which kept routing through `TsMorphEngine` so a `rename` skipped every `.vue` occurrence and still reported success.

The guarantee is "cleared at the start of each dispatch", *not* "empty when idle" — watcher callbacks fire between requests and `refreshFile` runs its own `findTsConfigForFile`, so the Maps repopulate while the daemon sits idle. That is harmless; only freshness within a dispatch matters.

Invalidation is deliberately not watcher-driven. `watcher.ts` filters events by file extension, and `.json` is in no extension set, so a `tsconfig.json` create or delete reaches no callback at all — and a `tsconfig.json` created *above* the workspace root is outside the watch tree entirely. Recompute is cheap enough to make the question moot: the `findTsConfig` walk costs 0.006–0.011 ms and `isVueProject` 0.2–1.3 ms (measured on this repo, 2026-08-09), against ~520 ms for any end-to-end CLI call. Do not "optimise" this back into a lifetime cache. If `isVueProject`'s cost ever matters, make the check cheaper — it does not need full file enumeration to answer "is there at least one `.vue` in the include set".

**Signal handlers are registered before the daemon becomes discoverable.**
`runLifecycle` (`src/daemon/lifecycle.ts`) installs the SIGTERM/SIGINT handlers before writing the lockfile or opening the socket — a daemon is stoppable by PID the instant those exist, and a signal landing before the handler is installed would kill it on the default disposition, leaving a stale socket/lockfile. `shutdown()` is safe at any startup stage, so the server and watcher are optional when it fires. The sequencing sits behind the `FileSystem` port and a `DaemonHost` (`onSignal`/`exit`) seam, so lifecycle changes are unit-tested in `lifecycle.test.ts` rather than by spawning a process.

**Test race: daemon socket not yet open when test connects.**
After spawning the daemon process, the socket file may not exist yet. Use `waitForDaemon` (or equivalent retry logic) before sending the first socket request in tests.

**`child.pid` is the tsx wrapper PID, not the script's PID.**
When you spawn a process with `spawn('tsx', ...)`, `child.pid` is the PID of the tsx wrapper, not `process.pid` inside the script. To check if a lockfile PID is alive, use `process.kill(pid, 0)` — don't compare to `child.pid`.

**`callDaemon` failure returns `DAEMON_STARTING`.**
If the socket connection fails (daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent rather than throwing.

**`stopDaemon` is the canonical way to kill a daemon from `ensure-daemon.ts`.**
Exported from `daemon.ts`. Reads the lockfile PID, sends SIGTERM, polls until `isDaemonAlive` returns false (up to 5s), then calls `removeDaemonFiles`. Avoids duplicating the kill-and-wait logic from `runStop`.

**`ping` is a meta-operation handled before `dispatchRequest`.**
`handleSocketRequest` in `daemon.ts` intercepts `method === "ping"` before calling `dispatchRequest`, returning `{ status: "success", buildId }` directly. This avoids adding `ping` to the `OPERATIONS` table and keeps the dispatcher clean of protocol-level concerns.

**`dispatchRequest` is total — the socket handler only serialises.**
Every failure, including anything an operation throws, is caught inside `dispatchRequest` and returned as a `DispatchResponse` discriminated on `status`. The handler does not map `EngineError` to a code; it owns only `PARSE_ERROR`, which describes a malformed wire message rather than a failed operation, and which is the sole remaining throw source in the request path (`JSON.parse`). A second transport therefore needs no error-shaping logic of its own.

**A daemon is reused only if it is running the build on disk.**
`build-id.ts` defines the build as the mtime of `dist/adapters/cli/cli.js` — the entry both the CLI and the daemon it spawns run from. The daemon captures it at module load into `RUNNING_BUILD_ID` and reports it from `ping`; `ensureDaemon` compares against a fresh read and, on mismatch, calls `stopDaemon` and respawns.

Capture at load, never per request. A rebuild replaces the entry on disk while the daemon keeps serving the code it already loaded, so reading the mtime per ping would report the daemon as current at exactly the moment it went stale.

Use mtime rather than a content hash. `pnpm build` is `rm -rf dist && tsc`, so every build recreates every file and moves every mtime — including when the only change was in a module the entry does not contain, where `cli.js` comes out byte-identical. The comparison is equality only, never ordering, so clock changes cannot make a stale daemon look current. An unreadable entry counts as a mismatch.

`ensureDaemon` uses a `buildVerified` module-level flag so the check runs once per CLI process. Reset it whenever the daemon is detected as dead so the next spawn is re-verified.

**The self-dependency must stay `link:.`.** `package.json` depends on the package itself so `pnpm exec weaver` resolves in-repo. `link:` symlinks the repo root, so the bin runs the current `dist/`. `file:` instead installs a packed copy that refreshes only on `pnpm install`, which leaves `pnpm exec weaver` serving whatever was built the last time someone installed.

## Verbose logging

Opt-in per-request logging for debugging daemon issues. Disabled by default — no log file is created unless explicitly enabled.

```bash
weaver daemon --workspace /path --verbose
# or
WEAVER_VERBOSE=1 weaver daemon --workspace /path
```

When enabled, the daemon writes structured JSON log lines to `~/.cache/weaver/<workspace-hash>.log`. Each request produces one line with: timestamp, method, duration, success/failure, error details, and stack traces (with workspace paths stripped to relative).

The log file is deleted on clean shutdown (alongside socket and lockfile). On crash, it survives for post-mortem inspection. Capped at 10 MB with head truncation. File permissions are `0o600` (owner-only).

When `serve` auto-spawns a daemon, it forwards `WEAVER_VERBOSE=1` to `spawnDaemon`.

## Out of scope

- Multiple workspaces per daemon — one daemon per workspace keeps state isolated
- Remote daemon — daemon and `serve` are always co-located on the same machine
- Daemon restart on crash — process supervision is left to the developer's tooling
