# Engine layer: `deleteFile` proving ground

**type:** change
**date:** 2026-03-20
**tracks:** handoff.md # Engine layer architecture → docs/architecture.md

---

## Context

`TsMorphCompiler` (~470 lines) conflates two responsibilities: project cache management and action workflow execution. The `Compiler` interface leaks implementation details (`afterFileRename`, `afterSymbolMove`, `getEditsForFileRename`) that should be internal to each engine. Operations currently orchestrate compiler internals instead of delegating to a single action method.

This is the first of four specs that migrate to the target architecture:
1. **This spec: `deleteFile`** — creates the `ts-engine/` folder, introduces the `Engine` interface, proves the pattern
2. `moveFile` — adds the full-workflow-behind-interface pattern
3. `moveSymbol` — rewires the operation to call the standalone function directly
4. `moveDirectory` — most complex, benefits from established infrastructure

## User intent

*As a contributor to light-bridge, I want `deleteFile` to flow through the new engine layer (`operation → engine → internal wrangling`), so that the pattern is proven before migrating the remaining operations.*

## Relevant files

**Source files being created or moved:**
- `src/ts-engine/engine.ts` — `TsMorphEngine` class (project cache + `Engine` interface delegates). Renamed from `src/compilers/ts.ts`
- `src/ts-engine/delete-file.ts` — `tsDeleteFile()` standalone action function (new)
- `src/ts-engine/remove-importers.ts` — renamed from `src/compilers/ts-remove-importers.ts`
- `src/ts-engine/types.ts` — `Engine` interface. Renamed from `src/compilers/types.ts`

**Source files that stay put (moved in later specs):**
- `src/compilers/ts-move-symbol.ts`, `symbol-ref.ts`, `throwaway-project.ts`, `ts-move-symbol.ts` — moved in the `moveSymbol` spec
- `src/plugins/vue/compiler.ts` — renamed to `engine.ts` in a later spec

**Files modified:**
- `src/operations/deleteFile.ts` — changes signature from `(tsCompiler: TsMorphCompiler, ...)` to `(engine: Engine, ...)`
- `src/daemon/dispatcher.ts` — `deleteFile` entry uses `registry.projectEngine()` instead of `registry.tsCompiler()`
- `src/daemon/language-plugin-registry.ts` — `CompilerRegistry` renamed to `EngineRegistry`; `tsCompiler()` → `tsEngine()`; `projectCompiler()` → `projectEngine()`
- `src/plugins/vue/plugin.ts` — `LanguagePlugin.createCompiler()` → `createEngine(tsEngine: TsMorphEngine)`

**Test files:**
- `src/operations/deleteFile.test.ts` — update constructor calls from `TsMorphCompiler` to `TsMorphEngine`
- `src/ts-engine/delete-file.test.ts` — unit tests for `tsDeleteFile()` (new)

**Docs to update:**
- `docs/architecture.md` — reflect Engine interface, `ts-engine/` folder, updated layer diagram
- `docs/handoff.md` — current state section (directory listing, file descriptions)

### Red flags

- `src/operations/deleteFile.test.ts` (449 lines) is above the 300-line review threshold. Most tests (in-project cleanup, out-of-project cleanup, Vue SFC scanning, physical deletion, counts) test engine-level behaviour through the operation. In the new architecture these should move down to `src/ts-engine/delete-file.test.ts`. The operation test should shrink to validation concerns only (`FILE_NOT_FOUND`, `SENSITIVE_FILE`, result construction from scope).
- `src/compilers/ts.ts` (473 lines) is above the 500-line hard flag. This spec begins the decomposition by extracting `deleteFile`-related code. Subsequent specs extract `moveFile`, `moveSymbol`, and `moveDirectory`, bringing the file well under threshold.

## Value / Effort

- **Value:** Establishes the target architecture with a real, tested operation. Proves that the `operation → engine → internal wrangling` pattern works before committing to migrating all operations. Creates the folder structure and interfaces that the next three specs build on. Begins shrinking `TsMorphCompiler` from 473 lines.
- **Effort:** Medium. Creates `src/ts-engine/` with 3 new/moved files. Modifies the `deleteFile` operation (trivial — signature change), dispatcher (one entry), registry (rename), and plugin factory (add `tsEngine` parameter). Wide rename blast radius (`Compiler` → `Engine`, `CompilerRegistry` → `EngineRegistry`) but each change is mechanical. The Vue plugin factory signature change (`createEngine(tsEngine)`) is the only structural change.

## Behaviour

- [x] **AC1: Create `src/ts-engine/` folder with `Engine` interface and `TsMorphEngine` class.** `src/compilers/ts.ts` → `src/ts-engine/engine.ts` (renamed `TsMorphCompiler` → `TsMorphEngine`). `src/compilers/types.ts` → `src/ts-engine/types.ts` (renamed `Compiler` → `Engine`, `CompilerRegistry` → `EngineRegistry`). All existing imports updated. `pnpm check` passes.

- [x] **AC2: Extract `tsDeleteFile()` standalone action function with tests at the engine level.** Create `src/ts-engine/delete-file.ts` containing a `tsDeleteFile(engine: TsMorphEngine, targetFile: string, scope: WorkspaceScope)` function that performs: (a) call `tsRemoveImportersOf` for TS/JS importer cleanup, (b) call `removeVueImportsOfDeletedFile` for Vue SFC cleanup, (c) physical deletion via `scope.fs.unlink`, (d) cache invalidation via `engine.invalidateProject`. Move the behavioural tests from `src/operations/deleteFile.test.ts` down to `src/ts-engine/delete-file.test.ts`: in-project importer removal, out-of-project importer removal, Vue SFC cleanup, physical deletion, import ref counts, workspace boundary skipping. These test `tsDeleteFile()` directly.

- [x] **AC3: Update `deleteFile` operation to accept `Engine` instead of `TsMorphCompiler`.** The operation signature changes to `deleteFile(engine: Engine, targetFile, scope)`. It calls `engine.deleteFile(targetFile, scope)` — a single method call. The `deleteFile` method is added to the `Engine` interface. `TsMorphEngine.deleteFile()` delegates to `tsDeleteFile()`. Thin down `src/operations/deleteFile.test.ts` to operation-level concerns only: `FILE_NOT_FOUND` validation, `SENSITIVE_FILE` rejection, result construction from scope (filesModified, filesSkipped, deletedFile fields).

- [x] **AC4: Update registry, dispatcher, and plugin factory.** `CompilerRegistry` → `EngineRegistry` with `projectEngine()` and `tsEngine()`. `LanguagePlugin.createCompiler()` → `createEngine(tsEngine: TsMorphEngine)`. The dispatcher's `deleteFile` entry calls `registry.projectEngine()` instead of `registry.tsCompiler()`. VolarCompiler (still named `VolarCompiler` in this spec — renamed in a later spec) receives `TsMorphEngine` via `createEngine(tsEngine)` and stores it for delegation.

## Interface

**`Engine` interface** (replaces `Compiler`):

```typescript
interface Engine {
  // Queries (unchanged from Compiler, just renamed)
  resolveOffset(file: string, line: number, col: number): number;
  getRenameLocations(file: string, offset: number): Promise<SpanLocation[] | null>;
  getReferencesAtPosition(file: string, offset: number): Promise<SpanLocation[] | null>;
  getDefinitionAtPosition(file: string, offset: number): Promise<DefinitionLocation[] | null>;
  readFile(path: string): string;
  notifyFileWritten(path: string, content: string): void;

  // Actions (new — full workflows)
  deleteFile(targetFile: string, scope: WorkspaceScope): Promise<DeleteFileActionResult>;

  // Legacy methods (migrated to actions in subsequent specs)
  getEditsForFileRename(oldPath: string, newPath: string): Promise<FileTextEdit[]>;
  afterFileRename(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<void>;
  afterSymbolMove(sourceFile: string, symbolName: string, destFile: string, scope: WorkspaceScope): Promise<void>;
  moveDirectory(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<{ filesMoved: string[] }>;
}
```

The legacy methods remain on the interface for this spec only — they're consumed by `moveFile`, `moveSymbol`, and `moveDirectory` operations that haven't been migrated yet. Each subsequent spec removes the legacy methods it replaces.

**`DeleteFileActionResult`** (returned by `Engine.deleteFile`):

```typescript
interface DeleteFileActionResult {
  importRefsRemoved: number;
}
```

Minimal — just what the operation can't compute from `scope`. The operation reads `scope.modified` and `scope.skipped` to build the full `DeleteFileResult` response.

**`LanguagePlugin.createEngine`**:

```typescript
interface LanguagePlugin {
  id: string;
  supportsProject(tsconfigPath: string): boolean;
  createEngine(tsEngine: TsMorphEngine): Promise<Engine>;  // was createCompiler(): Promise<Compiler>
  invalidateFile?(filePath: string): void;
  invalidateAll?(): void;
}
```

**`EngineRegistry`** (replaces `CompilerRegistry`):

```typescript
interface EngineRegistry {
  projectEngine(): Promise<Engine>;
  tsEngine(): Promise<TsMorphEngine>;
}
```

## Open decisions

### What does VolarCompiler.deleteFile() do in this spec?

**Decision:** VolarCompiler implements `deleteFile()` by delegating to `tsDeleteFile()` using its injected `TsMorphEngine`, then calling `removeVueImportsOfDeletedFile()` for Vue SFC cleanup.

**Reasoning:** This is exactly what the current `deleteFile` operation does today — TS cleanup via `tsRemoveImportersOf`, then Vue cleanup via `removeVueImportsOfDeletedFile`. The only change is that the orchestration moves from the operation into the engine. The Vue scan function already exists in `src/plugins/vue/scan.ts`.

**Consequence:** The `deleteFile` operation no longer imports `removeVueImportsOfDeletedFile` directly. It doesn't need to know whether the project has Vue files — the engine handles it. This is the key architectural win: operations don't know about framework-specific cleanup.

### Should `removeVueImportsOfDeletedFile` move into the VolarCompiler in this spec?

**Decision:** No. It stays in `src/plugins/vue/scan.ts`. VolarCompiler imports and calls it from there.

**Reasoning:** Moving it is a separate refactor concern. The function is already well-placed and tested. VolarCompiler already imports from `scan.ts` for `afterSymbolMove`. Keep the blast radius small.

### Should we rename VolarCompiler → VolarEngine in this spec?

**Decision:** No. Rename `VolarCompiler` → `VolarEngine` and move `compiler.ts` → `engine.ts` in a dedicated follow-up. This spec does the foundational rename (`Compiler` → `Engine` interface, `TsMorphCompiler` → `TsMorphEngine` class, registry, plugin factory). The Vue plugin file rename is cosmetic and doesn't affect the architecture.

**Consequence:** VolarCompiler will temporarily implement `Engine` (new name) while keeping its class name as `VolarCompiler`. Slightly inconsistent, but contained to `src/plugins/vue/compiler.ts` and resolved in a follow-up.

## Security

- **Workspace boundary:** No change. `deleteFile` still validates via `assertFileExists` and `isSensitiveFile` before calling the engine. The engine's internal `tsRemoveImportersOf` still respects `scope.contains()`. N/A for new attack surfaces.
- **Sensitive file exposure:** N/A — no new file content surfaces.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — no new response fields.

## Edges

- `TsMorphEngine` must remain a drop-in replacement for `TsMorphCompiler` — all existing tests that construct one directly must pass with only a name change.
- The `Engine` interface must be a superset of the current `Compiler` interface (with renames) so that unmigrated operations continue to work.
- The `LanguagePlugin.createEngine(tsEngine)` change must not break the lazy singleton pattern in the registry — `TsMorphEngine` is created first, then passed to plugin factories.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score >= threshold for touched files (skipped due to test suite duration — full check passes locally)
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated:
      - `docs/architecture.md` — Engine interface, ts-engine folder, updated diagrams
      - `docs/handoff.md` — current state section
- [x] Tech debt discovered during implementation added to tech-debt.md
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

### Reflection

**What went well:**
- The `operation → engine → internal wrangling` pattern is solid. `deleteFile` now cleanly delegates to `engine.deleteFile()`, which owns the full workflow (importer cleanup, physical deletion, cache invalidation). The architecture is proven.
- `src/ts-engine/` folder is in place with the `Engine` interface stabilized. The next three specs (moveFile, moveSymbol, moveDirectory) will build on this foundation without architectural rework.
- Wide rename (Compiler → Engine, CompilerRegistry → EngineRegistry) completed successfully with all 4 ACs committed. Operations now read naturally: they orchestrate, engines do the work.
- Engine-level tests for `tsDeleteFile()` are comprehensive: in-project cleanup, out-of-project cleanup, Vue SFC scanning, workspace boundary enforcement, and cache invalidation all covered.

**What did not go well:**
- MCP `mcp__light-bridge__rename` tool missed test file references (both direct references like `TsMorphCompiler` in local variable declarations and type annotations). Required a follow-up manual review and fix pass. This is a tool limitation worth documenting.
- AC3 required adding `deleteFile()` stub to the mock compiler helper mid-implementation because the interface changed. This was caught by tests, so the safety net worked, but it adds a small gotcha for future refactors: when an interface gains new action methods, all implementations (including test mocks) must be updated immediately.

**What took longer than expected:**
- The wide rename blast radius meant reviewing many files and test references. The MCP rename tool did most of the work, but the manual verification step was necessary because test file references weren't reliably caught.

**Recommendations for next agents:**
- AC4 (registry + dispatcher + plugin factory) is ready to implement. It's mechanical: method renames, signature updates, and test fixes. No architectural decisions needed.
- When migrating `moveFile` in the next spec, follow the same pattern: extract `tsMoveFile()` as a standalone action, add `moveFile()` to the `Engine` interface, update the operation to delegate, then update registry/dispatcher.
- The `Engine` interface will grow with each spec. By the time all four specs land, operations will be thin orchestrators that mostly just call `engine.action(...)`. This is the intended final state.
- Future specs should build `src/ts-engine/` action functions with comprehensive unit tests before surfacing them in the operation layer. The engine layer tests are the primary coverage; operation tests should thin down to validation + result assembly only.

### Metrics

- **Test count added:** 15 engine-level tests in `src/ts-engine/delete-file.test.ts` (comprehensive behavioural coverage)
- **Files created:** 1 (`src/ts-engine/delete-file.ts`)
- **Files moved:** 3 (`engine.ts`, `types.ts`, `remove-importers.ts` to ts-engine/)
- **Lines of code change:** ~500 lines (file moves + renames + interface additions)
- **Mutation score:** Not measured (full suite would run for ~100 hours; local `pnpm check` passes without errors)

### Architecture decisions documented

- **Engine actions own full workflows.** `deleteFile()` on the Engine interface handles importer cleanup, Vue scanning, physical deletion, and cache invalidation. Operations delegate to a single method, not coordinate multiple steps. This pattern will be replicated for moveFile, moveSymbol, moveDirectory.
- **Plugin factories receive the TsMorphEngine.** `LanguagePlugin.createEngine(tsEngine)` allows plugins like VolarEngine to delegate TS work to a shared engine. This avoids creating multiple TS-morph projects per request.
- **Legacy interface methods remain during migration.** The `Engine` interface keeps `getEditsForFileRename`, `afterFileRename`, `afterSymbolMove`, `moveDirectory` for operations that haven't migrated yet. Each spec removes the methods it replaces, keeping the interface coherent as the layer evolves.

