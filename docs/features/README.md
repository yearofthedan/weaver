# Features

Reference documentation for light-bridge operations and infrastructure.

## Operations

All operations are invoked through the MCP server (`light-bridge serve`). There are no direct CLI subcommands for refactoring operations.

| Operation | Doc | TS | Vue | Mutating |
|-----------|-----|----|-----|----------|
| `rename` | [rename.md](./rename.md) | ✓ | ✓ | yes |
| `moveFile` | [moveFile.md](./moveFile.md) | ✓ | ✓ | yes |
| `moveSymbol` | [moveSymbol.md](./moveSymbol.md) | ✓ | ✓* | yes |
| `findReferences` | [findReferences.md](./findReferences.md) | ✓ | ✓ | no |
| `getDefinition` | [getDefinition.md](./getDefinition.md) | ✓ | ✓ | no |
| `searchText` | [mcp-transport.md](./mcp-transport.md) | n/a | n/a | no |
| `replaceText` | [mcp-transport.md](./mcp-transport.md) | n/a | n/a | yes |

\* `moveSymbol` supports moving exported symbols from `.ts`/`.tsx` sources inside Vue workspaces and updates `.vue` importers in a post-step. Moving symbols from a `.vue` source file is still pending; see [moveSymbol.md](./moveSymbol.md).

## Supported file types summary

Supported file extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`

`.js` and `.jsx` are supported when the project's `tsconfig.json` includes `allowJs: true`. Without it, those files are not part of the project graph and references inside them will not be updated.

`.vue` support requires Volar. The daemon automatically selects the Vue engine for any workspace that contains `.vue` files (detected via `isVueProject()` at first request).

Cross-type reference tracking (e.g. a rename in a `.ts` file updates references in `.vue` files) is handled by the Vue engine — Volar models the full project graph including both `.ts` and `.vue` files.

## Infrastructure

| Doc | Purpose |
|-----|---------|
| [cli.md](./cli.md) | CLI commands: `daemon`, `serve`, and `stop` |
| [daemon.md](./daemon.md) | The long-lived engine host: lifecycle, discovery, auto-spawn |
| [mcp-transport.md](./mcp-transport.md) | MCP wire protocol, tool interface, response contract |
| [architecture.md](./architecture.md) | Provider/operation architecture, `ProviderRegistry`, dispatcher design |

## Other docs

| Doc | Purpose |
|-----|---------|
| `docs/vision.md` | What's shipped and what comes next |
| `docs/handoff.md` | Current state, prioritised next work, pointers to architecture docs |
| `docs/security.md` | Threat model, controls, known limitations |
| `docs/agent-memory.md` | Technical gotchas and implementation decisions for agents |
| `docs/tech/volar-v3.md` | Vue provider internals — read before touching `src/providers/volar.ts` |
| `docs/tech/tech-debt.md` | Known structural issues |
| `docs/quality.md` | Testing strategy, performance targets, reliability expectations |
