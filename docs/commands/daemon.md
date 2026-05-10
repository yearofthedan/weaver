# daemon

Start the long-lived engine host for a workspace. Loads the project graph into memory, watches for file changes, and accepts connections from `serve` instances over a Unix socket.

## When to use

- Pre-warming the engine before an agent session for low first-call latency.
- Running under a process supervisor (launchd, systemd, PM2).

If you do nothing, [`serve`](./serve.md) auto-spawns a daemon on first use. The auto-spawned daemon runs detached and persists after the `serve` session ends.

## Synopsis

```bash
weaver daemon --workspace /path/to/project [--verbose]
```

## Flags

| Flag | Required | Description |
| --- | --- | --- |
| `--workspace <path>` | yes | Workspace root. Absolute or relative to cwd. |
| `--verbose` | no | Enable per-request JSON logging at `~/.cache/weaver/<workspace-hash>.log`. Equivalent to `WEAVER_VERBOSE=1`. |

## Output

On ready (stderr):

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

The daemon does not log to stdout. It runs until SIGTERM/SIGINT.

## Examples

Pre-warm a workspace:

```bash
weaver daemon --workspace .
```

Stop it later:

```bash
weaver stop --workspace .
```

## Behavior

- One daemon per workspace (keyed by socket path derived from the workspace root).
- Engines (TS or Vue) are loaded lazily on the first request.
- The daemon processes one request at a time (promise-chain mutex). Concurrent socket connections queue.
- Filesystem watcher debounces file events at 200 ms and invalidates engine state out of band.
- Verbose log is capped at 10 MB with head truncation; permissions `0o600`.

→ Internals: [docs/internals/daemon.md](../internals/daemon.md), [docs/internals/watcher.md](../internals/watcher.md)
