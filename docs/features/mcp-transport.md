# Feature: MCP Transport

## What it does

Exposes light-bridge's refactoring tools via the Model Context Protocol over stdio, keeping the engine alive for the duration of an agent session.

## How it works

- `light-bridge serve --workspace <path>` is launched by the agent host (e.g. Claude, Cursor) at session start
- `serve` locates the running daemon for the workspace, or auto-spawns one if none exists
- The daemon owns the project graph and the file watcher — `serve` does not load the project itself
- Agent tool calls arrive over stdio, are forwarded to the daemon via a local socket, and responses are returned
- If the daemon is still initialising, `serve` rejects the tool call with `DAEMON_STARTING` — the agent retries; there is no buffering
- Server shuts down when the session ends; the daemon continues running

## Tool interface

Tools use position-based parameters, consistent with the LSP standard:

- `rename(file, line, col, newName)`
- `move(oldPath, newPath)`

## Response contract

Every tool call returns a JSON object. The agent should be able to act on the response without reading any modified files.

Success:

```json
{
  "ok": true,
  "filesModified": ["path/to/file.ts"],
  "message": "Human-readable summary of what changed"
}
```

Failure:

```json
{
  "ok": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description of the problem"
}
```

The agent receives confirmation of what changed and where. It does not need to inspect the files.

## Assumptions

- One `serve` process per agent session
- One daemon process per workspace
- Workspace root is known at startup
- Agent session lifetime equals `serve` process lifetime; daemon lifetime is independent

## Out of scope

- Multiple concurrent sessions — requires session isolation or AST locking, which is a different product
- Multi-workspace — requires multiple project instances and a routing layer; revisit once single-workspace is proven
- Non-stdio transports (HTTP, SSE) — no current consumer; revisit if the use case emerges

## Implementation notes

### MCP layer (`serve`)

Use `@modelcontextprotocol/sdk` (not yet installed) for the stdio-facing side. It handles the Content-Length framing, JSON-RPC lifecycle, and tool registration with JSON schema. Do not implement the MCP wire format manually.

### Daemon socket protocol

The internal `serve`↔`daemon` socket uses plain newline-delimited JSON — one JSON object per line, no framing library needed. Each request includes a `method` (`rename` or `move`) and params. The daemon writes a single JSON response line per request.

### Testing approach

Each operation is tested as a vertical slice through all layers: spawn `serve`, write a valid MCP tool call to its stdin, assert the MCP response on stdout and that the files changed on disk. Daemon parsing is covered implicitly.

## TBD

- Startup UX: whether the slow initial parse needs a progress signal back to the agent
- Security review (deferred)
