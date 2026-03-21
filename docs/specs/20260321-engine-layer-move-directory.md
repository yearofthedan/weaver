# Engine layer: `moveDirectory` action

**type:** change
**date:** 2026-03-21
**tracks:** handoff.md # Engine layer: moveDirectory action → docs/architecture.md

---

## Context

Fourth spec in the engine layer migration. `deleteFile`, `moveFile`, and `moveSymbol` established the pattern: standalone action function in `ts-engine/`, full-workflow method on `Engine`, operation becomes validate + delegate. This spec migrates `moveDirectory` — the operation currently orchestrates compiler + non-source file handling as two separate steps. A comment in `tsMoveFile.ts` explicitly defers `afterFileRename` extraction to this spec. After this spec, the operation is a trivial validate + delegate, and `VolarCompiler` is renamed `VolarEngine` to match its role.

## User intent

*As a contributor to light-bridge, I want `moveDirectory` to be a single full-workflow action on the `Engine` interface, so that the operation doesn't orchestrate compiler internals and non-source file handling, and both are hidden behind one call.*

## Relevant files

- `src/ts-engine/engine.ts` — `TsMorphEngine.moveDirectory()` (~52 lines inline); `TsMorphEngine.afterFileRename()` (extracted here); `enumerateSourceFiles` helper
- `src/ts-engine/move-file.ts` — `tsMoveFile()` calls `engine.afterFileRename()`; comment says "until the moveDirectory spec removes it"
- `src/ts-engine/types.ts` — `Engine` interface; `moveDirectory` JSDoc needs updating
- `src/operations/moveDirectory.ts` — validation + `compiler.moveDirectory()` + non-source file loop; becomes validate + delegate
- `src/operations/moveDirectory_tsMorphCompiler.test.ts` (389 lines) — integration tests through the operation
- `src/plugins/vue/compiler.ts` — `VolarCompiler.moveDirectory()` thin-delegates to tsEngine; renamed to `VolarEngine`/`engine.ts` in AC3
- `src/compilers/__helpers__/mock-compiler.ts` — mock Engine; `moveDirectory` mock shape unchanged

### Red flags

- `src/ts-engine/engine.ts` is 483 lines. This spec removes `moveDirectory()` (~52 lines) and `afterFileRename()` (~22 lines) — net reduction to ~409 lines, clearing the hard flag.
- `moveDirectory_tsMorphCompiler.test.ts` is 389 lines (above 300-line review threshold). Tests are well-organised by describe block and cover distinct scenarios — no refactoring needed before adding new tests for `tsMoveDirectory()`.

## Value / Effort

- **Value:** Removes the split-responsibility between operation and compiler for a directory move. Currently the operation has to enumerate all files upfront, delegate source files to the compiler, then loop over non-source files — three phases the caller shouldn't know about. After this spec, the operation is five lines: validate, call engine, return. Also clears a deferred TODO in `tsMoveFile.ts`.
- **Effort:** Medium. Three distinct commits: (1) extract `tsAfterFileRename` + `tsMoveDirectory` and remove `TsMorphEngine.afterFileRename`; (2) simplify the operation; (3) mechanical rename of `VolarCompiler` → `VolarEngine`. No new infrastructure — same pattern as `tsMoveFile`.

## Behaviour

- [ ] **AC1: Extract `tsMoveDirectory()` and `tsAfterFileRename()`.** Create `src/ts-engine/after-file-rename.ts` exporting `tsAfterFileRename(engine: TsMorphEngine, oldPath, newPath, scope)` — inlines `TsMorphEngine.afterFileRename()` body verbatim. Update `src/ts-engine/move-file.ts` to call `tsAfterFileRename` instead of `engine.afterFileRename()`. Remove `TsMorphEngine.afterFileRename()`. Create `src/ts-engine/move-directory.ts` exporting `tsMoveDirectory(engine: TsMorphEngine, oldPath, newPath, scope): Promise<{ filesMoved: string[] }>` — full workflow: enumerate source files, compute edits per file via `engine.getEditsForFileRename`, filter intra-directory edits, apply external edits via `applyRenameEdits`, OS rename via `fs.renameSync`, call `tsAfterFileRename` per source file, enumerate all files (source + non-source) that are now at the new path and record them in scope, move any non-source files still at the old path. `TsMorphEngine.moveDirectory()` becomes a 1-line thin delegate: `return tsMoveDirectory(this, oldPath, newPath, scope)`. Existing integration tests in `moveDirectory_tsMorphCompiler.test.ts` continue to pass unchanged.

- [ ] **AC2: Simplify the `moveDirectory` operation to validate + delegate.** Remove `enumerateAllFiles`, `allFilesBefore`, and the non-source file loop from `src/operations/moveDirectory.ts`. Operation becomes: `statDir`/`isDirectory`/`MOVE_INTO_SELF`/`DESTINATION_EXISTS` checks → `const { filesMoved } = await compiler.moveDirectory(absOld, absNew, scope)` → return `{ filesMoved, filesModified: scope.modified, filesSkipped: scope.skipped, oldPath: absOld, newPath: absNew }`. Update `Engine.moveDirectory()` JSDoc in `types.ts`: remove "Non-source files (json, css, images) are the caller's responsibility" — the engine now handles them. All existing operation-level tests continue to pass.

- [ ] **AC3: Rename `VolarCompiler` → `VolarEngine`, `compiler.ts` → `engine.ts`.** Use `mcp__light-bridge__rename` to rename the class, then `mcp__light-bridge__moveFile` to move `src/plugins/vue/compiler.ts` → `src/plugins/vue/engine.ts`. Verify all 10 affected files are updated. `pnpm check` passes.

## Interface

**`Engine.moveDirectory()` contract change:**

```typescript
// Before (JSDoc):
// "Only handles source files the compiler understands.
//  Non-source files (json, css, images) are the caller's responsibility."

// After (JSDoc):
// Full moveDirectory workflow: rewrite imports for all source files atomically,
// physically move the entire directory tree (source and non-source files),
// and record all moved files into scope.
```

**`tsMoveDirectory` signature:**
```typescript
export async function tsMoveDirectory(
  engine: TsMorphEngine,
  oldPath: string,   // absolute path to source directory
  newPath: string,   // absolute path to destination directory
  scope: WorkspaceScope,
): Promise<{ filesMoved: string[] }>
// filesMoved: absolute new paths of ALL files moved (source + non-source, excluding SKIP_DIRS)
```

**`tsAfterFileRename` signature:**
```typescript
export async function tsAfterFileRename(
  engine: TsMorphEngine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<void>
// Inlines TsMorphEngine.afterFileRename() exactly. Called once per source file moved.
```

**Operation return shape:** unchanged — `{ filesMoved, filesModified, filesSkipped, oldPath, newPath }`.

## Open decisions

None. The pattern is established by `tsMoveFile`. `tsMoveDirectory` takes `TsMorphEngine` and calls `getEditsForFileRename` + `tsAfterFileRename` directly — same as `tsMoveFile` calls `getEditsForFileRename` + `tsAfterFileRename`. `VolarEngine.moveDirectory()` continues to thin-delegate to `tsEngine.moveDirectory()` (the Vue import specifier bug is a separate P2 item in handoff).

## Security

- **Workspace boundary:** No change. Validation checks (`statDir`, `MOVE_INTO_SELF`, `DESTINATION_EXISTS`) stay in the operation. `applyRenameEdits` uses `scope.writeFile()` which enforces boundaries. `scope.fs.rename` (for non-source files) enforces boundaries via `WorkspaceScope`. All existing enforcement preserved.
- **Sensitive file exposure:** N/A — no file content is read into responses.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — no new response fields.

## Edges

- `getEditsForFileRename` and `afterFileRename` stay on `TsMorphEngine` as class methods (`afterFileRename` is removed in AC1; `getEditsForFileRename` stays until the `rename` spec removes it). `tsMoveDirectory` takes `TsMorphEngine` directly (not `Engine`) — same as `tsMoveFile`.
- The Vue import specifier bug (`VolarEngine.moveDirectory` doesn't rewrite `.vue` SFC imports) is NOT fixed here — it's a separate P2 item in handoff. `VolarEngine.moveDirectory` continues to delegate to `tsEngine.moveDirectory()`.
- The MCP integration test for `moveDirectory` must continue to pass — it tests the full stack through the daemon.
- `enumerateSourceFiles` in `engine.ts` is used only by `moveDirectory`. After AC1, it moves to `move-directory.ts` (or stays in `engine.ts` as a module-level helper — executor's choice, keep it colocated with its caller).

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/architecture.md` — Engine interface section: `moveDirectory` marked as action, `afterFileRename` removal noted, `VolarCompiler` → `VolarEngine` rename noted
      - `docs/handoff.md` — P1 entry removed; current-state section: update `compiler.ts` → `engine.ts` reference
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
