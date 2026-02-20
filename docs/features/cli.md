# Feature: CLI

## What it is

The CLI is the primary binary for light-bridge. It serves two purposes: launching the MCP server process for agent sessions, and executing one-off refactoring operations directly from the shell.

## Commands

### `light-bridge daemon`

Starts the long-lived daemon process for a workspace. Loads the project graph into memory, starts the filesystem watcher, and listens on a local socket for connections from `serve` instances.

```bash
light-bridge daemon --workspace /path/to/project
```

On ready, writes to stderr:

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

The daemon can be started explicitly before an agent session (for pre-warming), or will be auto-spawned by `serve` if none is running.

### `light-bridge serve`

Starts the MCP server over stdio for an agent session. Connects to the running daemon for the workspace (auto-spawning it if necessary), then accepts tool calls from the agent.

```bash
light-bridge serve --workspace /path/to/project
```

On ready, writes to stderr:

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

On validation error (e.g., workspace not found), writes to stdout and exits with status 1:

```json
{ "ok": false, "error": "VALIDATION_ERROR", "message": "..." }
```

If the daemon is still initialising when a tool call arrives, `serve` responds immediately with:

```json
{ "ok": false, "error": "DAEMON_STARTING", "message": "Engine is initialising, retry shortly" }
```

The agent is responsible for retrying. `serve` does not buffer or queue tool calls.

### `light-bridge rename`

Rename a symbol at a given position and update all references project-wide.

```bash
light-bridge rename --file src/utils.ts --line 5 --col 10 --newName calculateTotal
```

### `light-bridge move`

Move a file and update all import paths that reference it.

```bash
light-bridge move --oldPath src/utils/helpers.ts --newPath src/lib/helpers.ts
```

## Shutdown

`serve` shuts down cleanly on SIGTERM — this ends the agent session but does not stop the daemon. The daemon shuts down cleanly on SIGTERM and can also be stopped by the developer's process manager.

## Characteristics

- **`rename` / `move` are stateless** — each invocation builds a fresh project snapshot. No hot memory. Acceptable for one-off use; not optimised for repeated calls.
- **`daemon` is stateful** — owns the long-lived project graph and file watcher. Shared across all `serve` instances for the same workspace.
- **`serve` is a thin client** — no engine logic; connects to the daemon and adapts the MCP protocol.
- **Primary binary** — the CLI is how both the daemon and the MCP server are started. It is a permanent part of the product, not scaffolding.
- **Secondary interface** — MCP is the primary agent-facing surface. The CLI is for human use, scripting, and CI.

## Output

All commands return JSON to stdout, consistent with the MCP response contract.

## Extensibility

Additional operations are added as new subcommands as the engine surface grows.

## Out of scope

- Interactive/TUI mode
- Config file (workspace root is always passed as a flag)
