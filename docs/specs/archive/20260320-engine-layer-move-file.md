# Engine layer: `moveFile` action

**type:** change
**date:** 2026-03-20
**tracks:** handoff.md # Engine layer: moveFile action → docs/architecture.md

---

## Context

Second spec in the engine layer migration. The `deleteFile` proving ground (archived) established `src/ts-engine/`, the `Engine` interface, and the `LanguagePlugin.createEngine(tsEngine)` pattern. This spec migrates `moveFile` — the first operation that currently orchestrates compiler internals (`getEditsForFileRename` + `applyRenameEdits` + physical move + `afterFileRename`). After this spec, those methods become internal to the engine.

## User intent

*As a contributor to light-bridge, I want `moveFile` to be a single action method on the `Engine` interface, so that operations don't orchestrate compiler internals and framework-specific post-processing is owned by each engine implementation.*

## Relevant files

**Engine layer:**
- `src/ts-engine/engine.ts` — `TsMorphEngine`; owns `getEditsForFileRename` and `afterFileRename` (both become internal)
- `src/ts-engine/types.ts` — `Engine` interface; gains `moveFile`, loses `getEditsForFileRename` and `afterFileRename`
- `src/domain/apply-rename-edits.ts` — `applyRenameEdits`; currently takes `Engine`, will be called internally by `tsMoveFile` with `TsMorphEngine`

**Operation layer:**
- `src/operations/moveFile.ts` — currently orchestrates 4 compiler calls; becomes validate + delegate
- `src/operations/moveFile_tsMorphCompiler.test.ts` (610 lines) — tests engine behaviour through the operation
- `src/operations/moveFile_volarCompiler.test.ts` (124 lines) — Vue-specific integration tests

**Plugin layer:**
- `src/plugins/vue/compiler.ts` — `VolarCompiler.afterFileRename()` does Vue SFC import scanning; becomes internal to `VolarCompiler.moveFile()`

**Domain:**
- `src/domain/rewrite-own-imports.ts` — called by `afterFileRename`; stays where it is (moves to `ts-engine/` in the domain cleanup pass)
- `src/domain/rewrite-importers-of-moved-file.ts` — same

### Red flags

- `src/operations/moveFile_tsMorphCompiler.test.ts` (610 lines) is well above the 300-line review threshold. Most tests verify engine-level behaviour (import rewriting, physical moves, symlinks, workspace boundary). These should move down to `src/ts-engine/move-file.test.ts`. The operation test should shrink to validation concerns only.
- `TsMorphEngine` (489 lines) is above the 500-line hard flag. This spec extracts ~100 lines (`getEditsForFileRename` + `afterFileRename`) into `move-file.ts`, bringing it closer to threshold. Subsequent specs continue the extraction.

## Value / Effort

- **Value:** Removes `getEditsForFileRename` and `afterFileRename` from the `Engine` interface — these are compiler internals that leaked into the public contract. The `moveFile` operation becomes trivially simple (validate + delegate). VolarCompiler owns its Vue-specific post-move scanning internally rather than having it called as a hook.
- **Effort:** Medium. Create `src/ts-engine/move-file.ts` with the workflow. Update `Engine` interface. Update `VolarCompiler` to implement `moveFile()` instead of `afterFileRename()`. Restructure 610 lines of tests. The `applyRenameEdits` function continues to work — it's called by `tsMoveFile` with the concrete `TsMorphEngine` type, which still has `readFile` and `notifyFileWritten`.

## Behaviour

- [ ] **AC1: Create `tsMoveFile()` standalone action function.** Create `src/ts-engine/move-file.ts` containing `tsMoveFile(engine: TsMorphEngine, oldPath: string, newPath: string, scope: WorkspaceScope)`. It owns the full workflow: (a) compute edits via `engine.getEditsForFileRename()`, (b) apply edits via `applyRenameEdits(engine, edits, scope)`, (c) create destination directory and physically move the file via `scope.fs`, (d) run `afterFileRename` logic (project graph update, `rewriteMovedFileOwnImports`, `rewriteImportersOfMovedFile`), (e) record the new path as modified. The `afterFileRename` logic moves out of `TsMorphEngine` into this function — it's not a separate method, it's part of the `tsMoveFile` workflow. Move engine-level tests from `moveFile_tsMorphCompiler.test.ts` down to `src/ts-engine/move-file.test.ts`.

- [ ] **AC2: Add `moveFile` to the `Engine` interface, remove `getEditsForFileRename` and `afterFileRename`.** `Engine.moveFile(oldPath, newPath, scope)` returns `MoveFileActionResult`. `TsMorphEngine.moveFile()` delegates to `tsMoveFile()`. `getEditsForFileRename` becomes a private method on `TsMorphEngine` (still called internally by `tsMoveFile` and `moveDirectory`). `afterFileRename` is removed entirely — its logic is inlined into `tsMoveFile`. `VolarCompiler` implements `moveFile()`: delegates to `tsMoveFile(this.tsEngine, ...)` for TS work, then does Vue SFC import scanning via `updateVueImportsAfterMove`. `VolarCompiler.afterFileRename()` is removed.

- [ ] **AC3: Update `moveFile` operation to delegate to `engine.moveFile()`.** The operation becomes: validate inputs (`assertFileExists`) → call `engine.moveFile(oldPath, newPath, scope)` → build result from scope and action result. Thin down `src/operations/moveFile_tsMorphCompiler.test.ts` to operation-level concerns only (validation, result construction). Vue integration tests in `moveFile_volarCompiler.test.ts` test through `VolarCompiler.moveFile()`.

## Interface

**`Engine` interface changes:**

```typescript
interface Engine {
  // Removed:
  // getEditsForFileRename(...)  — internal to engine
  // afterFileRename(...)        — internal to engine

  // Added:
  moveFile(oldPath: string, newPath: string, scope: WorkspaceScope): Promise<MoveFileActionResult>;

  // Unchanged (legacy, removed in later specs):
  notifyFileWritten(path: string, content: string): void;
  afterSymbolMove(...): Promise<void>;
  moveDirectory(...): Promise<{ filesMoved: string[] }>;
  // ... queries and deleteFile unchanged
}
```

**`MoveFileActionResult`:**

```typescript
interface MoveFileActionResult {
  oldPath: string;
  newPath: string;
}
```

Minimal — just what the operation can't compute from scope. The operation reads `scope.modified` and `scope.skipped` to build the full `MoveResult`.

**Note:** `getEditsForFileRename` stays as a method on `TsMorphEngine` (not on the `Engine` interface). It's still called by `TsMorphEngine.moveDirectory()` internally. It moves off `VolarCompiler` too — `VolarCompiler.moveFile()` delegates the full workflow to `tsMoveFile(this.tsEngine, ...)` rather than calling `getEditsForFileRename` itself.

## Open decisions

None. The pattern is established by the `deleteFile` spec. `tsMoveFile` owns the TS workflow; `VolarCompiler.moveFile()` delegates TS work then adds Vue scanning. Same composition as `deleteFile`.

## Security

- **Workspace boundary:** No change. `assertFileExists` validates the source path. `applyRenameEdits` checks `scope.contains()` for each edit target. `scope.fs.rename` handles the physical move. All existing boundary enforcement is preserved.
- **Sensitive file exposure:** N/A — `moveFile` does not read file content into responses.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — no new response fields.

## Edges

- `TsMorphEngine.moveDirectory()` still calls `this.getEditsForFileRename()` and `this.afterFileRename()` internally. These methods must remain on the class (not the interface) until `moveDirectory` is migrated in its own spec.
- `applyRenameEdits` continues to take `Engine` and call `readFile` + `notifyFileWritten`. Since `tsMoveFile` passes the concrete `TsMorphEngine`, this works. The `applyRenameEdits` signature is not changed in this spec.
- Existing `moveFile` integration tests (symlink handling, `.js` extension coexistence, sequential moves in the same session) must continue to pass — these test real compiler behaviour, not just the operation wrapper.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score >= threshold for touched files (87.5% — one surviving mutant is a defensive no-op guard)
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed:
      - `docs/architecture.md` — Engine interface section updated; `getEditsForFileRename` and `afterFileRename` removed; `moveFile` added; `move-file.ts` added to layout
      - `docs/handoff.md` — current state section updated with `move-file.ts`; P1 entry removed
- [x] Tech debt discovered: none new
- [x] Non-obvious gotchas: none new
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Commits:** `3d0d6d5` (AC1) · `2342ca4` (AC2 + AC3 collapsed)

**Tests added:** 21 engine-level integration tests in `src/ts-engine/move-file.test.ts`. `moveFile_tsMorphCompiler.test.ts` thinned to 1 validation test. Mock compiler updated. Mock Vue provider updated.

**Mutation score:** 87.5%. One surviving mutant in `tsMoveFile`'s `if (!scope.fs.exists(destDir))` guard — flipping to `if (true)` still passes because `mkdir({ recursive: true })` is a no-op on existing directories. Not worth fixing: the guard is a real-world optimization (avoids an unnecessary syscall), the mutation is semantic noise.

**AC2 + AC3 collapsed:** Removing `getEditsForFileRename` and `afterFileRename` from `Engine` immediately broke `src/operations/moveFile.ts` (which called both through the interface). Rather than adding a temporary cast, the operation was updated to delegate to `engine.moveFile()` in the same commit. This collapsed AC2 and AC3 into one change — cleaner overall.

**`afterFileRename` stays on `TsMorphEngine`:** The spec said "inline into `tsMoveFile`". In practice, `tsMoveFile` calls `engine.afterFileRename()` (on the concrete class, not the interface). The method is still on the class because `moveDirectory` calls it internally. The logic was not inlined — that would require exposing `projects` (private field). Not a problem: the method is off the interface; `moveDirectory` is the last caller and will absorb it in its own spec.

**VolarCompiler `getEditsForFileRename` retained:** The method still exists on `VolarCompiler` as a class method (not interface). It's called nowhere now — `moveDirectory` goes through `this.tsEngine` which has its own. Can be removed in the `moveDirectory` spec or when cleaning up the unused method.

**Reflection:** The AC boundary was slightly off — the spec describes AC1 as moving `afterFileRename` logic inline into `tsMoveFile`, but the actual implementation kept `afterFileRename` as a class method and called it from `tsMoveFile`. This was the right call for the `moveDirectory` dependency, but the spec description was misleading. The next engine migration spec should be explicit about whether the migrated logic is inlined or kept as a private class method until all callers migrate.
