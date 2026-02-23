# Feature: Engines

**Purpose:** Architecture reference for the engine layer. Read before touching any file under `src/engines/`.

See also: `docs/tech/volar-v3.md` (Vue engine internals), `docs/tech/tech-debt.md` (known issues).

## What they are

Engines are the language-specific layer that execute refactoring and lookup operations against the project graph. light-bridge delegates all code intelligence to the engines.

## Current engines

- **TypeScript engine** (`src/engines/ts/`) — powered by ts-morph. Used for pure TypeScript projects (no `.vue` files).
- **Vue engine** (`src/engines/vue/`) — powered by Volar. Used for any project containing `.vue` files, regardless of the starting file's extension. Volar creates a unified TypeScript program covering both `.ts` and `.vue` files, so cross-boundary renames work correctly.

The dispatcher (`src/daemon/dispatcher.ts`) selects the engine per workspace via `isVueProject()` at first request. One engine instance per workspace, kept alive for the daemon's lifetime.

## Architecture

### Provider / engine separation

The engine layer has two tiers:

```
LanguageProvider  (src/engines/types.ts)
  ↑ implements
TsProvider        (src/engines/providers/ts.ts)    — ts-morph compiler calls
VolarProvider     (src/engines/providers/volar.ts) — Volar proxy + virtual↔real translation

BaseEngine        (src/engines/engine.ts)
  ↑ extends
TsEngine          (src/engines/ts/engine.ts)       — adds moveSymbol (ts-morph AST)
VueEngine         (src/engines/vue/engine.ts)      — moveSymbol stub (NOT_SUPPORTED)
```

`BaseEngine` implements the four shared operations (`rename`, `findReferences`, `getDefinition`, `moveFile`) against the `LanguageProvider` interface. Engines only need to implement `moveSymbol`.

### Data-driven dispatch

`dispatcher.ts` uses an `OPERATIONS` descriptor table. Each entry owns:
- `pathParams` — which params are file paths (first entry determines engine selection)
- `invoke` — calls the engine method
- `format` — shapes the result for the wire response

Adding a new operation is a single table entry in `dispatcher.ts` and `mcp.ts`.

## Operations

### Mutating

| Operation | TS | Vue | Entry point |
|-----------|----|----|-------------|
| `rename` | ✓ | ✓ | `BaseEngine.rename` → `LanguageProvider.findRenameLocations` |
| `move` | ✓ | ✓ | `BaseEngine.moveFile` → `LanguageProvider.getEditsForFileRename` + post-scan |
| `moveSymbol` | ✓ | — | `TsEngine.moveSymbol` (ts-morph AST); `VueEngine` throws `NOT_SUPPORTED` |

### Read-only

| Operation | TS | Vue | Entry point |
|-----------|----|----|-------------|
| `findReferences` | ✓ | ✓ | `BaseEngine.findReferences` → `LanguageProvider.getReferencesAtPosition` |
| `getDefinition` | ✓ | ✓ | `BaseEngine.getDefinition` → `LanguageProvider.getDefinitionAtPosition` |

## Shared utilities

- `src/engines/text-utils.ts` — `applyTextEdits()`, `offsetToLineCol()` — used by both engines
- `src/engines/file-walk.ts` — `walkFiles(dir, extensions)`, `SKIP_DIRS` — git-aware file collection
- `src/engines/vue/scan.ts` — `updateVueImportsAfterMove()` — regex scan for `.vue` SFC import strings; runs as a dispatcher post-step after any `move`, regardless of engine

## Workspace boundary enforcement

The engine layer enforces the workspace boundary on outputs (collateral writes). Files outside the workspace are skipped and returned in `result.filesSkipped`. See `docs/security.md` for the full picture.

Input validation happens at the dispatcher layer before the engine is called.

## Known constraint: moveSymbol in Vue projects

The dispatcher routes all files in a Vue project to `VueEngine`. `VueEngine.moveSymbol` throws `NOT_SUPPORTED` because Volar has no "extract declaration" API. This is a router constraint, not a Volar limitation — `moveSymbol` is pure AST surgery that does not need Volar. Fix path: per-operation engine selection, or delegation inside `VueEngine.moveSymbol`. Tracked in `docs/tech/tech-debt.md`.
