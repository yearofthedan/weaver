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
  ts.ts                 ← TsProvider — ts-morph Project; per-tsconfig cache; always-available TS fallback

src/plugins/             ← language plugin feature folders (one per framework)
  vue/
    plugin.ts           ← createVueLanguagePlugin() — LanguagePlugin factory (project detection, lifecycle)
    provider.ts         ← VolarProvider — Volar proxy; virtual↔real path translation; afterSymbolMove
    scan.ts             ← updateVueImportsAfterMove, updateVueNamedImportAfterSymbolMove
    service.ts          ← buildVolarService() factory
```

Each plugin folder is a self-contained unit: project detection, provider implementation, and any framework-specific helpers. When adding a new framework (Svelte, Angular), add a new `src/plugins/<name>/` folder following the same shape.

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

## Language plugin contract

The `LanguagePlugin` interface (defined in `src/types.ts`) is the contract for adding language/framework support. Each plugin provides project-level detection and a `LanguageProvider` factory:

```typescript
interface LanguagePlugin {
  id: string;                                      // stable identifier, e.g. "vue-volar"
  supportsProject(tsconfigPath: string): boolean;  // project-level detection
  createProvider(): Promise<LanguageProvider>;      // lazy factory, result cached by registry
  invalidateFile?(filePath: string): void;         // selective cache refresh
  invalidateAll?(): void;                          // full cache drop
}
```

**Resolution:** `makeRegistry(filePath)` finds the tsconfig for the input file, then iterates registered plugins in order. The first plugin whose `supportsProject()` returns true provides the `projectProvider`. If no plugin matches (or no tsconfig exists), TsProvider is used as the default fallback.

**Detection is project-level, not file-level.** In a Vue project, even `.ts` file operations go through VolarProvider because Volar's language service sees both `.ts` and `.vue` importers. The detection checks the project (does this tsconfig cover a Vue project?), not the file extension.

**Built-in plugins:** Vue/Volar is registered at module load time (`src/daemon/vue-language-plugin.ts`). The TS provider is the always-available fallback — it's not modelled as a plugin.

**Adding a new language plugin:** Implement `LanguagePlugin` with project detection logic, create a `LanguageProvider` for your framework's compiler, and call `registerLanguagePlugin()`. See `src/daemon/vue-language-plugin.ts` as a template.

---

## Provider registry

The registry creates a `ProviderRegistry` per request, scoped to the project that contains the input file:

```typescript
interface ProviderRegistry {
  projectProvider(): Promise<LanguageProvider>  // first matching plugin, or TsProvider fallback
  tsProvider(): Promise<TsProvider>             // always TsProvider — for AST-level operations
}
```

`projectProvider` resolution iterates registered `LanguagePlugin` entries (see above). `tsProvider` is not subject to plugin resolution — it always returns TsProvider for operations needing direct ts-morph AST access (e.g. `moveSymbol`, `extractFunction`).

In a monorepo each package resolves to its own tsconfig and gets the right provider automatically. Providers are lazy singletons; each manages a per-tsconfig cache internally.

---

## Operation dispatch

`src/daemon/dispatcher.ts` uses an `OPERATIONS` descriptor table (operation dispatch only — language plugin registration and provider resolution live in `src/daemon/language-plugin-registry.ts`). Each entry owns:

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

The watcher (`src/daemon/watcher.ts`) calls into the language plugin registry:

- `invalidateFile(path)` — on file change; cheaper than full rebuild. Refreshes the TS provider, then iterates all registered language plugins calling `plugin.invalidateFile()`. Errors in one plugin do not block others.
- `invalidateAll()` — on file add/remove; drops the TS provider singleton and all cached plugin providers, then calls `plugin.invalidateAll()` on each plugin. Errors are isolated per plugin.

---

## Shared utilities

| File | Purpose |
|------|---------|
| `src/utils/text-utils.ts` | `applyTextEdits()`, `offsetToLineCol()` — used by all operations |
| `src/utils/file-walk.ts` | `walkFiles(dir, extensions)`, `SKIP_DIRS` — in git workspaces shells out to `git ls-files` (respects gitignore); falls back to recursive readdir + `SKIP_DIRS` elsewhere |
| `src/utils/ts-project.ts` | `findTsConfig`, `findTsConfigForFile`, `isVueProject` — project discovery |
| `src/plugins/vue/scan.ts` | `updateVueImportsAfterMove`, `updateVueNamedImportAfterSymbolMove` — regex scans for `.vue` SFC import strings |

## Implementation notes

**Language plugin invalidation hooks must be error-isolated.**
`invalidateFile` and `invalidateAll` iterate all registered plugins. Each plugin's hook is wrapped in try/catch so a crash in one plugin (e.g. a Volar service bug) doesn't prevent other plugins from refreshing their state. The TS provider is invalidated separately (before the plugin loop) since it's not a plugin.

**`isWithinWorkspace` and `isSensitiveFile` are both in `src/security.ts`.**
`isWithinWorkspace` enforces the workspace boundary at two points: the dispatcher (input path validation) and each operation's output loop (write filtering). It resolves symlinks via `fs.realpathSync` for existing paths to prevent symlink escape. `isSensitiveFile` is called by `searchText` (silently skips) and `replaceText` surgical mode (throws `SENSITIVE_FILE` before touching any file).

**ts-morph internals — see [`docs/tech/ts-morph.md`](tech/ts-morph.md).**
Bundled TypeScript instance, `getProjectForDirectory` vs `getProjectForFile`, and module-level cache gotchas are documented there.
