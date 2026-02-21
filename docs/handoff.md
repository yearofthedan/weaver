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

**50/50 tests passing.** `rename` and `move` are fully implemented and tested. The daemon is implemented and tested. `serve` auto-discovers and auto-spawns the daemon. The MCP message loop is not yet implemented — no messages flow between `serve` and `daemon` yet.

**Next things to build, in order:**

1. **MCP transport** — see `docs/features/mcp-transport.md`
2. **Engine refactor** — see `docs/tech/tech-debt.md`

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer to address after the MCP transport is stable.

---

## Architecture decisions

- **MCP transport uses `@modelcontextprotocol/sdk`** — the agent-facing stdio layer uses the official SDK (not yet installed). It handles the Content-Length framing and JSON-RPC lifecycle. The internal daemon↔serve socket uses plain newline-delimited JSON, no library needed.
- **Vertical slice testing** — each MCP operation (move, rename) is tested end-to-end through all layers: write a valid MCP message to `serve` stdin, assert the stdout response and that files changed on disk. Daemon message parsing is covered implicitly by these tests, not in isolation.
