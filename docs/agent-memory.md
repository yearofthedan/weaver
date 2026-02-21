# Agent Memory

Durable notes for AI agents working on this project. Update when sessions surface new gotchas or decisions.

---

## Technical gotchas

**`child.pid` is the tsx wrapper PID, not the script's PID.**
When you spawn a process with `spawn('tsx', ...)`, `child.pid` is the PID of the tsx wrapper, not `process.pid` inside the script. To check if a lockfile PID is alive, use `process.kill(pid, 0)` — don't compare to `child.pid`.

**Invalidate the engine cache after `moveFile`.**
ts-morph and Volar both cache project state. After calling `moveFile`, the old path may still resolve from cache, causing move-back (rename to original name) to fail. Explicitly invalidate/refresh the project after a move.

**MCP server must start before the daemon auto-spawns.**
In `serve`, bring the MCP server up before triggering daemon auto-spawn. If the daemon starts first and the socket connect happens before the MCP server is listening, the call times out.

**Test race: daemon socket not yet open when test connects.**
After spawning the daemon process, the socket file may not exist yet. Use `waitForDaemon` (or equivalent retry logic) before sending the first socket request in tests.

**`dist/` and other build dirs must be excluded from `readDirectory`.**
The Vue engine calls `ts.sys.readDirectory()` to find `.vue` files. Without filtering, it picks up files under `dist/`, `node_modules/`, etc., which breaks type resolution. `SKIP_DIRS` is exported from `vue-scan.ts` and applied in `buildService()`.

---

## Architecture decisions

**MCP transport uses `@modelcontextprotocol/sdk`.**
The agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`). The internal daemon↔serve socket uses plain newline-delimited JSON — no library needed.

**SDK wire format is newline-delimited JSON, not Content-Length framed.**
`StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` in `tests/helpers.ts` must match this format.

**SDK is Zod v3/v4 agnostic.**
The SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool` — no version conflict.

**Daemon socket: one connection per call.**
`serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, then closes. No persistent connection.

**`callDaemon` failure returns `DAEMON_STARTING`.**
If the socket connection fails (daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent rather than throwing.

**Vertical slice tests assert before and after.**
Always read fixture files before the operation to confirm original state, then assert both that the old string is gone and the new string is present. This catches false positives.

---

## Key files

| File | Purpose |
|------|---------|
| `src/daemon/paths.ts` | Socket and lockfile path utilities |
| `src/commands/daemon.ts` | Daemon process |
| `src/commands/serve.ts` | MCP server (connects to daemon) |
| `tests/helpers.ts` | `spawnAndWaitForReady`, `McpTestClient`, `killDaemon` |
| `docs/tech/volar-v3.md` | How the Vue engine works — read before touching `vue-engine.ts` |
| `docs/tech/tech-debt.md` | Known structural issues in the engine layer |

---

## Session storage rule

Store notes here (or in `docs/`) — not in `~/.claude/`. This project runs in a dev container; the home directory is ephemeral.
