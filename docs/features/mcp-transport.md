# Feature: MCP Transport

**Purpose:** How `serve` connects to the daemon, what the wire protocol looks like, and how tool calls flow end to end.

## How it works

```
agent host (Claude, Cursor, …)
  │  stdio (MCP protocol via @modelcontextprotocol/sdk)
  ▼
light-bridge serve --workspace /path
  │  Unix socket — newline-delimited JSON, one connection per call
  ▼
light-bridge daemon --workspace /path
  │
  ▼
provider layer (TsProvider or VolarProvider)
```

1. `light-bridge serve --workspace <path>` is launched by the agent host at session start.
2. `serve` locates the running daemon for the workspace, or auto-spawns one if none exists.
3. Agent tool calls arrive over stdio, are forwarded to the daemon via a Unix socket, and responses are returned.
4. If the daemon is still initialising, `serve` rejects the tool call immediately with `DAEMON_STARTING` — the agent retries; there is no buffering.
5. `serve` shuts down when the agent session ends; the daemon continues running.

## Portable MCP config pattern

For repo-committed `.mcp.json`, use a workspace-relative launch command so the same config works in different checkout roots:

```json
{
  "mcpServers": {
    "light-bridge": {
      "type": "stdio",
      "command": "light-bridge",
      "args": ["serve", "--workspace", "."]
    }
  }
}
```

This avoids host-specific absolute paths such as `/workspace/...` or `/workspaces/...`.
Keep machine-specific absolute paths in user-level MCP settings (for example via `claude mcp add ...`) rather than the committed project config.
Use `pnpm agent:check` to enforce this policy in committed files. Use `pnpm agent:doctor` only for local runtime setup smoke checks.

## Tool interface

All tools use position-based parameters where applicable, consistent with LSP convention. Parameters are Zod-validated at the MCP layer before reaching the daemon.

| Tool | Parameters |
|------|-----------|
| `rename` | `file`, `line`, `col`, `newName`, `checkTypeErrors?` |
| `moveFile` | `oldPath`, `newPath`, `checkTypeErrors?` |
| `moveSymbol` | `sourceFile`, `symbolName`, `destFile`, `checkTypeErrors?` |
| `extractFunction` | `file`, `startLine`, `startCol`, `endLine`, `endCol`, `functionName`, `checkTypeErrors?` |
| `findReferences` | `file`, `line`, `col` |
| `getDefinition` | `file`, `line`, `col` |
| `searchText` | `pattern`, `glob?`, `context?`, `maxResults?` |
| `replaceText` | `pattern` + `replacement` + `glob?` (pattern mode) or `edits[]` (surgical mode); `checkTypeErrors?` |

`checkTypeErrors` (optional boolean, default `true`): type diagnostics are run against `filesModified` immediately after every write and returned as `typeErrors`, `typeErrorCount`, `typeErrorsTruncated`. Pass `false` to suppress. Same cap and shape as standalone `getTypeErrors`. TS/TSX files only; `.vue` files in `filesModified` are silently skipped.

## Response contract

Every tool call returns a JSON object. The agent acts on the response without reading any modified files.

Mutating operations (success):

```json
{
  "ok": true,
  "filesModified": ["src/components/Button.vue", "src/App.vue"],
  "filesSkipped": []
}
```

Read-only operations (success):

```json
{
  "ok": true,
  "symbolName": "Button",
  "references": [
    { "file": "src/App.vue", "line": 5, "col": 3, "length": 6 }
  ]
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

Error codes include: `DAEMON_STARTING`, `INTERNAL_ERROR`, `VALIDATION_ERROR`, `WORKSPACE_VIOLATION`, `FILE_NOT_FOUND`, `SYMBOL_NOT_FOUND`, `RENAME_NOT_ALLOWED`, `NOT_SUPPORTED`, `SENSITIVE_FILE`, `TEXT_MISMATCH`, `PARSE_ERROR`, `REDOS`, `UNKNOWN_METHOD`.

`filesSkipped` lists collateral writes that were skipped because they fell outside the workspace boundary. Agents should surface this to the user.

## Wire protocol details

- **Agent-facing (stdio):** `@modelcontextprotocol/sdk` (`StdioServerTransport`). Wire format is newline-delimited JSON — `JSON.stringify(msg) + '\n'`. No `Content-Length` framing.
- **Internal (serve ↔ daemon):** plain newline-delimited JSON over a Unix socket. One connection per tool call — `serve` opens a fresh connection, writes one JSON line, reads one JSON line, closes.

## Data-driven tool registration

`mcp.ts` uses a `TOOLS` table to drive all `registerTool` calls. Each entry has `name`, `description`, and `inputSchema`. The loop handler passes params directly to `callDaemon` with no per-operation destructuring. Adding a new operation requires one entry in the `TOOLS` table and one in `dispatcher.ts`'s `OPERATIONS` table.

## Assumptions

- One `serve` process per agent session
- One daemon process per workspace
- Workspace root is known at startup (`--workspace` flag)
- Agent session lifetime equals `serve` process lifetime; daemon lifetime is independent

## Out of scope

- Multiple concurrent sessions — requires session isolation or engine locking
- Multi-workspace — requires multiple project instances and a routing layer
- Non-stdio transports (HTTP, SSE) — no current consumer
