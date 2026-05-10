# Internals: MCP Transport

**Purpose:** How `serve` connects to the daemon, what the wire protocol looks like, and how tool calls flow end to end.

User-facing reference: [docs/commands/serve.md](../commands/serve.md), [response format](../reference/response-format.md), [error codes](../reference/error-codes.md).

## How it works

```
agent host (Claude, Cursor, …)
  │  stdio (MCP protocol via @modelcontextprotocol/sdk)
  ▼
weaver serve --workspace /path
  │  Unix socket — newline-delimited JSON, one connection per call
  ▼
weaver daemon --workspace /path
  │
  ▼
compiler layer (TsMorphCompiler or VolarCompiler)
```

1. `weaver serve --workspace <path>` is launched by the agent host at session start.
2. `serve` locates the running daemon for the workspace, or auto-spawns one if none exists.
3. Agent tool calls arrive over stdio, are forwarded to the daemon via a Unix socket, and responses are returned.
4. If the daemon is still initialising, `serve` rejects the tool call immediately with `DAEMON_STARTING` — the agent retries; there is no buffering.
5. `serve` shuts down when the agent session ends; the daemon continues running.

## Portable MCP config pattern

For repo-committed `.mcp.json`, use a workspace-relative launch command so the same config works in different checkout roots:

```json
{
  "mcpServers": {
    "weaver": {
      "type": "stdio",
      "command": "weaver",
      "args": ["serve", "--workspace", "."]
    }
  }
}
```

This avoids host-specific absolute paths such as `/workspace/...` or `/workspaces/...`.
Keep machine-specific absolute paths in user-level MCP settings (for example via `claude mcp add ...`) rather than the committed project config.
Use `pnpm agent:check` to enforce this policy in committed files. Use `pnpm agent:doctor` only for local runtime setup smoke checks.

## Tool interface

Per-tool parameters live in [docs/commands/](../commands/). Conventions shared across every tool:

- Position-based parameters use 1-based `line`/`col` (LSP convention).
- All inputs are Zod-validated at the MCP layer before reaching the daemon.
- `checkTypeErrors` (optional boolean, default `true`) on every mutating tool runs post-write diagnostics on `filesModified` and adds `typeErrors`, `typeErrorCount`, `typeErrorsTruncated` to the response. TS/TSX only — `.vue` files in `filesModified` are skipped.

## Response contract

The shape of `status`, `filesModified`, `filesSkipped`, `typeErrors`, and the error envelope is documented once in [docs/reference/response-format.md](../reference/response-format.md). The full set of error codes is in [docs/reference/error-codes.md](../reference/error-codes.md).

`filesSkipped` lists collateral writes that were skipped because they fell outside the workspace boundary. Agents should surface this to the user.

## Wire protocol details

- **Agent-facing (stdio):** `@modelcontextprotocol/sdk` (`StdioServerTransport`). Wire format is newline-delimited JSON — `JSON.stringify(msg) + '\n'`. No `Content-Length` framing.
- **Internal (serve ↔ daemon):** plain newline-delimited JSON over a Unix socket. One connection per tool call — `serve` opens a fresh connection, writes one JSON line, reads one JSON line, closes.

## Data-driven tool registration

`mcp.ts` uses a `TOOLS` table to drive all `registerTool` calls. Each entry has `name`, `description`, and `inputSchema`. The loop handler passes params directly to `callDaemon` with no per-operation destructuring. Adding a new operation requires one entry in the `TOOLS` table and one in `dispatcher.ts`'s `OPERATIONS` table.

## Implementation notes

**MCP tool names and daemon method names are intentionally 1:1.**
The MCP handler passes `tool.name` directly as the daemon method. There is no translation layer. A proposal to split naming (e.g. "file rename" vs "symbol rename") was rejected: the daemon is an internal IPC detail with no independent users, and "file rename" is already `moveFile`. Splitting would add a translation table for no benefit.

**MCP server `instructions` field for tool adoption.**
The `McpServer` constructor takes an optional `instructions` string (part of the MCP spec's `InitializeResult`). Clients like Cursor and Claude Desktop surface this as a system prompt hint. Keep it short — it's injected on every turn alongside all tool descriptions. Per-tool trigger guidance ("when to use this") belongs in individual tool descriptions, not here.

**Tool descriptions should lead with triggers, not capabilities.**
"Before modifying a symbol, call this" is more effective than "Find all references to a symbol" because it matches the agent's situation at the point of decision. Avoid naming specific agent tools (grep, shell mv, search-and-replace) — frame the consequence of not using the tool instead ("leaves broken imports", "text search would find the re-export, not the actual definition").

**`checkTypeErrors` defaults to ON — the guard is `!== false`, not `=== true`.**
Write operations (`rename`, `moveFile`, `moveSymbol`, `replaceText`) run post-write type diagnostics by default. The `checkTypeErrors` param is enabled unless explicitly set to `false`. The primary users are AI coding agents who need immediate compiler feedback after every write. `checkTypeErrors: false` is an explicit opt-out for callers that want to batch type-checking separately.

## Assumptions

- One `serve` process per agent session
- One daemon process per workspace
- Workspace root is known at startup (`--workspace` flag)
- Agent session lifetime equals `serve` process lifetime; daemon lifetime is independent

## Out of scope

- Multiple concurrent sessions — requires session isolation or engine locking
- Multi-workspace — requires multiple project instances and a routing layer
- Non-stdio transports (HTTP, SSE) — no current consumer
