# Feature: Daemon

**Purpose:** When to start the daemon, what it does, and how `serve` connects to it.

## When and why to start it

The daemon is a long-lived background process that owns the language service for a workspace. Start it when:

- You are about to begin an agent session and want the first tool call to be fast (pre-warming)
- You want the daemon managed by your process supervisor (launchd, systemd, PM2) rather than auto-spawned

If you do nothing, `serve` will auto-spawn a daemon the first time it is started. The auto-spawned daemon runs detached and persists after the `serve` session ends.

```bash
light-bridge daemon --workspace /path/to/project
```

## Why it exists

Two requirements conflict if you try to solve them in a single process-per-session model:

1. **Low startup latency** — loading a TypeScript or Vue project into memory is expensive. Paying that cost on every agent session makes the first tool call slow.
2. **Persistence across sessions** — the project graph stays loaded between sessions so subsequent sessions start instantly.

The daemon solves both: load once, stay alive.

## Lifecycle

```
light-bridge daemon --workspace /path/to/project
  ├── resolve and validate workspace path
  ├── open Unix socket at ~/.cache/light-bridge/<workspace-hash>.sock
  ├── write lockfile with PID
  ├── start filesystem watcher for the workspace
  └── write ready signal to stderr, wait for connections
```

The daemon runs until it receives SIGTERM or SIGINT. It does not exit when all client sessions disconnect.

Engines are loaded lazily on first request. The dispatcher picks `TsProvider` or `VolarProvider` per operation based on project type and request path.

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
- Filters to project-relevant extensions (`.ts`, `.tsx`, `.js`, `.jsx`, and `.vue` for Vue projects).
- Debounces file events (200ms) to avoid thrash during save bursts.
- Calls `invalidateFile(path)` on content changes.
- Calls `invalidateAll()` on add/remove events.

The watcher keeps provider state fresh when files are edited outside light-bridge (editor saves, generators, branch switches). Full behavior and invalidation strategy are documented in [watcher.md](watcher.md).

## Out of scope

- Multiple workspaces per daemon — one daemon per workspace keeps state isolated
- Remote daemon — daemon and `serve` are always co-located on the same machine
- Daemon restart on crash — process supervision is left to the developer's tooling
