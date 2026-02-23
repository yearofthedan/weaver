# Features

Reference documentation for light-bridge operations and infrastructure.

## Operations

All operations are invoked through the MCP server (`light-bridge serve`). There are no direct CLI subcommands for refactoring operations.

| Operation | Doc | TS | Vue | Mutating |
|-----------|-----|----|----|---------|
| `rename` | [rename.md](./rename.md) | ✓ | ✓ | yes |
| `moveFile` | [moveFile.md](./moveFile.md) | ✓ | ✓ | yes |
| `moveSymbol` | [moveSymbol.md](./moveSymbol.md) | ✓ | — | yes |
| `findReferences` | [findReferences.md](./findReferences.md) | ✓ | ✓ | no |
| `getDefinition` | [getDefinition.md](./getDefinition.md) | ✓ | ✓ | no |

`moveSymbol` returns `NOT_SUPPORTED` for Vue projects (any workspace containing `.vue` files). This is a dispatcher routing constraint, not a Volar limitation. See [moveSymbol.md](./moveSymbol.md).

## Supported file types summary

Supported file extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`

`.js` and `.jsx` are supported when the project's `tsconfig.json` includes `allowJs: true`. Without it, those files are not part of the project graph and references inside them will not be updated.

`.vue` support requires Volar. The daemon automatically selects the Vue engine for any workspace that contains `.vue` files (detected via `isVueProject()` at first request).

Cross-type reference tracking (e.g. a rename in a `.ts` file updates references in `.vue` files) is handled by the Vue engine — Volar models the full project graph including both `.ts` and `.vue` files.

## Infrastructure

| Doc | Purpose |
|-----|---------|
| [cli.md](./cli.md) | CLI commands: `daemon` and `serve` |
| [daemon.md](./daemon.md) | The long-lived engine host: lifecycle, discovery, auto-spawn |
| [mcp-transport.md](./mcp-transport.md) | MCP wire protocol, tool interface, response contract |
| [engines.md](./engines.md) | Engine architecture: TS vs Vue, provider/engine separation, dispatch |

## Other docs

| Doc | Purpose |
|-----|---------|
| `docs/vision.md` | What's shipped and what comes next |
| `docs/handoff.md` | Next work, architecture decisions, technical context |
| `docs/security.md` | Threat model, controls, known limitations |
| `docs/agent-memory.md` | Technical gotchas and implementation decisions for agents |
| `docs/tech/volar-v3.md` | Vue engine internals — read before touching `src/engines/vue/` |
| `docs/tech/tech-debt.md` | Known structural issues |
| `docs/quality.md` | Testing strategy, performance targets, reliability expectations |
