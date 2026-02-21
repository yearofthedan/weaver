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

**35/35 tests passing.** Source restructure and hardening complete. CLI `rename`/`move` commands removed; MCP via `serve` is the only agent interface. The file layout now reflects domain boundaries:

```
src/
  cli.ts          ← registers only: daemon, serve
  schema.ts
  daemon/
    daemon.ts
    paths.ts
    router.ts
  engines/
    project.ts
    ts-engine.ts
    types.ts
    vue-engine.ts
    vue-scan.ts
  mcp/
    serve.ts
```

**Next things to build, in order:**

1. **Security controls** — restrict editing to the workspace, assess other missing controls
2. **Engine refactor** — see `docs/tech/tech-debt.md`
3. **Dogfooding** — update guidance to ensure we dogfood
4. **Missing operations** — brainstorm and implement what's next (see below)
---

## Missing operations (next task)

The current tool surface is just `rename` and `move`. Before adding anything, brainstorm what an AI coding agent actually needs most. Some candidates to evaluate:

- `findReferences` — locate all usages of a symbol without modifying anything; useful for impact analysis before a refactor
- `getDefinition` — jump-to-definition; lets an agent navigate to source before editing
- `extractFunction` — pull a selection into a named function, updating the call site
- `inlineVariable` / `inlineFunction` — collapse a trivially-used binding
- `deleteFile` — remove a file and clean up its imports in other files
- `createFile` — scaffolding with correct import paths inferred from location

For each candidate, consider: does the daemon's stateful engine make it meaningfully better than the agent just editing the file directly? `rename` and `move` benefit strongly because they require project-wide reference tracking. Operations with narrow blast radius (e.g. create a blank file) may not be worth the plumbing.

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer. Includes the `ensureDaemon` one-shot bug discovered during this session.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions (2.4.27 vs 2.4.28) of `@volar/language-core`, causing type mismatches that required `any` casts. Fixed via a `pnpm.overrides` entry in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `vue-engine.ts`.

---

## Architecture decisions

- **MCP transport uses `@modelcontextprotocol/sdk`** — the agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`). The internal daemon↔serve socket uses plain newline-delimited JSON, no library needed.
- **SDK wire format is newline-delimited JSON — NOT Content-Length framed** — `StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` must match this format.
- **SDK is Zod v3/v4 agnostic** — the SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool`. No version conflict.
- **Daemon socket: one connection per call** — `serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, closes.
- **`callDaemon` error → `DAEMON_STARTING`** — if the socket connection fails (e.g. daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent.
- **`ensureDaemon` fires once at startup** — if the daemon dies after `serve` starts, tool calls return `DAEMON_STARTING` permanently. See tech-debt.md for the fix.
- **Test helper: `McpTestClient`** — a small class in `tests/helpers.ts` that handles newline-delimited framing and the initialize handshake. Keeps test bodies clean.
- **`spawnAndWaitForReady` takes `{ pipeStdin: true }`** — required for MCP tests that need to write to the process's stdin.
- **Vertical slice tests assert before and after** — always read the fixture files before the operation to confirm the original state, then assert both the old string is gone and the new string is present. Avoids false-positive tests.
