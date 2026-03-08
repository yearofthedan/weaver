# Migrate `moveSymbol` to `WorkspaceScope` and extract compiler work into `TsProvider`

**type:** change
**date:** 2026-03-08
**tracks:** handoff.md # Target architecture step 3 → docs/target-architecture.md

---

## Context

Steps 1-2 of the target architecture migration introduced `FileSystem` port and `WorkspaceScope`, proving the pattern on `rename` and `moveFile`. `moveSymbol` is the most complex operation — 224 lines doing six jobs: symbol lookup, destination prep, importer snapshot, AST surgery, import rewriting, file persistence. It imports directly from `ts-morph` and calls `tsProvider.getProjectForFile()`, breaking the provider abstraction. The operation also does manual `Set<modified>` / `Set<skipped>` / `isWithinWorkspace` bookkeeping and direct `fs` calls.

Step 3 of the target architecture moves the compiler work behind the provider abstraction and migrates the operation to `WorkspaceScope`, making it a thin orchestrator like `rename` and `moveFile`.

## User intent

*As a contributor, I want `moveSymbol`'s compiler work behind the `TsProvider` abstraction and its boundary tracking via `WorkspaceScope`, so that the operation is a thin orchestrator, the provider boundary is real, and the pattern matches `rename`/`moveFile`.*

## Behaviour

- [x] **AC1: Compiler work moves from `moveSymbol` operation into `TsProvider`.** A new method `TsProvider.moveSymbol(sourceFile, symbolName, destFile, scope: WorkspaceScope, options?)` absorbs the compiler work. Implementation lives in `src/providers/ts-move-symbol.ts` (TsProvider delegates). Uses `scope.contains()` / `scope.recordModified()` / `scope.recordSkipped()` for boundary tracking. Uses `scope.fs.exists()` / `scope.fs.mkdir()` for destination directory creation.

- [x] **AC2: `moveSymbol` operation becomes a thin orchestrator using `WorkspaceScope`.** ~50 lines. Signature accepts `scope: WorkspaceScope`. No `ts-morph` imports, no `fs` imports, no `isWithinWorkspace` import.

- [x] **AC3: Dispatcher constructs `WorkspaceScope` for `moveSymbol`.** Same pattern as `rename` and `moveFile` entries.

- [x] **AC4: Test files restructured — complexity tested at the lowest level.** Bulk of edge-case tests moved to `tests/providers/ts-move-symbol*.test.ts` testing `tsMoveSymbol()` directly. Operation-level tests are unit tests with mocks. Light integration tests in `moveSymbol_tsProvider.test.ts`. `afterSymbolMove` fallback tests moved to `tests/providers/ts-after-symbol-move.test.ts` calling the method directly. All files under 300 lines.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Existing integration tests pass with unchanged assertions
- [x] `moveSymbol` operation has zero imports from `ts-morph`, `node:fs`, or `../security.js`
- [x] All test files under 300 lines
- [x] `docs/architecture.md` updated
- [x] `docs/handoff.md` current-state section updated
- [x] `afterSymbolMove` fallback test placement fixed (not deferred — done in-session)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Reflection

**What went well:** The established pattern from steps 1-2 made AC1-AC3 mechanical — the execution agent could follow the same shape. AC2+AC3 were correctly combined into one commit since the signature change and dispatcher update are coupled.

**What did not go well:** The original AC4 spec had edge-case tests at the wrong layer — testing `tsMoveSymbol()` complexity through the operation integration path. The user caught this and redirected: test complexity where the logic lives, prove integration with a fixture. This should have been in the original spec design.

The spec also said "moveSymbol-fallback.test.ts stays as-is" without assessing whether that was correct. The user caught that `TsProvider.afterSymbolMove` — a substantial 80-line public method — was: (a) incorrectly described as a no-op in architecture docs, (b) only tested through the operation layer, (c) had a trivial "no-op" test in `ts.test.ts` masking the problem. The spec should have audited existing test placement, not rubber-stamped it.

**What I wish I'd known:** When restructuring tests, audit every existing test file for layer correctness — don't just move what the spec says to move. "Stays as-is" is a decision that needs justification, not a default.

**What took longer than it should have:** The tech debt was initially written as a handoff deferral. The user correctly pushed back — this was discovered during the migration, it was small, and deferring it violates the girl guides principle (leave the campsite cleaner than you found it). Should have fixed it immediately without being asked.

**Recommendation for next agent:** When speccing test restructures, ask: "for each test file, does its test target match the layer it lives in?" If a `tests/operations/` file is testing provider methods, that's a red flag even if the spec doesn't mention it.

## Outcome

**Tests:** 563 total (up from ~555). Test files restructured:
- `tests/providers/ts-move-symbol.test.ts` (255 lines) — core compiler behaviour
- `tests/providers/ts-move-symbol-imports.test.ts` (159 lines) — import rewriting
- `tests/providers/ts-move-symbol-errors.test.ts` (248 lines) — errors + force flag
- `tests/providers/ts-after-symbol-move.test.ts` (163 lines) — fallback scan, tested directly
- `tests/operations/moveSymbol.test.ts` (189 lines) — orchestrator unit tests with mocks
- `tests/operations/moveSymbol_tsProvider.test.ts` (96 lines) — light integration
- `tests/operations/moveSymbol_volarProvider.test.ts` (40 lines) — Vue integration

**Deleted:** `moveSymbol-fallback.test.ts` (wrong layer), `moveSymbol-helpers.ts` (unused after restructure).

**Mutation scores:** `ts-move-symbol.ts` 83.90%, `moveSymbol.ts` 100%.

**Architectural decisions:**
- AC4 was revised mid-flight: original spec had edge-case tests at the operation integration level (`moveSymbol_tsProvider.test.ts`). Revised to push complexity tests DOWN to `ts-move-symbol.test.ts` — test at the lowest level where the logic lives, prove integration with a fixture.
- `afterSymbolMove` fallback test placement was discovered as tech debt during implementation. Instead of deferring to handoff, fixed in the same session: tests moved from `tests/operations/` to `tests/providers/`, calling `afterSymbolMove` directly. The architecture doc's incorrect "no-op" description was also corrected.
- `moveSymbol-helpers.ts` became unused after the restructure (provider-level tests are self-contained). Deleted rather than left as dead code.

**Surprising:** The architecture doc described `TsProvider.afterSymbolMove` as "a no-op" — it's actually an 80-line fallback scan. The trivial test in `ts.test.ts` reinforced this misconception. Both fixed.
