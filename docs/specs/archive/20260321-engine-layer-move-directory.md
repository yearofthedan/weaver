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

- [x] **AC1: Extract `tsMoveDirectory()` and `tsAfterFileRename()`.** Create `src/ts-engine/after-file-rename.ts` exporting `tsAfterFileRename(engine: TsMorphEngine, oldPath, newPath, scope)` — inlines `TsMorphEngine.afterFileRename()` body verbatim. Update `src/ts-engine/move-file.ts` to call `tsAfterFileRename` instead of `engine.afterFileRename()`. Remove `TsMorphEngine.afterFileRename()`. Create `src/ts-engine/move-directory.ts` exporting `tsMoveDirectory(engine: TsMorphEngine, oldPath, newPath, scope): Promise<{ filesMoved: string[] }>` — full workflow: enumerate source files, compute edits per file via `engine.getEditsForFileRename`, filter intra-directory edits, apply external edits via `applyRenameEdits`, OS rename via `fs.renameSync`, call `tsAfterFileRename` per source file, enumerate all files (source + non-source) that are now at the new path and record them in scope, move any non-source files still at the old path. `TsMorphEngine.moveDirectory()` becomes a 1-line thin delegate. Existing integration tests in `moveDirectory_tsMorphCompiler.test.ts` continue to pass unchanged.

- [x] **AC2: Simplify the `moveDirectory` operation to validate + delegate.** Remove `enumerateAllFiles`, `allFilesBefore`, and the non-source file loop from `src/operations/moveDirectory.ts`. Operation becomes: validation checks → `const { filesMoved } = await compiler.moveDirectory(...)` → return result. Update `Engine.moveDirectory()` JSDoc to remove "Non-source files are the caller's responsibility". All existing operation-level tests continue to pass.

- [x] **AC3: Rename `VolarCompiler` → `VolarEngine`, `compiler.ts` → `engine.ts`.** Use `mcp__light-bridge__rename` + `mcp__light-bridge__moveFile`. All 11 affected files updated. `pnpm check` passes.

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
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<{ filesMoved: string[] }>
```

**`tsAfterFileRename` signature:**
```typescript
export async function tsAfterFileRename(
  engine: TsMorphEngine,
  oldPath: string,
  newPath: string,
  scope: WorkspaceScope,
): Promise<void>
```

**Operation return shape:** unchanged — `{ filesMoved, filesModified, filesSkipped, oldPath, newPath }`.

## Open decisions

None. The pattern is established by `tsMoveFile`. `tsMoveDirectory` takes `TsMorphEngine` and calls `getEditsForFileRename` + `tsAfterFileRename` directly.

## Security

- **Workspace boundary:** No change. Validation checks (`statDir`, `MOVE_INTO_SELF`, `DESTINATION_EXISTS`) stay in the operation. `applyRenameEdits` uses `scope.writeFile()` which enforces boundaries. All existing enforcement preserved.
- **Sensitive file exposure:** N/A — no file content is read into responses.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — no new response fields.

## Edges

- `getEditsForFileRename` stays on `TsMorphEngine` until the `rename` spec removes it.
- The Vue import specifier bug (`VolarEngine.moveDirectory` doesn't rewrite `.vue` SFC imports) is NOT fixed here — it's a separate P2 item in handoff.
- `enumerateSourceFiles` moved to `move-directory.ts`, colocated with its caller.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files (76.92% for new files)
- [x] `pnpm check` passes — 765 tests passing
- [x] Docs updated:
      - `docs/architecture.md` — `moveDirectory` added as action, `afterFileRename`/`tsMoveDirectory` noted in layer diagram, `VolarCompiler` → `VolarEngine` throughout
      - `docs/handoff.md` — P1 entry removed; current-state `compiler.ts` → `engine.ts`; rename limitation added as [needs design]
      - `docs/features/rename.md` — constraint added: files outside `tsconfig.include` not updated
- [x] Tech debt: `rename` misses files outside project graph added to handoff.md as [needs design]
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

### Reflection

Went smoothly — the pattern from `tsMoveFile` transferred cleanly. The key non-obvious detail was the early-return removal: the original `TsMorphEngine.moveDirectory()` returned early with `{ filesMoved: [] }` when no source files existed (non-source-only directories). With the non-source file loop absorbed into `tsMoveDirectory`, the early return had to go — the OS rename must always run so non-source-only directories move atomically. This fell out naturally once the abstraction was clear.

AC3 (VolarCompiler → VolarEngine rename) surfaced an important tool limitation: `mcp__light-bridge__rename` only updated 5 of ~76 locations. It missed all test files because they're outside the TS project graph (`tsconfig.include` doesn't cover test files). A `replaceText` sweep was needed for the remaining 71. This is now documented in `docs/features/rename.md` and the handoff. Dynamic imports (`import("./compiler.js")`) were also missed by `moveFile` — expected, since `moveFile` only rewrites static imports.

`engine.ts` reduced from 483 → 385 lines (cleared the 500-line hard flag by extracting `tsMoveDirectory`, `tsAfterFileRename`, and `enumerateSourceFiles`).

### Tests added

- `src/ts-engine/after-file-rename.test.ts` — new (extracted from engine.test.ts)
- `src/ts-engine/move-directory.test.ts` — new unit tests for `tsMoveDirectory`
- 765 total tests passing (up from 744)

### Architectural decisions

- `getCachedProjectForFile()` added to `TsMorphEngine` to give `tsAfterFileRename` clean access to the project cache without bracket-notation private access.
- `enumerateSourceFiles` moved to `move-directory.ts` (only caller after the extraction).
