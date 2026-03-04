# Feature: CLI

**Purpose:** CLI command reference for users and scripting.

## What it is

The CLI is the primary binary for light-bridge. It has three subcommands:

- `daemon` — start the long-lived engine host
- `serve` — start an MCP server session for an agent
- `stop` — stop a running daemon for a workspace

All refactoring operations (`rename`, `moveFile`, `moveSymbol`, `findReferences`, `getDefinition`, `searchText`, `replaceText`) are exposed through the MCP server — not as direct CLI subcommands. The CLI is how the daemon is managed and how the MCP server is started; MCP tools are how operations are invoked.

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

### `light-bridge stop`

Stops a running daemon process for a workspace.

```bash
light-bridge stop --workspace /path/to/project
```

Success response (stdout):

```json
{ "ok": true, "stopped": true }
```

If no daemon is running for that workspace:

```json
{ "ok": true, "stopped": false, "message": "No daemon running for this workspace" }
```

## Shutdown

`serve` shuts down cleanly on SIGTERM — this ends the agent session but does not stop the daemon. The daemon shuts down cleanly on SIGTERM and can be stopped via `light-bridge stop` or your process manager.

## Characteristics

- **`daemon` is stateful** — owns the long-lived project graph. Shared across all `serve` instances for the same workspace.
- **`serve` is a thin client** — no engine logic; connects to the daemon and adapts the MCP protocol.
- **`stop` is lifecycle management** — sends SIGTERM to the workspace daemon and cleans up lock/socket files.
- All three commands take `--workspace` as a required flag. The value can be absolute or relative (resolved from the process working directory), which enables portable repo configs to pass `--workspace .`.
- No config file.

## Output

`daemon` and `serve` write a JSON ready signal to stderr on startup. `stop` writes JSON status to stdout. MCP tool responses go to stdout as part of the MCP protocol.

## Out of scope

- Direct CLI invocation of refactoring operations (rename, moveFile, etc.) — use `serve` + an MCP client
- Interactive/TUI mode
- Config file

## Implementation notes

**Keep committed `.mcp.json` path-portable; put machine-local paths in user-level config.**
Hardcoded workspace roots in the repo config (e.g. `/workspace/...` or `/workspaces/...`) break MCP startup on other hosts. Keep the committed config root-relative (`--workspace .`), and store machine-specific absolute-path overrides in user-level MCP settings (`claude mcp add ...`) rather than version-controlled files.

**`npx` is the most portable MCP config option when path resolution fails.**
Users report that `command: "npx"` with `args: ["-y", "@yearofthedan/light-bridge", "serve", "--workspace", "."]` avoids path resolution problems. The MCP host may spawn the process from a different working directory, so `light-bridge` from `node_modules/.bin` can fail to resolve. npx handles finding the package regardless of cwd.

**`pnpm agent:check` for policy, `pnpm agent:doctor` for runtime setup.**
`agent:check` is a static conventions check (safe for CI): validates committed MCP config shape and portability policy. `agent:doctor` is a local runtime liveness check (spawn + initialize + tools/list) and should be run during environment setup/debugging, not on every push.
