# serve

Start the MCP stdio server for an agent session. Connects to the running daemon for the workspace (auto-spawning it if needed), accepts MCP tool calls from the host (Claude, Cursor, etc.), and forwards them to the daemon.

## When to use

- Wired into an agent host's MCP config — the host launches it at session start.

You don't normally invoke `weaver serve` from a terminal. The agent host does.

## Synopsis

```bash
weaver serve --workspace /path/to/project
```

## Flags

| Flag | Required | Description |
| --- | --- | --- |
| `--workspace <path>` | yes | Workspace root. Absolute or relative to the agent host's cwd. |

## Output

On ready (stderr):

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

On validation error (stdout, exit 1):

```json
{ "ok": false, "error": "VALIDATION_ERROR", "message": "..." }
```

If the daemon is still initialising when a tool call arrives:

```json
{ "ok": false, "error": "DAEMON_STARTING", "message": "Engine is initialising, retry shortly" }
```

The agent retries; `serve` does not buffer or queue tool calls.

## Behavior

- Auto-spawns a [`daemon`](./daemon.md) if none is running for the workspace.
- Shuts down cleanly on SIGTERM — ends the agent session, leaves the daemon alive.
- Wire format: newline-delimited JSON over stdio (`@modelcontextprotocol/sdk`'s `StdioServerTransport`).

## Example MCP config

Repo-committed `.mcp.json`:

```json
{
  "mcpServers": {
    "weaver": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yearofthedan/weaver", "serve", "--workspace", "."]
    }
  }
}
```

Use `--workspace .` so the same config works across checkout roots. Keep host-specific absolute paths in user-level MCP settings.

→ Internals: [docs/internals/mcp-transport.md](../internals/mcp-transport.md)
