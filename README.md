# light-bridge

A refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

> **Experimental.** This project is in active development. The goal is deterministic, token-reducing refactoring for AI agents through compiler-driven semantics, drawing inspiration from IDE integration patterns. Core operations are stable and tested, but some features remain incomplete or will evolve as we explore better approaches.

AI agents can read and write files, but cross-file refactoring is expensive. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. light-bridge removes that burden — the agent issues an intent, light-bridge handles the cascade, and the agent gets back a semantic summary without ever seeing the raw diffs.

## How it works

light-bridge has two layers:

**Daemon** — a long-lived process that loads the project graph into memory and watches the filesystem for changes. It stays alive between agent sessions so the engine is always warm. Start it once; it handles the rest.

**MCP server** (`light-bridge serve`) — a thin process started by the agent host for each session. It connects to the running daemon, receives tool calls from the agent over stdio, and returns semantic summaries. If no daemon is running, it spawns one automatically.

The underlying language intelligence comes from ts-morph (pure TypeScript projects) and Volar (projects containing Vue files), covering both `.ts` and `.vue` files in a unified project graph.

The agent calls tools. light-bridge applies changes. The context window stays clean.

```mermaid
flowchart TD
    A["Agent host\n(Claude Code / Roo / Cursor)"]
    B["light-bridge serve\n(MCP server, stdio)"]
    C["light-bridge daemon\n(project graph + watcher)"]
    D[ts-morph]
    E[Volar]
    F["Project files\n(.ts · .tsx · .vue)"]

    A -- "MCP tool call" --> B
    B -- "Unix socket" --> C
    C --> D & E
    D & E --> F
```

## Installation

Install from GitHub (builds automatically on install):

```bash
pnpm add -D github:yearofthedan/light-bridge
# or
npm install -D github:yearofthedan/light-bridge
```

## CLI Commands

### `light-bridge daemon`

Start the daemon for a workspace. Loads the project graph, starts the filesystem watcher, and listens for connections from `serve` instances.

```bash
light-bridge daemon --workspace /path/to/project
```

Output (stderr):

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

The daemon runs until terminated with SIGTERM or SIGINT. It does not exit when agent sessions end.

### `light-bridge serve`

Start the MCP server for an agent session. Connects to the running daemon (spawning it if needed) and accepts tool calls over stdio.

```bash
light-bridge serve --workspace /path/to/project
```

Output (stderr):

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

Terminates cleanly on SIGTERM. The daemon continues running after the session ends.

## MCP tools

All refactoring operations are exposed as MCP tools via `light-bridge serve`. The agent host calls them; light-bridge handles the cascade.

| Tool | TS | Vue | Read-only | Notes |
|---|---|---|---|---|
| `rename` | ✓ | ✓ | no | Renames a symbol at a given position; updates every reference project-wide |
| `move` | ✓ | ✓ | no | Moves a file; rewrites all import paths that reference it |
| `moveSymbol` | ✓ | — | no | Moves a named export to another file; updates all importers. Vue: `NOT_SUPPORTED` |
| `findReferences` | ✓ | ✓ | yes | Returns every reference to the symbol at a given position |

All tools take absolute paths. Write operations return `filesModified` and `filesSkipped` (files outside the workspace boundary that were not touched).

**`moveSymbol` in Vue projects** — `NOT_SUPPORTED` is a dispatcher constraint, not a Volar limitation. When both source and destination are plain `.ts` files inside a Vue project, the operation could be delegated to the TypeScript engine; this is not yet implemented.

## Response format

All operations return a JSON summary:

```json
{
  "ok": true,
  "filesModified": ["src/utils/math.ts", "src/index.ts"],
  "message": "Renamed 'calculateSum' to 'calculateTotal' in 2 files"
}
```

On failure:

```json
{
  "ok": false,
  "error": "SYMBOL_NOT_FOUND",
  "message": "Could not find symbol at line 5, column 10"
}
```

## Error codes

- `VALIDATION_ERROR` — invalid command arguments
- `FILE_NOT_FOUND` — source file does not exist
- `TSCONFIG_NOT_FOUND` — no TypeScript configuration found
- `SYMBOL_NOT_FOUND` — symbol not found at specified position
- `RENAME_NOT_ALLOWED` — symbol cannot be renamed (e.g. built-in types)
- `ENGINE_ERROR` — unexpected error during refactoring
- `DAEMON_STARTING` — daemon is still initialising; retry the tool call

## Agent integration

`light-bridge serve` is a stdio MCP server. Configure your agent host to launch it for the workspace you want to refactor.

### Claude Code

Add to `.mcp.json` in your project root (checked into version control, shared with your team):

```json
{
  "mcpServers": {
    "light-bridge": {
      "type": "stdio",
      "command": "light-bridge",
      "args": ["serve", "--workspace", "/absolute/path/to/your/project"]
    }
  }
}
```

Or use the CLI to add it to your local scope:

```bash
claude mcp add light-bridge -- light-bridge serve --workspace /absolute/path/to/your/project
```

### Roo

Open the Roo MCP settings (gear icon → MCP Servers) and add:

```json
{
  "mcpServers": {
    "light-bridge": {
      "command": "light-bridge",
      "args": ["serve", "--workspace", "/absolute/path/to/your/project"],
      "disabled": false,
      "alwaysAllow": ["rename", "move", "moveSymbol", "findReferences"]
    }
  }
}
```

### Guiding the agent (CLAUDE.md)

The MCP tool descriptions tell Claude what each tool does, but not when to reach for them. Add this to your project's `CLAUDE.md` so Claude uses light-bridge instead of manual edits:

````markdown
## Refactoring tools

light-bridge MCP tools are connected. Use them for all structural refactors:

- `mcp__light-bridge__rename` — rename any symbol and update all references (not search-and-replace)
- `mcp__light-bridge__move` — move a file and rewrite all import paths (not `mv` + manual fixes)
- `mcp__light-bridge__moveSymbol` — move a named export between files
- `mcp__light-bridge__findReferences` — find all usages of a symbol before deciding how to refactor

If a tool returns `DAEMON_STARTING`, retry once — the daemon is still loading the project graph.
Do not read files to verify results; the response lists exactly what changed.
````

### Notes

- Replace paths with absolute paths — relative paths are not supported in MCP configs.
- The daemon auto-spawns on first tool call if not already running. For faster first-call response, start it manually: `light-bridge daemon --workspace /path/to/project`.
- One `serve` instance per agent session; one daemon per workspace. The daemon keeps running between sessions.

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm run build
```

### Test

```bash
pnpm run test
```

Tests include:

- **Unit tests** — engine operations in isolation (`tests/engines/`)
- **Integration tests** — CLI operations via subprocess (`tests/rename.test.ts`, `tests/move.test.ts`, `tests/vue.test.ts`)
- **Daemon tests** — lifecycle, socket, and serve integration (`tests/daemon/`)

### Smoke test

Verify the CLI is working end-to-end without running the full test suite:

```bash
pnpm smoke-test
```

This runs `rename` and `move` against copies of the test fixtures and reports pass/fail for each check.

## Project structure

```
src/
├── cli.ts                 # CLI entry point (registers daemon, serve)
├── schema.ts              # Zod input validation
├── workspace.ts           # Workspace boundary enforcement
├── mcp.ts                 # MCP server (connects to daemon)
├── daemon/
│   ├── daemon.ts          # Socket server; daemon lifecycle
│   ├── paths.ts           # Socket/lockfile path utilities
│   └── dispatcher.ts      # Dispatches requests to engines
└── engines/
    ├── types.ts           # Shared engine types
    ├── text-utils.ts      # Shared text edit utilities
    ├── ts/
    │   ├── engine.ts      # TypeScript engine (ts-morph)
    │   └── project.ts     # tsconfig discovery utilities
    └── vue/
        ├── engine.ts      # Vue engine (Volar)
        └── scan.ts        # Post-move Vue import scan

tests/
├── engines/               # Engine unit tests
├── daemon/                # Daemon lifecycle + serve integration tests
├── rename.test.ts         # CLI integration tests (rename)
├── move.test.ts           # CLI integration tests (move)
├── move-symbol.test.ts    # CLI integration tests (moveSymbol)
├── helpers.ts             # Test utilities
└── fixtures/              # Test fixture projects
```

## License

MIT
