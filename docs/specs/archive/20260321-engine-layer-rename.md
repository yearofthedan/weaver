# Engine layer: `rename` action

**type:** change
**date:** 2026-03-21
**tracks:** handoff.md # Engine layer: rename action → docs/architecture.md

---

## Context

Final spec in the engine layer migration. `deleteFile`, `moveFile`, `moveSymbol`, and `moveDirectory` established the pattern. This spec migrates `rename` — and is the last caller of `getRenameLocations` and `notifyFileWritten` on the `Engine` interface, so removing them here completes the migration. A `notifyFileWritten` call also exists in `applyRenameEdits`, but it is safe to drop: `applyRenameEdits` is only called from TsMorphEngine paths, and `TsMorphEngine.notifyFileWritten` is a no-op.

## User intent

*As a contributor to light-bridge, I want `rename` to be a single full-workflow action on the `Engine` interface, so that the operation doesn't orchestrate compiler internals, and `getRenameLocations` and `notifyFileWritten` are removed from the public `Engine` contract.*

## Relevant files

- `src/ts-engine/engine.ts` — `TsMorphEngine.getRenameLocations()` (~26 lines; becomes internal); `TsMorphEngine.notifyFileWritten()` (no-op; removed from interface)
- `src/ts-engine/types.ts` — `Engine` interface; loses `getRenameLocations`, `notifyFileWritten`; gains `rename`
- `src/plugins/vue/engine.ts` — `VolarEngine.getRenameLocations()` (~10 lines; becomes internal); `VolarEngine.notifyFileWritten()` (~4 lines; stays as private cache update); `VolarEngine.rename()` added (~same logic as current operation but calling internal methods and updating `fileContents` directly)
- `src/operations/rename.ts` — currently ~70 lines of orchestration; becomes validate + delegate (~10 lines)
- `src/operations/rename.test.ts` (237 lines) — operation-level unit tests; mock shape changes
- `src/domain/apply-rename-edits.ts` — calls `compiler.notifyFileWritten()`; must drop that call once it's off the interface
- `src/compilers/__helpers__/mock-compiler.ts` — loses `getRenameLocations`, `notifyFileWritten`; gains `rename`

### Red flags

- `src/ts-engine/engine.ts` is 385 lines — healthy. Removing `getRenameLocations` (~26 lines) reduces it further.
- `src/plugins/vue/engine.ts` is 273 lines — healthy. Adding `VolarEngine.rename()` (~25 lines) brings it to ~298, still under the 300 review threshold.
- `rename.test.ts` is 237 lines — below the 300-line review threshold. No prep needed.

## Value / Effort

- **Value:** Completes the engine layer migration. After this spec, `Engine` has no post-step hooks — only action methods and read-only queries. `applyRenameEdits` no longer needs `notifyFileWritten`. The `rename` operation becomes trivially simple.
- **Effort:** Low. Same pattern as `moveFile`. The main difference is that `VolarEngine.rename()` must inline the orchestration logic from the current operation (using its internal Volar language service + `fileContents` update) rather than calling `tsMoveFile`-style standalone function — because the TS rename path is already in `tsRename` and Vue uses a different language service.

## Behaviour

- [x] **AC1: Create `tsRename()` standalone function.** Create `src/ts-engine/rename.ts` exporting `tsRename(engine: TsMorphEngine, file, line, col, newName, scope): Promise<RenameResult>`. Full workflow: `engine.resolveOffset(file, line, col)` → internal `getRenameLocations` call on the TS language service → if `null`, throw `SYMBOL_NOT_FOUND` → determine `oldName` from first location's text span → group rename locations by file → for each file: boundary-check via `scope.contains()`, skip if out → `engine.readFile()` → `applyTextEdits()` → `scope.writeFile()`. Return `{ filesModified: scope.modified, filesSkipped: scope.skipped, symbolName: oldName, newName, locationCount: locs.length }`. `TsMorphEngine.rename()` becomes a 1-line thin delegate: `return tsRename(this, ...)`.

- [x] **AC2: Add `rename()` to `Engine` interface; remove `getRenameLocations` and `notifyFileWritten`.** `Engine.rename(file, line, col, newName, scope): Promise<RenameResult>`. Remove `getRenameLocations` and `notifyFileWritten` from the `Engine` interface. Remove the `compiler.notifyFileWritten()` call from `applyRenameEdits` in `src/domain/apply-rename-edits.ts` (safe — only TsMorphEngine paths call this function, and that impl is a no-op). `VolarEngine.rename()` implements the full workflow using its internal methods: `this.getService(file)` → internal `getRenameLocations` logic (Volar LS `findRenameLocations` + `translateLocations`) → for each location: boundary-check → `this.readFile()` → `applyTextEdits()` → `scope.writeFile()` → `service.fileContents.set(fileName, updated)` (direct cache update, replaces `notifyFileWritten`). `VolarEngine.notifyFileWritten()` stays as a private method (still needed internally by `getEditsForFileRename`-based paths — or can be kept as a class method for now). Remove `getRenameLocations` and `notifyFileWritten` from `makeMockCompiler()`, add `rename` mock.

- [x] **AC3: Simplify the `rename` operation to validate + delegate.** Operation becomes: `assertFileExists(filePath)` → `engine.rename(absPath, line, col, newName, scope)` → return result. Dispatcher already uses `projectEngine` — no change. Update operation-level tests: replace the multi-mock setup (`getRenameLocations` + `notifyFileWritten` mocks) with a single `engine` mock with a `rename` mock that returns a `RenameResult`.

## Interface

**`Engine` interface changes:**

```typescript
interface Engine {
  // Added:
  rename(
    file: string,
    line: number,
    col: number,
    newName: string,
    scope: WorkspaceScope,
  ): Promise<RenameResult>;

  // Removed:
  // getRenameLocations(file, offset): Promise<SpanLocation[] | null>
  // notifyFileWritten(path, content): void
}
```

**`tsRename` signature:**
```typescript
export async function tsRename(
  engine: TsMorphEngine,
  file: string,        // absolute path; must exist (validated by operation)
  line: number,        // 1-based line
  col: number,         // 1-based column
  newName: string,     // valid TS identifier (validated at MCP input layer)
  scope: WorkspaceScope,
): Promise<RenameResult>
```

**`RenameResult`:** unchanged — `{ filesModified, filesSkipped, symbolName, newName, locationCount }`.

**`applyRenameEdits` change:** drop `compiler.notifyFileWritten()` call. Signature unchanged — still takes `Engine` (uses `readFile`).

## Open decisions

None. `tsRename` takes `TsMorphEngine` directly (same as `tsMoveFile`). `VolarEngine.rename()` inlines the orchestration using its own internal methods — same composition as `VolarEngine.moveFile()` which calls `tsMoveFile` then does Vue-specific work, except here VolarEngine does the full rename workflow itself (Volar LS is the rename authority for Vue projects).

## Security

- **Workspace boundary:** No change. `assertFileExists` validates the source path in the operation. Boundary enforcement (`scope.contains()`) happens inside `tsRename` and `VolarEngine.rename()` — same as today.
- **Sensitive file exposure:** N/A — rename reads file content to apply text edits, but does not put content in responses (unchanged).
- **Input injection:** N/A — no new parameters.
- **Response leakage:** N/A — `symbolName` and `newName` in the response are already there today.

## Edges

- `getEditsForFileRename` stays on `TsMorphEngine` as a class method — it is called by `tsMoveFile` and `tsMoveDirectory`, which take `TsMorphEngine` directly. It is NOT on the `Engine` interface and is not touched by this spec.
- `VolarEngine.notifyFileWritten()` may stay as a private/non-interface class method if `VolarEngine.getEditsForFileRename()` or any internal path still needs it. If no internal caller remains after this spec, remove it entirely.
- `readFile` stays on the `Engine` interface — used by `applyRenameEdits` and queries.
- The MCP integration test for `rename` must continue to pass.
- Existing compiler-level tests (`engine.test.ts`) that test `getRenameLocations` directly must be updated to test `TsMorphEngine.rename()` instead.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (blocked: Stryker pnpm store sandbox ENOENT in this environment)
- [x] `pnpm check` passes (lint + build + test) — 774 + 29 tests green
- [x] Docs updated:
      - `docs/architecture.md` — Engine interface section: `rename` added as action, `getRenameLocations`/`notifyFileWritten` removed, migration complete note
      - `docs/handoff.md` — P1 entry removed; `domain/` cleanup note updated (migration now complete)
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to `docs/features/rename.md` (tsconfig.include constraint)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Tests added:** 10 in `src/ts-engine/rename.test.ts` (AC1); operation-level tests updated to use `rename` mock (AC3).

**Mutation score:** Could not verify — Stryker fails with ENOENT when copying pnpm store symlinks into its sandbox. Environment issue, not a code issue.

**Architectural decisions:**
- AC2 agent bundled a slice of AC3: removing `getRenameLocations` from the `Engine` interface caused a compile error in `operations/rename.ts`. The agent correctly simplified the operation in the AC2 commit to keep the build green, rather than leaving a broken state for AC3 to fix.
- `VolarEngine.rename()` inlines the full workflow using Volar LS internally, rather than calling a standalone `tsRename`-equivalent. This is correct: the Volar LS is the rename authority for Vue projects; the TS path (`tsRename`) would miss `.vue` SFC references.
- `VolarEngine.notifyFileWritten()` was removed from the `Engine` interface. `VolarEngine.rename()` updates `service.fileContents` directly (`service.fileContents.set(fileName, updated)`) — no need for the indirection.

**Deviations from spec:**
- Spec said `VolarEngine.notifyFileWritten()` "may stay as a private/non-interface class method if still needed internally." After AC2, no internal caller remained; the agent removed it entirely. Correct call.
- The `applyRenameEdits` ordering constraint note in handoff (requiring `notifyFileWritten` to stay until the rename spec) was resolved as planned — the rename spec was the last to go.

**Reflection:**
- The engine layer migration pattern is now complete and well-established: deleteFile → moveFile → moveSymbol → moveDirectory → rename. Each spec was identical in structure; future contributors can follow the same pattern for any new operation.
- The false "RENAME_NOT_ALLOWED test failure" entry added by an execution agent (caused by appending a scoped test path to the eval vitest command) required investigation before proceeding. Rule: a failing test is a broken build. Don't log a failing test as a `[needs design]` entry — investigate and fix it.
- `pnpm test <specific-file>` appends the file path to the eval vitest config command, causing "No test files found" false failures. Use `pnpm exec vitest run <file>` for scoped runs instead.
- The `domain/` cleanup (moving `import-rewriter.ts` etc. into `ts-engine/`) is now unblocked and captured as a [needs design] P1 entry.
