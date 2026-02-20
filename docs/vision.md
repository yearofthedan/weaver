# light-bridge — Product Vision

## What it is

light-bridge is a refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

AI agents can read and write files, but cross-file refactoring is expensive for them. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. It is slow, token-heavy, and error-prone.

light-bridge removes that burden. An agent issues an intent — rename this symbol, move this file — and light-bridge handles the cascade using the same compiler intelligence that powers IDE tooling. The agent gets back a semantic summary of what changed. It never needs to see the raw diffs.

The analogy: IntelliSense does for human developers what light-bridge does for agents. A developer _could_ manually find and update every reference. IntelliSense makes that unnecessary. light-bridge is the same capability, surfaced as an agent tool.

## How it connects

light-bridge has two layers:

**Daemon** — a long-lived background process that loads the project graph into memory and watches the filesystem for changes. The daemon stays alive between agent sessions so the engine is always warm. It is launched explicitly by the developer, or auto-spawned on demand when an agent session starts.

**MCP server** (`light-bridge serve`) — a thin process started by the agent host (e.g. Claude, Cursor) for each session. It connects to the running daemon via a local socket, receives tool calls from the agent over stdio, and forwards them to the daemon. If the daemon is still starting, it rejects tool calls immediately with a `DAEMON_STARTING` error so the agent can retry rather than receiving stale results.

The CLI also supports one-off operations directly from the shell, for scripting and manual use. These are stateless — each invocation builds a fresh project snapshot.

## What it does

- **Rename symbol** — rename any TypeScript or Vue symbol at a given file position and update all references project-wide, including across `.ts` and `.vue` file boundaries
- **Move file** — move a file to a new path and update all import statements that reference it

Supported file types: `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`

## What it returns

Every operation returns a JSON summary:

```json
{
  "ok": true,
  "filesModified": ["src/components/Button.vue", "src/App.vue"],
  "message": "Renamed 'Button' to 'BaseButton' in 2 files"
}
```

The agent receives confirmation of what changed and where. It does not need to inspect the modified files. Its context window stays clean.

## Features — priority tiers

### Now (exists or in active development)

- CLI interface: `rename`, `move`, `serve` (scaffolded)
- TypeScript engine via ts-morph
- Vue SFC engine via Volar
- Unit tests for engine layer
- Integration tests for CLI operations
- Zod-validated input
- JSON semantic output

### Next

- Daemon process — long-lived engine host with filesystem watcher
- MCP server transport — `serve` as a thin client connecting to the daemon over a local socket, implementing the stdio MCP message loop

### Later

- Additional operations (e.g. extract, inline, move symbol)
- Multi-workspace support
- Post-operation diagnostics — surface type errors on affected files so the agent doesn't need to run a separate lint step
- Post-operation hook system — register scripts (e.g. tests) against the server that run after successful operations and return results in the response

### Unknowns / open questions

- Conflict detection before applying a rename (naming collisions)
