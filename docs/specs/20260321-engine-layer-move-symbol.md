# Engine layer: `moveSymbol` action

**type:** change
**date:** 2026-03-21
**tracks:** handoff.md # Engine layer: moveSymbol action → docs/architecture.md

---

## Context

Third spec in the engine layer migration. `deleteFile` and `moveFile` established the pattern: standalone action function in `ts-engine/`, full-workflow method on `Engine`, operation becomes validate + delegate. This spec migrates `moveSymbol` — the operation currently orchestrates two separate engines (`tsCompiler.moveSymbol()` + `projectCompiler.afterSymbolMove()`). After this spec, those become internal to `Engine.moveSymbol()`.

## User intent

*As a contributor to light-bridge, I want `moveSymbol` to be a single action method on the `Engine` interface, so that operations don't orchestrate compiler internals and the two-engine dance (`tsCompiler` + `projectCompiler`) is hidden behind a single call.*

## Relevant files

**Engine layer:**
- `src/ts-engine/engine.ts` — `TsMorphEngine`; owns `moveSymbol()` (thin delegate) and `afterSymbolMove()` (fallback scan). Both merge into a single `moveSymbol()`.
- `src/ts-engine/types.ts` — `Engine` interface; gains `moveSymbol`, loses `afterSymbolMove`
- `src/compilers/ts-move-symbol.ts` — `tsMoveSymbol()` standalone AST surgery function; stays where it is

**Operation layer:**
- `src/operations/moveSymbol.ts` — currently takes `tsCompiler` + `projectCompiler`; becomes validate + delegate to single `engine`
- `src/operations/moveSymbol.test.ts` (189 lines) — operation-level unit tests with mock compilers
- `src/operations/moveSymbol_tsMorphCompiler.test.ts` (99 lines) — integration tests through the operation
- `src/operations/moveSymbol_volarCompiler.test.ts` (40 lines) — Vue integration tests through the operation

**Plugin layer:**
- `src/plugins/vue/compiler.ts` — `VolarCompiler.afterSymbolMove()` does Vue SFC scanning; becomes internal to `VolarCompiler.moveSymbol()`

**Other:**
- `src/compilers/__helpers__/mock-compiler.ts` — mock Engine; `afterSymbolMove` mock must be removed, `moveSymbol` mock added
- `src/daemon/dispatcher.ts` — `moveSymbol` entry currently fetches both `tsEngine()` and `projectEngine()`; should fetch only `projectEngine()`

### Red flags

- `TsMorphEngine` (502 lines) is above the 500-line hard flag. This spec removes `afterSymbolMove()` (~15 lines) — net reduction. Subsequent specs continue extraction.
- Test files are all well-sized (largest is `ts-move-symbol.test.ts` at 255 lines). No test hotspots.

## Value / Effort

- **Value:** Removes `afterSymbolMove` from the `Engine` interface — it's a post-step hook that leaks the two-phase workflow. The `moveSymbol` operation becomes trivially simple (validate + delegate to one engine). Incidentally fixes a latent bug: in Vue projects, the current flow skips the TS fallback scan for files outside `tsconfig.include` because `VolarCompiler.afterSymbolMove()` only scans `.vue` files. After this spec, `VolarCompiler.moveSymbol()` calls `this.tsEngine.moveSymbol()` which includes both AST surgery and the fallback scan.
- **Effort:** Low-medium. Same pattern as `moveFile`. Merge two methods on `TsMorphEngine`, add `moveSymbol()` to `VolarCompiler`, simplify operation + dispatcher, update mock and tests. No new infrastructure.

## Behaviour

- [ ] **AC1: Merge `moveSymbol` + `afterSymbolMove` on `TsMorphEngine`.** `TsMorphEngine.moveSymbol()` becomes the full workflow: calls `tsMoveSymbol(this, ...)` for AST surgery on in-project files, then does the fallback workspace walk (absorbs the current `afterSymbolMove()` body — walks all workspace TS/JS files not already in `scope.modified` and rewrites imports via `ImportRewriter`). Remove `TsMorphEngine.afterSymbolMove()`. Existing integration tests in `moveSymbol_tsMorphCompiler.test.ts` continue to pass (they already test the end-to-end flow including fallback scan).

- [ ] **AC2: Add `moveSymbol` to the `Engine` interface, remove `afterSymbolMove`.** `Engine.moveSymbol(sourceFile, symbolName, destFile, scope, options?)` returns `Promise<void>`. Remove `afterSymbolMove` from the `Engine` interface. `VolarCompiler` implements `moveSymbol()`: delegates to `this.tsEngine.moveSymbol()` for TS work (AST surgery + fallback scan), then does Vue SFC scanning (absorbs the current `VolarCompiler.afterSymbolMove()` body). Remove `VolarCompiler.afterSymbolMove()`. Remove `afterSymbolMove` from `makeMockCompiler()`, add `moveSymbol` mock. Add a test: when `VolarCompiler.moveSymbol()` is called and a TS file outside `tsconfig.include` imports the moved symbol, that file's imports are rewritten (pins the latent bug fix).

- [ ] **AC3: Update `moveSymbol` operation to delegate to `engine.moveSymbol()`.** The operation takes a single `engine: Engine` (project engine) instead of separate `tsCompiler` + `projectCompiler`. Becomes: `assertFileExists(sourceFile)` → `path.resolve(destFile)` → `engine.moveSymbol(absSource, symbolName, absDest, scope, options)` → return result from scope. Update dispatcher to pass only `registry.projectEngine()`. Update operation-level tests: remove `afterSymbolMove` delegation tests, update mock shape (single `engine` with `moveSymbol` mock instead of separate `tsCompiler` + `projectCompiler`).

## Interface

**`Engine` interface changes:**

```typescript
interface Engine {
  // Added:
  moveSymbol(
    sourceFile: string,
    symbolName: string,
    destFile: string,
    scope: WorkspaceScope,
    options?: { force?: boolean },
  ): Promise<void>;

  // Removed:
  // afterSymbolMove(sourceFile, symbolName, destFile, scope)

  // Unchanged (legacy, removed in later specs):
  notifyFileWritten(path: string, content: string): void;
  moveDirectory(...): Promise<{ filesMoved: string[] }>;
  // ... queries, moveFile, deleteFile unchanged
}
```

**Parameters:**
- `sourceFile` — absolute path to the file containing the symbol. Must exist. Example: `/workspace/src/utils.ts`.
- `symbolName` — exact name of the exported symbol to move. Example: `"greetUser"`. Throws `SYMBOL_NOT_FOUND` if not found, `NOT_SUPPORTED` if not a direct export.
- `destFile` — absolute path to the destination file. Created if it doesn't exist. Example: `/workspace/src/helpers.ts`. Throws `SYMBOL_EXISTS` if the symbol already exists in dest (unless `force: true`).
- `scope` — `WorkspaceScope` for boundary enforcement and modification tracking.
- `options.force` — optional. When `true`, replaces existing symbol in destination. Default `false`.

**Return:** `Promise<void>`. All side effects are recorded in `scope` (modified files, skipped files). The operation reads scope to build the response.

**Operation signature change:**
```typescript
// Before:
moveSymbol(tsCompiler: TsMorphEngine, projectCompiler: Engine, sourceFile, symbolName, destFile, scope, options?)

// After:
moveSymbol(engine: Engine, sourceFile, symbolName, destFile, scope, options?)
```

## Open decisions

None. The pattern is established by `moveFile`. `TsMorphEngine.moveSymbol()` owns the TS workflow; `VolarCompiler.moveSymbol()` delegates TS work to `this.tsEngine.moveSymbol()` then adds Vue scanning. Same composition as `moveFile` and `deleteFile`.

## Security

- **Workspace boundary:** No change. `assertFileExists` validates the source path in the operation. `tsMoveSymbol` checks `scope.contains()` for each file it writes. `ImportRewriter` uses `scope.writeFile()` which enforces boundaries. All existing enforcement preserved.
- **Sensitive file exposure:** N/A — `moveSymbol` does not read file content into responses.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — no new response fields.

## Edges

- `tsMoveSymbol()` stays in `src/compilers/ts-move-symbol.ts`. Relocating to `ts-engine/` is a separate cleanup (handoff's "domain/ cleanup" note).
- `notifyFileWritten` stays on the interface — removed in the `rename` spec (last in migration order).
- Existing compiler-level tests (`ts-move-symbol.test.ts`, `ts-move-symbol-errors.test.ts`, `ts-move-symbol-imports.test.ts`) are unchanged — they test `tsMoveSymbol()` directly.
- The MCP integration test (`move-symbol.integration.test.ts`) must continue to pass — it tests the full stack through the daemon.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - `docs/architecture.md` — Engine interface section: `afterSymbolMove` removed, `moveSymbol` added
      - `docs/handoff.md` — P1 entry removed; current-state section unchanged (no new files)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
