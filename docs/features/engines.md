# Feature: Engines

## What they are

Engines are the language-specific layer that execute refactoring and lookup operations against the project. passed-on delegates all code intelligence to the engines — it does not own or manage the AST directly.

## Current engines

- **TypeScript engine** — powered by ts-morph. Used for pure TypeScript projects (no `.vue` files).
- **Vue engine** — powered by Volar. Used for any project containing `.vue` files, regardless of the starting file's extension. Volar creates a unified TypeScript program covering both `.ts` and `.vue` files, so cross-boundary renames are handled correctly.

## Operations

### Refactoring (mutating)
- `rename` — rename a symbol at a given position and update all references project-wide
- `move` — move a file and update all import paths that reference it

### Lookup (read-only)
- Planned for a later tier — e.g. find references, go to definition, list symbols
- These give the agent information without consuming file content in its context window

## Extensibility

The operation surface is intentionally small to start. Rename and move are the most complex and highest-value operations. The engine interface should be designed to accommodate additional operations without structural changes.

## Out of scope (for now)

- Operations beyond rename and move
- Lookup tools

## Known bugs

- **Router dispatches on file extension, not project type** — renaming a symbol in a `.ts` file that is imported by `.vue` files is incorrectly routed to the TypeScript engine, which is blind to Vue SFCs. Vue usages are silently missed. Fix: detect project type at startup and route all operations through VueEngine when `.vue` files are present.
