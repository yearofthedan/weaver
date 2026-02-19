# Feature: CLI

## What it is

The CLI is the primary binary for passed-on. It serves two purposes: launching the MCP server process for agent sessions, and executing one-off refactoring operations directly from the shell.

## Commands

### `passed-on serve`

Starts the MCP server over stdio. This is the entry point for agent sessions.

```bash
passed-on serve --workspace /path/to/project
```

### `passed-on rename`

Rename a symbol at a given position and update all references project-wide.

```bash
passed-on rename --file src/utils.ts --line 5 --col 10 --newName calculateTotal
```

### `passed-on move`

Move a file and update all import paths that reference it.

```bash
passed-on move --oldPath src/utils/helpers.ts --newPath src/lib/helpers.ts
```

## Shutdown

The MCP server shuts down cleanly on SIGTERM. No CLI command needed — the process is managed by the agent runtime or the developer's process manager.

## Characteristics

- **Stateless** — CLI refactoring commands parse on every invocation. No hot memory. Acceptable for one-off use.
- **Primary binary** — the CLI is how the MCP server is started. It is a permanent part of the product, not scaffolding.
- **Secondary interface** — MCP is the primary agent-facing surface. The CLI is for human use, scripting, and CI.

## Output

All commands return JSON to stdout, consistent with the MCP response contract.

## Extensibility

Additional operations are added as new subcommands as the engine surface grows.

## Out of scope

- Interactive/TUI mode
- Config file (workspace root is always passed as a flag)
