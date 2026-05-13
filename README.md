# weaver

A refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

AI agents can read and write files, but struggle with cross-file structural changes. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. **Weaver** removes that burden. The agent issues an intent, weaver handles the cascade using deterministic compiler-driven resolution, and the agent gets back a semantic summary without ever seeing the raw diffs.

**[Why weaver?](docs/why.md)** — the thesis: speed, determinism, context efficiency.

## Install

```bash
pnpm add -D @yearofthedan/weaver
# or
npm install -D @yearofthedan/weaver
```

Requires Node.js 18+. Supports `.ts`, `.tsx`, `.js`, `.jsx`, and `.vue` (Vue support requires Volar; auto-detected).

## Try it

Rename a symbol everywhere it's used — including across `.vue` files — in one call:

```bash
npx @yearofthedan/weaver rename '{"file": "src/utils.ts", "line": 10, "col": 5, "newName": "calculateTotal"}'
```

Response (stdout):

```json
{
  "status": "success",
  "filesModified": ["src/utils.ts", "src/main.ts", "src/components/Total.vue"],
  "filesSkipped": []
}
```

The first call auto-spawns a daemon for the workspace and warms it. Subsequent calls reuse the warm daemon.

## Commands

Full per-command reference: [`docs/commands/`](docs/commands/). Common shape: each command takes a JSON argument (or stdin), returns JSON, and is also exposed as an MCP tool with the same arguments under the `camelCase` form (`move-file` ↔ `moveFile`).

| Category | Commands |
| --- | --- |
| Refactor | [`rename`](docs/commands/rename.md) · [`move-file`](docs/commands/move-file.md) · [`move-directory`](docs/commands/move-directory.md) · [`move-symbol`](docs/commands/move-symbol.md) · [`delete-file`](docs/commands/delete-file.md) · [`extract-function`](docs/commands/extract-function.md) |
| Inspect | [`find-references`](docs/commands/find-references.md) · [`find-importers`](docs/commands/find-importers.md) · [`get-definition`](docs/commands/get-definition.md) · [`get-type-errors`](docs/commands/get-type-errors.md) |
| Search | [`search-text`](docs/commands/search-text.md) · [`replace-text`](docs/commands/replace-text.md) |
| Lifecycle | [`daemon`](docs/commands/daemon.md) · [`serve`](docs/commands/serve.md) · [`stop`](docs/commands/stop.md) |

Shared conventions: [response format](docs/reference/response-format.md) · [error codes](docs/reference/error-codes.md).

## Agent integration

### CLI (recommended)

Any agent with shell access can call weaver directly. Install as a dev dependency, then invoke any command with a single JSON argument:

```bash
npx @yearofthedan/weaver move-file '{"oldPath": "src/old.ts", "newPath": "src/new.ts"}'
```

The daemon auto-spawns on the first call and stays warm for subsequent operations.

### MCP

For agent hosts that support the Model Context Protocol, weaver exposes the same operations via `weaver serve`. Add a `.mcp.json`:

```json
{
  "mcpServers": {
    "weaver": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yearofthedan/weaver", "serve", "--workspace", "."]
    }
  }
}
```

See [`docs/commands/serve.md`](docs/commands/serve.md) for portable-config notes.

### Skills

Weaver ships skill files that teach agents *when* to reach for each operation. Install with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add yearofthedan/weaver
```

Or reference manually from your agent's configuration (e.g. `CLAUDE.md`):

```markdown
## Refactoring
see `node_modules/@yearofthedan/weaver/.claude/skills/refactor`
see `node_modules/@yearofthedan/weaver/.claude/skills/code-inspection`
see `node_modules/@yearofthedan/weaver/.claude/skills/search-and-replace`
```

## Architecture

Three pieces, kept apart on purpose:

- **Daemon** — long-lived process that loads the project graph, watches for file changes, and stays warm between agent sessions.
- **CLI** — primary interface. Subcommands auto-spawn the daemon if needed and return JSON to stdout.
- **MCP server** — thin stdio bridge (`weaver serve`) that connects to the daemon for hosts supporting MCP.

Deeper detail in [`docs/architecture.md`](docs/architecture.md) and [`docs/internals/`](docs/internals/).

## Documentation

- [`docs/`](docs/README.md) — full doc index by role.
- [`docs/why.md`](docs/why.md) — what weaver is and why.
- [`docs/commands/`](docs/commands/) — per-command reference.
- [`docs/internals/`](docs/internals/) — implementation details and design decisions.
- [`docs/architecture.md`](docs/architecture.md) — provider/operation/dispatcher design.

## Security

To report a vulnerability, see [`SECURITY.md`](SECURITY.md). Threat model and controls are in [`docs/security.md`](docs/security.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
