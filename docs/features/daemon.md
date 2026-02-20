# Feature: Daemon

## What it is

The daemon is a long-lived background process that owns the language service for a workspace. It loads the project graph into memory at startup, watches the filesystem for changes, and keeps the in-memory representation in sync. MCP server instances (`light-bridge serve`) connect to it via a local socket to dispatch tool calls.

## Why it exists

Two requirements conflict if you try to solve them in a single process-per-session model:

1. **Low startup latency** — loading a TypeScript or Vue project into memory is expensive. Paying that cost on every agent session makes the first tool call slow.
2. **Awareness of external changes** — the agent writes files directly. The developer edits files. Other tools run. The language service must reflect the current state of the project, not a snapshot from session start.

The daemon solves both: load once, watch always.

## Lifecycle

```
light-bridge daemon --workspace /path/to/project
  ├── resolve and validate workspace
  ├── detect engine type (TypeScript or Vue)
  ├── load project graph into memory
  ├── start filesystem watcher
  ├── open local socket
  └── write ready signal to stderr, wait for connections
```

The daemon runs until it receives SIGTERM or SIGINT. It does not exit when all client sessions disconnect.

## Daemon discovery

`serve` locates the daemon for a workspace using a socket file at a deterministic path derived from the workspace root (e.g. `~/.cache/light-bridge/<workspace-hash>.sock`). A corresponding lockfile records the daemon PID so stale sockets can be detected.

If the socket file exists but the process is not running, the stale socket is removed and a new daemon is spawned.

## Auto-spawn

`serve` auto-spawns the daemon if none is running for the workspace. The spawned daemon runs as a detached child process so it outlives the `serve` session that created it.

The daemon can also be started explicitly with `light-bridge daemon` — useful for pre-warming before an agent session, or for managing the process via a supervisor.

## File watcher

The daemon watches the workspace root for file additions, modifications, and deletions. On change, it updates the in-memory project graph for the affected file(s). This ensures that tool calls always operate on current state, even if the agent or developer has written files outside of light-bridge.

Watcher granularity and incremental update strategy are implementation details TBD during development.

## Readiness

The daemon signals readiness by writing to stderr after the project graph is fully loaded:

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

If `serve` connects while the daemon is still loading, it does not wait. Incoming tool calls are rejected with `DAEMON_STARTING` until the daemon signals ready. The agent retries.

## Out of scope

- Multiple workspaces per daemon — one daemon per workspace keeps state isolated and simplifies the implementation
- Remote daemon — daemon and `serve` are always co-located on the same machine
- Daemon restart on crash — process supervision is left to the developer's tooling (e.g. launchd, systemd, PM2)
