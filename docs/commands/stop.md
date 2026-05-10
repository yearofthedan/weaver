# stop

Stop a running daemon for a workspace.

## When to use

- After finishing work in a workspace and you don't want the daemon running idle.
- Forcing a clean restart after a config change.

## Synopsis

```bash
weaver stop --workspace /path/to/project
```

## Flags

| Flag | Required | Description |
| --- | --- | --- |
| `--workspace <path>` | yes | Workspace root. Absolute or relative to cwd. |

## Output

When a daemon was running:

```json
{ "ok": true, "stopped": true }
```

When no daemon was running:

```json
{ "ok": true, "stopped": false, "message": "No daemon running for this workspace" }
```

## Behavior

- Reads the lockfile PID, sends SIGTERM, waits up to 5 s for the process to exit.
- Removes the socket file and lockfile.
- Exit code `0` on success (whether or not a daemon was actually running).

→ Internals: [docs/internals/daemon.md](../internals/daemon.md)
