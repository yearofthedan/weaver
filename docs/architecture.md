# Architecture

**Purpose:** Architecture reference for providers, operations, and dispatch. Read before touching anything in `src/operations/`, `src/providers/`, or `src/daemon/dispatcher.ts`.

See also: `docs/tech/volar-v3.md` (Vue provider internals), `docs/tech/tech-debt.md` (known issues).

---

## Overview

The engine layer has two tiers: **providers** hold the stateful compiler objects, and **operations** are standalone functions that call into providers. There are no engine classes.

```
src/operations/          ← standalone action functions (one per operation)
  rename.ts
  moveFile.ts
  moveSymbol.ts
  findReferences.ts
  getDefinition.ts
  searchText.ts
  replaceText.ts

src/providers/           ← stateful compiler wrappers
  ts.ts                 ← TsProvider  — ts-morph Project; per-tsconfig cache
  volar.ts              ← VolarProvider — Volar proxy; virtual↔real translation; afterSymbolMove
  vue-scan.ts           ← updateVueImportsAfterMove, updateVueNamedImportAfterSymbolMove
  vue-service.ts        ← buildVolarService() factory
```

---

## Provider interface

Both providers implement `LanguageProvider` (defined in `src/types.ts`):

```typescript
interface LanguageProvider {
  resolveOffset(file, line, col): number
  getRenameLocations(file, offset): Promise<SpanLocation[] | null>
  getReferencesAtPosition(file, offset): Promise<SpanLocation[] | null>
  getDefinitionAtPosition(file, offset): Promise<DefinitionLocation[] | null>
  getEditsForFileRename(oldPath, newPath): Promise<FileTextEdit[]>
  readFile(path): string
  notifyFileWritten(path, content): void
  afterFileRename(oldPath, newPath, workspace): Promise<{ modified, skipped }>
  afterSymbolMove(sourceFile, symbolName, destFile, workspace): Promise<{ modified, skipped }>
}
```

`afterFileRename` and `afterSymbolMove` are post-step hooks. `TsProvider.afterSymbolMove` is a no-op — ts-morph AST edits handle TS importers directly. `VolarProvider.afterSymbolMove` scans `.vue` SFC script blocks for imports of the moved symbol and rewrites them.

---

## Provider registry

The dispatcher creates a `ProviderRegistry` per request, scoped to the project that contains the input file:

```typescript
interface ProviderRegistry {
  projectProvider(): Promise<LanguageProvider>  // VolarProvider for Vue projects, TsProvider otherwise
  tsProvider(): Promise<TsProvider>             // always TsProvider — for AST-level operations
}
```

Provider selection uses `findTsConfigForFile(inputFile)` to locate the right tsconfig, then `isVueProject(tsconfig)` to choose the provider. In a monorepo each package resolves to its own tsconfig and gets the right provider automatically. Both providers are lazy singletons at the daemon level; each manages a per-tsconfig cache internally.

---

## Operation dispatch

`src/daemon/dispatcher.ts` uses an `OPERATIONS` descriptor table. Each entry owns:

- `pathParams` — which params are file paths (first entry is used for provider selection and workspace validation)
- `schema` — Zod schema for input validation at the socket boundary
- `invoke(registry, params, workspace)` — calls the operation function with the resolved providers

```
tool call (MCP)
  → mcp.ts: TOOLS table → callDaemon(method, params)
  → daemon.ts: socket → dispatchRequest(method, params, workspace)
  → dispatcher.ts: OPERATIONS[method]
      1. validate params (schema.safeParse)
      2. validate path params against workspace boundary (isWithinWorkspace)
      3. makeRegistry(firstPathParam) → ProviderRegistry
      4. descriptor.invoke(registry, params, workspace)
      5. return { ok: true, ...result }
```

Adding a new operation requires one entry in `OPERATIONS` (dispatcher.ts) and one entry in `TOOLS` (mcp.ts). No other files need to change.

---

## Operations

### Mutating

| Operation | Providers used | Notes |
|-----------|---------------|-------|
| `rename` | `projectProvider` | Calls `getRenameLocations`; applies edits; returns `filesModified`, `filesSkipped` |
| `moveFile` | `projectProvider` | Calls `getEditsForFileRename`; renames file; calls `afterFileRename` post-hook |
| `moveSymbol` | `tsProvider` + `projectProvider` | ts-morph AST for source/importers; `afterSymbolMove` hook for Vue SFC importers |

### Read-only

| Operation | Providers used | Notes |
|-----------|---------------|-------|
| `findReferences` | `projectProvider` | Does not take `workspace` — returns all references, including outside the workspace |
| `getDefinition` | `projectProvider` | Same — workspace boundary is only enforced on inputs (the query file), not outputs |

### Filesystem-only (no provider)

| Operation | Notes |
|-----------|-------|
| `searchText` | Pure filesystem walk; no compiler needed; enforces its own boundary checks |
| `replaceText` | Pattern mode (regex) or surgical mode (edits array); enforces its own boundary checks |

`searchText` and `replaceText` receive a registry but ignore it. The dispatcher still passes `pathParams: []` so workspace validation falls back to the workspace root.

---

## Workspace boundary enforcement

- **Inputs:** the dispatcher validates all `pathParams` against `isWithinWorkspace` before calling the operation
- **Outputs (collateral writes):** each operation checks files before writing; out-of-workspace files are skipped and returned in `filesSkipped`. Agents should surface `filesSkipped` to the user.

Input validation is at the dispatcher layer; output filtering is at the operation layer. Both call `isWithinWorkspace` from `src/security.ts`.

---

## Provider invalidation

The watcher (`src/daemon/watcher.ts`) calls into the dispatcher:

- `invalidateFile(path)` — on file change; cheaper than full rebuild. Calls `TsProvider.refreshFile` and `VolarProvider.invalidateService`.
- `invalidateAll()` — on file add/remove; drops both provider singletons so they rebuild lazily on the next request.

---

## Shared utilities

| File | Purpose |
|------|---------|
| `src/utils/text-utils.ts` | `applyTextEdits()`, `offsetToLineCol()` — used by all operations |
| `src/utils/file-walk.ts` | `walkFiles(dir, extensions)`, `SKIP_DIRS` — git-aware file collection |
| `src/utils/ts-project.ts` | `findTsConfig`, `findTsConfigForFile`, `isVueProject` — project discovery |
| `src/providers/vue-scan.ts` | `updateVueImportsAfterMove`, `updateVueNamedImportAfterSymbolMove` — regex scans for `.vue` SFC import strings |
