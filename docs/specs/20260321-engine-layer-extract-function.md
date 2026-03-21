# Engine layer: `extractFunction` action

**type:** change
**date:** 2026-03-21
**tracks:** handoff.md # Engine layer: extractFunction action → docs/architecture.md

---

## Context

Fifth spec in the engine layer migration. `deleteFile`, `moveFile`, `moveSymbol`, and `moveDirectory` established the pattern: standalone action function in `ts-engine/`, full-workflow method on `Engine`, operation becomes validate + delegate. This spec migrates `extractFunction` — the operation currently owns the full compiler workflow (offset calculation, language service calls, name substitution, cache invalidation). After this spec the operation is two lines, and the compiler logic lives in `ts-engine/` alongside its peers.

## User intent

*As a contributor to light-bridge, I want `extractFunction` to be a full-workflow action on the `Engine` interface, so that the operation is validate + delegate and compiler logic lives behind the engine abstraction like every other action.*

## Relevant files

- `src/operations/extractFunction.ts` — 153 lines; the full compiler workflow moves out of here
- `src/operations/extractFunction.test.ts` — 265 lines; 7 of 9 tests belong at the ts-engine layer after the migration
- `src/ts-engine/engine.ts` — `TsMorphEngine`; gains `extractFunction()` delegation method; `getFunction()` and `getLanguageServiceForFile()` stay (used by `tsExtractFunction`)
- `src/ts-engine/types.ts` — `Engine` interface; gains `extractFunction()`; `ExtractFunctionResult` moves here from `operations/types.ts`
- `src/ts-engine/move-file.ts` — reference implementation: standalone action function pattern
- `src/operations/types.ts` — `ExtractFunctionResult` moves to `ts-engine/types.ts`; re-exported from here for existing callers
- `src/plugins/vue/engine.ts` — `VolarEngine` (renamed from `VolarCompiler` in the moveDirectory spec); gains `extractFunction()` implementing NOT_SUPPORTED for `.vue`, delegate for TS
- `src/compilers/__helpers__/mock-compiler.ts` — needs `extractFunction` mock entry
- `src/daemon/dispatcher.ts` — switches from `registry.tsEngine()` to `registry.projectEngine()` for `extractFunction`

### Red flags

- `src/operations/extractFunction.test.ts` is 265 lines — below the 300-line review threshold, but most tests are at the wrong layer. The migration naturally fixes this: 7 tests move to `ts-engine/extract-function.test.ts`, leaving ~30–40 lines at the operation layer. No pre-cleanup needed.

## Value / Effort

- **Value:** Completes the engine migration for the last unmirgated action. The operation is 153 lines of compiler orchestration; after this spec it is ~5 lines. VolarEngine gets a proper `NOT_SUPPORTED` path at the right layer rather than the operation guarding it.
- **Effort:** Low. Established pattern, no new infrastructure. Two new files (`ts-engine/extract-function.ts`, `ts-engine/extract-function.test.ts`), two files simplified (operation + dispatcher), one type relocated.

## Behaviour

- [ ] **AC1: Create `tsExtractFunction()`, delegate from `TsMorphEngine`, add to `Engine` interface, implement in VolarEngine.**

  Create `src/ts-engine/extract-function.ts` exporting:
  ```typescript
  export async function tsExtractFunction(
    engine: TsMorphEngine,
    file: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    functionName: string,
    scope: WorkspaceScope,
  ): Promise<ExtractFunctionResult>
  ```
  Body inlines the compiler workflow from `operations/extractFunction.ts`: `lineColToOffset`, language service calls (`getApplicableRefactors`, `getEditsForRefactor`), `function_scope_N` action selection, generated-name substitution, `scope.writeFile`, `engine.invalidateProject` + `engine.getFunction`. The `.vue` early-return is removed from the operation and does NOT move here — it belongs in `VolarEngine` (see below).

  Move `ExtractFunctionResult` from `src/operations/types.ts` to `src/ts-engine/types.ts` (consistent with `MoveFileActionResult`, `DeleteFileActionResult`). Re-export it from `src/operations/types.ts` so existing imports are unbroken.

  Add `extractFunction()` to the `Engine` interface in `src/ts-engine/types.ts`:
  ```typescript
  extractFunction(
    file: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    functionName: string,
    scope: WorkspaceScope,
  ): Promise<ExtractFunctionResult>;
  ```

  `TsMorphEngine.extractFunction()` becomes a 1-line delegate: `return tsExtractFunction(this, file, startLine, startCol, endLine, endCol, functionName, scope)`.

  `VolarEngine.extractFunction()`: throws `EngineError("extractFunction is not supported for .vue files; use a .ts or .tsx file", "NOT_SUPPORTED")` for `.vue` paths; delegates to `this.tsEngine.extractFunction(...)` for all other paths.

  Add `extractFunction: vi.fn().mockResolvedValue({ filesModified: [], filesSkipped: [], functionName: "", parameterCount: 0 })` to `mock-compiler.ts`.

  Create `src/ts-engine/extract-function.test.ts` by moving the 7 compiler-behaviour tests from `operations/extractFunction.test.ts`: creates function and replaces selection with call; filesModified contains exactly the source file; parameterCount reflects compiler inference; parameterCount is 0 when no outer refs; extracted function uses provided name; both declaration and call site use provided name; NOT_SUPPORTED when no extractable code at range. Tests call `tsExtractFunction` directly. Add one test: VolarEngine.extractFunction throws NOT_SUPPORTED for a `.vue` path.

  All remaining tests in `operations/extractFunction.test.ts` continue to pass.

- [ ] **AC2: Simplify the `extractFunction` operation and update the dispatcher.**

  `src/operations/extractFunction.ts` becomes:
  ```typescript
  export async function extractFunction(
    engine: Engine,
    file: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    functionName: string,
    scope: WorkspaceScope,
  ): Promise<ExtractFunctionResult> {
    assertFileExists(file);
    return engine.extractFunction(file, startLine, startCol, endLine, endCol, functionName, scope);
  }
  ```
  Remove: `.vue` check, `lineColToOffset` calls, all language service logic. Signature changes from `(tsCompiler: TsMorphEngine, ...)` to `(engine: Engine, ...)`.

  `src/daemon/dispatcher.ts`: replace `registry.tsEngine()` with `registry.projectEngine()` for the `extractFunction` handler.

  Shrink `operations/extractFunction.test.ts` to two tests: FILE_NOT_FOUND for a missing source file; and a mock-engine wiring test (engine.extractFunction is called with the correct arguments and its return value is returned). Delete the 7 tests moved in AC1.

  `pnpm check` passes.

## Interface

**`Engine.extractFunction()` parameters:**

- `file` — absolute path to the source file. `.ts` or `.tsx`. The engine throws `NOT_SUPPORTED` for `.vue`; the operation throws `FILE_NOT_FOUND` if the path does not exist.
- `startLine`, `startCol`, `endLine`, `endCol` — 1-based line/column coordinates of the selection, inclusive. `endCol` points at the last character of the selection (same convention as the current operation).
- `functionName` — the desired name for the extracted function. Replaces whatever name the TypeScript compiler auto-generates. No validation — the compiler will produce a parse error if the name is invalid, which surfaces as `NOT_SUPPORTED`.
- `scope` — workspace boundary and file I/O; edits are written through `scope.writeFile`.

**Return (`ExtractFunctionResult`):**
- `filesModified` — absolute paths of files written. Always exactly one entry (the source file) for a successful extraction.
- `filesSkipped` — files the compiler wanted to edit but were outside the workspace boundary. Always empty in practice (extractFunction is single-file), but preserved for interface consistency.
- `functionName` — echoes the caller-provided name.
- `parameterCount` — number of parameters on the extracted function as inferred by the compiler. Zero when the selection has no outer-scope references.

## Open decisions

None. Pattern is established by `tsMoveFile` / `tsMoveDirectory`. `VolarEngine` delegates to `tsEngine` for non-`.vue` files (same as `moveSymbol`).

## Security

- **Workspace boundary:** No change. `assertFileExists` stays in the operation. All writes go through `scope.writeFile`, which enforces the workspace boundary. No new file paths introduced.
- **Sensitive file exposure:** N/A — no file content surfaces in responses.
- **Input injection:** N/A — no new string parameters reach the filesystem or shell beyond those already validated.
- **Response leakage:** N/A — no new response fields.

## Edges

- `getFunction()` and `getLanguageServiceForFile()` stay on `TsMorphEngine` (not on `Engine`) — `tsExtractFunction` takes `TsMorphEngine` directly, same as `tsMoveFile`.
- The `renameLocation`-based name detection in the current operation (reading the post-edit buffer to find the generated identifier) moves verbatim into `tsExtractFunction`. No change to the algorithm.
- `notifyFileWritten` is NOT removed by this spec — that is deferred to the `rename` spec, which is explicitly last in the ordering. `tsExtractFunction` does not call `notifyFileWritten`.
- VolarEngine's `NOT_SUPPORTED` for `.vue` is tested at the unit level (AC1). The MCP integration test for `extractFunction` (TS path) must continue to pass.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/architecture.md` — Engine interface section: `extractFunction` marked as action
      - `docs/handoff.md` — P1 entry removed; current-state section unchanged (no file layout change)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
