**Purpose:** Engineering internals for each command and shared infrastructure. Read these when extending, debugging, or refactoring.
**Audience:** Contributors and agents working on the codebase.

---

# Internals

User-facing reference is in [docs/commands/](../commands/). This directory documents how each command is implemented and why each significant decision was made.

## Per-command internals

| Command | Internals |
| :--- | :--- |
| `rename` | [rename.md](./rename.md) |
| `move-file` | [move-file.md](./move-file.md) |
| `move-directory` | [move-directory.md](./move-directory.md) |
| `move-symbol` | [move-symbol.md](./move-symbol.md) |
| `delete-file` | [delete-file.md](./delete-file.md) |
| `extract-function` | [extract-function.md](./extract-function.md) |
| `find-references` | [find-references.md](./find-references.md) |
| `find-importers` | [find-importers.md](./find-importers.md) |
| `get-definition` | [get-definition.md](./get-definition.md) |
| `get-type-errors` | [get-type-errors.md](./get-type-errors.md) |
| `search-text` | [search-text.md](./search-text.md) |
| `replace-text` | [replace-text.md](./replace-text.md) |

## Shared infrastructure

| Doc | Purpose |
| :--- | :--- |
| [daemon.md](./daemon.md) | Lifecycle, discovery, auto-spawn, request serialisation, verbose logging. |
| [watcher.md](./watcher.md) | Filesystem watcher, debouncing, invalidation strategy. |
| [mcp-transport.md](./mcp-transport.md) | MCP wire protocol, tool registration, response contract. |
| [../architecture.md](../architecture.md) | Provider/operation/dispatcher design. |

## Conventions

Each per-command page covers:

1. **How it works** — call chain from tool call to result, naming the actual modules.
2. **Technical decisions** — significant choices and the alternatives that were rejected.
3. **Implementation notes** — non-obvious gotchas a future maintainer would otherwise rediscover painfully.

User-facing constraints, parameters, and error codes belong in the matching `docs/commands/<name>.md` page, not here.

## Adding a new command

1. Add the operation in `src/operations/`, the dispatcher entry in `src/daemon/dispatcher.ts`, and the MCP tool entry in `src/mcp.ts`.
2. Create `docs/commands/<kebab-name>.md` from the structure of an existing command page.
3. Create `docs/internals/<kebab-name>.md` covering how-it-works, technical decisions, and any gotchas.
4. Add the command to `docs/commands/README.md` and `docs/internals/README.md` indexes.
5. If the command is part of an existing skill (`refactor`, `code-inspection`, `search-and-replace`), update that skill's `SKILL.md` with usage guidance.
