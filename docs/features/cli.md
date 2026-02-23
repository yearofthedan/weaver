# Feature: CLI

**Purpose:** CLI command reference for users and scripting.

## What it is

The CLI is the primary binary for light-bridge. It has two subcommands: `daemon` (start the long-lived engine host) and `serve` (start an MCP server session for an agent).

All refactoring operations (`rename`, `moveFile`, `moveSymbol`, `findReferences`, `getDefinition`) are exposed through the MCP server — not as direct CLI subcommands. The CLI is how both the daemon and the MCP server are started; the MCP tools are how operations are invoked.

## Commands

### `light-bridge daemon`

Starts the long-lived daemon process for a workspace. Loads the project graph into memory and listens on a local Unix socket for connections from `serve` instances.

```bash
light-bridge daemon --workspace /path/to/project
```

On ready, writes to stderr:

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

The daemon can be started explicitly before an agent session (for pre-warming), or will be auto-spawned by `serve` if none is running.

### `light-bridge serve`

Starts the MCP server over stdio for an agent session. Connects to the running daemon for the workspace (auto-spawning it if necessary), then accepts tool calls from the agent host (e.g. Claude, Cursor).

```bash
light-bridge serve --workspace /path/to/project
```

On ready, writes to stderr:

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

On validation error (e.g. workspace not found), writes to stdout and exits with status 1:

```json
{ "ok": false, "error": "VALIDATION_ERROR", "message": "..." }
```

If the daemon is still initialising when a tool call arrives, `serve` responds immediately with:

```json
{ "ok": false, "error": "DAEMON_STARTING", "message": "Engine is initialising, retry shortly" }
```

The agent is responsible for retrying. `serve` does not buffer or queue tool calls.

## Shutdown

`serve` shuts down cleanly on SIGTERM — this ends the agent session but does not stop the daemon. The daemon shuts down cleanly on SIGTERM and can also be stopped by the developer's process manager.

## Characteristics

- **`daemon` is stateful** — owns the long-lived project graph. Shared across all `serve` instances for the same workspace.
- **`serve` is a thin client** — no engine logic; connects to the daemon and adapts the MCP protocol.
- Both commands take `--workspace` as a required flag. No config file.

## Output

Both commands write a JSON ready signal to stderr on startup. All MCP tool responses go to stdout as part of the MCP protocol.

## Out of scope

- Direct CLI invocation of refactoring operations (rename, moveFile, etc.) — use `serve` + an MCP client
- Interactive/TUI mode
- Config file
