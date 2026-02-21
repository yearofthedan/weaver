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

**55/55 tests passing.** MCP transport is complete. The daemon handles `rename` and `move` socket requests, `serve` exposes both as MCP tools, and both are tested end-to-end.

**Next things to build, in order:**

1. **Source restructure** — audit complete; decisions made (see below). Restructure `src/` to reflect domain boundaries.
2. **Hardening** — Renovate, pinned packages
3. **Security controls** — e.g. restrict editing to the workspace
4. **Engine refactor** — see `docs/tech/tech-debt.md`

---

## Source restructure (next task)

Audit is done and decisions are made. Implement as a sequence of small commits — each move or deletion can be its own commit so history stays readable.

### Target layout

```
src/
  cli.ts          ← registers only: daemon, serve
  schema.ts       ← stays at root; shared validation contract for all transports
  daemon/
    daemon.ts     ← moved from commands/daemon.ts
    paths.ts      ← already here
    router.ts     ← moved from src/router.ts (only daemon uses it once CLI is gone)
  mcp/
    serve.ts      ← moved from commands/serve.ts
  engines/
    types.ts
    ts-engine.ts
    vue-engine.ts
    vue-scan.ts   ← moved from src/vue-scan.ts
    project.ts    ← moved from src/project.ts
```

### What gets deleted

- `src/commands/rename.ts` — CLI command, removed entirely
- `src/commands/move.ts` — CLI command, removed entirely
- `src/commands/` folder — empty once daemon.ts and serve.ts are moved
- `src/output.ts` — only used by the deleted CLI commands
- `src/router.ts` — absorbed into `src/daemon/router.ts`
- `src/vue-scan.ts` — moved to `src/engines/vue-scan.ts`
- `src/project.ts` — moved to `src/engines/project.ts`

### Why remove the CLI commands

`rename` and `move` CLI commands are a cold-start, stateless path that duplicates the daemon's dispatch logic (including message formatting and pluralisation). The primary interface for agents is MCP via `serve`. Removing them eliminates a whole category of parity-drift as new operations are added.

### Why `router.ts` moves to `daemon/`

Once CLI commands are gone, `getEngine` is only called from `daemon.ts`. Engine selection and singleton caching is daemon infrastructure — the daemon owns the engine for its workspace lifetime.

### Why `vue-scan.ts` and `project.ts` move to `engines/`

Both are engine infrastructure:
- `project.ts` — tsconfig discovery used only by the engines and the (now-daemon-resident) router
- `vue-scan.ts` — Vue-specific post-move import rewriting; `SKIP_DIRS` is consumed by `vue-engine.ts`

### Tests to update

The test tree already partially uses domain folders (`tests/daemon/`, `tests/mcp/`). After the restructure:
- Delete `tests/rename.test.ts` and `tests/move.test.ts` (cover deleted CLI commands)
- Delete `tests/vue.test.ts` if its coverage is already provided by `tests/engines/vue-engine.test.ts` — check before deleting
- Verify all remaining tests pass after each move; no fixture changes expected

### Coverage gate

`@vitest/coverage-v8` is not yet installed. Before starting the restructure:

1. Install `@vitest/coverage-v8` and add a `pnpm coverage` script — do this as its own commit
2. Record the baseline coverage for the files that will survive the restructure
3. During the restructure, gate each commit on `pnpm test` passing — not coverage, because deleting the CLI commands and their tests together will legitimately reduce total covered lines (false alarm)
4. After the restructure is complete, run coverage again and verify the surviving files haven't regressed from their baseline

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer to address after the MCP transport is stable.

---

## Architecture decisions

- **MCP transport uses `@modelcontextprotocol/sdk`** — the agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`). The internal daemon↔serve socket uses plain newline-delimited JSON, no library needed.
- **SDK wire format is newline-delimited JSON — NOT Content-Length framed** — `StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` must match this format.
- **SDK is Zod v3/v4 agnostic** — the SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool`. No version conflict.
- **Daemon socket: one connection per call** — `serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, closes.
- **`callDaemon` error → `DAEMON_STARTING`** — if the socket connection fails (e.g. daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent.
- **Test helper: `McpTestClient`** — a small class in `tests/helpers.ts` that handles newline-delimited framing and the initialize handshake. Keeps test bodies clean.
- **`spawnAndWaitForReady` takes `{ pipeStdin: true }`** — required for MCP tests that need to write to the process's stdin.
- **Vertical slice tests assert before and after** — always read the fixture files before the operation to confirm the original state, then assert both the old string is gone and the new string is present. Avoids false-positive tests.
