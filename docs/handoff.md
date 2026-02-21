# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

Read the docs in this order:
1. `docs/vision.md` — what this is and where it's going
2. `docs/features/daemon.md` — understand the daemon before touching `serve`
3. `docs/features/mcp-transport.md` — how `serve` connects to the daemon
4. `docs/features/engines.md` — understand the engine boundary before touching anything
5. `docs/quality.md` — testing and reliability expectations

---

## Current state

**52/52 tests passing.** MCP transport is complete. The daemon handles `rename` and `move` socket requests, `serve` exposes both as MCP tools, and both are tested end-to-end.

**Demo support is done:** `pnpm smoke-test` runs a CLI smoke test (11 checks, rename + move). The README has a Mermaid architecture diagram and a new "Agent integration" section with Claude Code and Roo config snippets.

**dist/ exclusion status:**
- TsEngine: safe — ts-morph is initialized from `tsconfig.json` which excludes `dist/`
- VueEngine: gap — `ts.sys.readDirectory()` bypasses tsconfig excludes when discovering `.vue` files; dist/ Vue files would be included in the language service. `vue-scan.ts` correctly excludes dist/ in the post-move import rewrite step, but the language service phase is exposed.

**Next things to build, in order:**

1. **Bug** investigate the bug when dogfooding where the move works and updates imports but the move back didn't update imports (maybe the state is out of date after the first run)
2. **Bug (VueEngine)** filter dist/ (and other build dirs) from `ts.sys.readDirectory()` results in `buildService()` — use the same skip-list as `vue-scan.ts`
3. **Audit code** — check for unrequired code that may have lingered, unneeded features, consider removing CLI commands, identify tech debt
4. **Hardening** - Renovate, pinned packages
5. **Security controls** - eg. restrict editing to the workspace
6. **Engine refactor** — see `docs/tech/tech-debt.md`

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer to address after the MCP transport is stable.

---

## Architecture decisions

- **MCP transport uses `@modelcontextprotocol/sdk`** — the agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`, now installed). The internal daemon↔serve socket uses plain newline-delimited JSON, no library needed.
- **SDK wire format is newline-delimited JSON — NOT Content-Length framed** — `StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` must match this format. (Common docs describe the LSP-style Content-Length framing, but this SDK version 1.26.0 uses newlines.)
- **SDK is Zod v3/v4 agnostic** — the SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool`. No version conflict.
- **Daemon socket: one connection per call** — `serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, closes. Simple; Unix sockets are fast.
- **`callDaemon` error → `DAEMON_STARTING`** — if the socket connection fails (e.g. daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent.
- **Test helper: `McpTestClient`** — a small class in `tests/helpers.ts` that handles newline-delimited framing and the initialize handshake. Keeps test bodies clean.
- **`spawnAndWaitForReady` takes `{ pipeStdin: true }`** — required for MCP tests that need to write to the process's stdin.
- **Vertical slice tests assert before and after** — always read the fixture files before the operation to confirm the original state, then assert both the old string is gone and the new string is present. Avoids false-positive tests.
- **Vertical slice testing** — each MCP operation (rename, move) is tested end-to-end through all layers: spawn `serve`, write a valid MCP message to its stdin, assert the stdout response and that files changed on disk. Daemon message parsing is covered implicitly by these tests, not in isolation.
