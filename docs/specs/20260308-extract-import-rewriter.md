# Extract ImportRewriter

**type:** change
**date:** 2026-03-08
**tracks:** handoff.md # compiler adapter restructure step 4 → docs/target-architecture.md

---

## Context

Import rewriting for symbol moves is implemented three times: in `ts-move-symbol.ts` (ts-morph AST on in-project files), in `TsProvider.afterSymbolMove` (throwaway ts-morph projects for out-of-project files), and in `plugins/vue/scan.ts` (regex-based for Vue SFCs). All three do the same thing: given a set of files, rewrite named imports/re-exports of `symbolName` from `oldSource` to `newSource`, handling full-move vs partial-move (split) and merging with existing imports from the destination. This is step 4 of the compiler adapter restructure described in `docs/target-architecture.md`.

## User intent

*As a contributor to light-bridge, I want import rewriting logic consolidated into a single `ImportRewriter` domain service, so that bug fixes and enhancements (e.g. handling `export { }` in Vue, handling aliased imports) apply everywhere without maintaining three copies.*

## Relevant files

- `src/providers/ts-move-symbol.ts` — implementation 1: `rewriteImporters()` (lines 66-105), uses ts-morph AST on SourceFile objects already in the project
- `src/providers/ts.ts` — implementation 2: `afterSymbolMove()` (lines 240-327), creates throwaway in-memory ts-morph projects per file; also contains `matchesSourceFile()` and `toRelBase`/extension-matching helpers
- `src/plugins/vue/scan.ts` — implementation 3: `rewriteNamedSymbolImport()` (lines 116-152), regex-based; only handles `import`, not `export`
- `src/domain/workspace-scope.ts` — `WorkspaceScope`, already extracted in steps 1-3; the rewriter should use it for boundary checks and modification tracking
- `src/ports/filesystem.ts` — `FileSystem` interface; the rewriter should use it for reads/writes instead of direct `node:fs`
- `src/utils/relative-path.ts` — `computeRelativeImportPath` and `toRelBase`; shared path computation used by all three implementations
- `tests/providers/ts-move-symbol.test.ts` (225 lines) — tests for implementation 1
- `tests/providers/ts-after-symbol-move.test.ts` (143 lines) — tests for implementation 2

### Red flags

- **Impl 1 vs impl 2 feature gap:** Implementation 1 (`rewriteImporters`) handles only `ImportDeclaration`. Implementation 2 (`afterSymbolMove`) handles both `ImportDeclaration` and `ExportDeclaration` (re-exports). The unified rewriter must handle both.
- **Impl 3 feature gap:** Vue `rewriteNamedSymbolImport` only handles `import { }`, not `export { } from`. Vue SFCs rarely re-export, but the rewriter should not silently ignore re-exports in `.vue` files if they exist.
- **Impl 2 uses raw `fs` and raw `isWithinWorkspace`:** `afterSymbolMove` bypasses the `FileSystem` port and `WorkspaceScope`. The unified rewriter should use both.
- **Impl 2 does not receive `WorkspaceScope`:** The `afterSymbolMove` signature on `LanguageProvider` takes `workspace: string` and `alreadyModified: ReadonlySet<string>` instead of `WorkspaceScope`. This signature must be updated as part of this work (it was deferred from step 3).
- **Test files are within budget** but test the wrong thing at the wrong layer: Both test files are well under 300 lines, but all import-rewrite tests today require the real filesystem — `mkdtempSync`, `copyFixture`, tsconfig setup, `TsProvider` boot, `readFileSync` assertions, `afterEach` cleanup. This is heavyweight ceremony for string-in → string-out logic. Once `ImportRewriter` exists as a domain service, the rewrite matrix (full-move, partial-move, merge, re-export, extension variants) should be tested directly against `InMemoryFileSystem`. The existing integration tests in `ts-move-symbol.test.ts` and `ts-after-symbol-move.test.ts` should be thinned to verify orchestration only — they no longer need to exhaustively cover import-rewrite edge cases that the unit tests handle.

## Value / Effort

- **Value:** Three implementations means three places to fix any bug in import rewriting (e.g. aliased imports, extension handling). The Vue implementation silently ignores re-exports. Consolidation eliminates this class of divergence bugs permanently and makes future enhancements (e.g. `type`-only imports, `as` aliases) single-site changes.
- **Effort:** Moderate. The core logic is well-understood (same algorithm in all three). The main work is: (1) designing a single entry point that works for both AST-based and text-based callers, (2) migrating `afterSymbolMove` to use `WorkspaceScope`, (3) writing unit tests for the unified rewriter with `InMemoryFileSystem`. Touches 4-5 source files and 2-3 test files.

## Behaviour

- [ ] **AC1: `ImportRewriter` domain service with unit tests.** `ImportRewriter.rewrite(files, symbolName, oldSource, newSource, scope)` is a standalone domain service in `src/domain/import-rewriter.ts`. It has its own unit test file using `InMemoryFileSystem` — no temp dirs, no tsconfig, no ts-morph project boot. The unit tests cover the full rewrite matrix: (a) full-move (all named imports match → repoint specifier), (b) partial-move (split: remove symbol from old import, add new import from dest), (c) merge with existing destination import, (d) `export { symbolName } from` re-exports (same full/partial logic), (e) no-op when file doesn't import the symbol, (f) no-op when file imports oldSource but not symbolName, (g) out-of-workspace file recorded as skipped. These are the cases currently scattered across three test files behind heavyweight setup; they become direct assertions on the rewriter.

- [ ] **AC2: Wire `ImportRewriter` into `tsMoveSymbol` and `afterSymbolMove`.** `rewriteImporters()` in `ts-move-symbol.ts` and the file-walking rewrite loop in `TsProvider.afterSymbolMove` are replaced by calls to `ImportRewriter.rewrite()`. The `afterSymbolMove` signature on `LanguageProvider` changes from `(sourceFile, symbolName, destFile, workspace, alreadyModified)` returning `{ modified, skipped }` to `(sourceFile, symbolName, destFile, scope: WorkspaceScope)` returning `void`. The `moveSymbol` operation passes `scope` directly.

- [ ] **AC3: Wire `ImportRewriter` into Vue symbol-move scan.** `rewriteNamedSymbolImport()` in `scan.ts` is replaced by a call to `ImportRewriter.rewrite()` for the symbol-move case. `updateVueImportsAfterMove` and `removeVueImportsOfDeletedFile` are not touched.

- [ ] **AC4: Thin out integration tests.** `ts-move-symbol.test.ts` and `ts-after-symbol-move.test.ts` are refactored: import-rewrite edge cases (partial move, merge, re-export, extension variants) that are now covered by `ImportRewriter` unit tests are removed from the integration layer. The integration tests keep only what they uniquely verify — orchestration: symbol lookup, AST surgery, file saving, scope tracking, fallback-scan triggering. `moveSymbol_tsProvider.test.ts` end-to-end tests remain unchanged. No assertion weakened; coverage of rewrite logic improves because it moves from indirect integration paths to direct unit tests.

- [ ] **AC5: Observable behaviour unchanged.** `pnpm check` passes. No existing integration test assertion is weakened — tests may be restructured (moved to unit layer, setup simplified) but every behaviour previously asserted is still asserted somewhere.

## Interface

This is an internal refactoring. No MCP/CLI public surface changes.

### `ImportRewriter` class — `src/domain/import-rewriter.ts`

```typescript
class ImportRewriter {
  /**
   * Rewrite named imports and re-exports of `symbolName` from `oldSource`
   * to `newSource` across a set of files.
   *
   * For each file in `files`:
   * - If the file is outside the workspace, record it as skipped.
   * - If the file contains `import { symbolName } from 'oldSource'` (full):
   *   repoint the module specifier to newSource.
   * - If the file contains `import { symbolName, other } from 'oldSource'` (partial):
   *   remove symbolName from the existing import, add a new import from newSource.
   * - Same logic for `export { symbolName } from 'oldSource'` (re-exports).
   * - If the file already imports from newSource, merge into the existing declaration.
   *
   * @param files - Iterable of absolute file paths to scan.
   * @param symbolName - The named export being moved (e.g. "MyComponent").
   * @param oldSource - Absolute path of the file the symbol is moving FROM.
   * @param newSource - Absolute path of the file the symbol is moving TO.
   * @param scope - WorkspaceScope for boundary checks, reads, writes, and tracking.
   */
  rewrite(
    files: Iterable<string>,
    symbolName: string,
    oldSource: string,
    newSource: string,
    scope: WorkspaceScope,
  ): void;
}
```

**Parameter details:**

- `files` — absolute paths. May include `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`, or any text file. The rewriter must handle files that don't contain any matching import (no-op). The iterable may be large (hundreds of files in a monorepo walk); the rewriter processes one at a time, no buffering.
- `symbolName` — the exact export name, e.g. `"computeRelativeImportPath"`. Does not handle `default` exports or `* as ns` imports. Does not handle aliased imports (`import { foo as bar }`) in this spec — that's a future enhancement.
- `oldSource` / `newSource` — absolute file paths with extensions. The rewriter computes relative specifiers internally using `computeRelativeImportPath`.
- `scope` — provides `scope.fs.readFile()` for reading, `scope.writeFile()` for writing (which also records modified), `scope.contains()` for boundary checks, `scope.recordSkipped()` for out-of-boundary files.

**Zero/empty cases:**
- Empty `files` iterable: no-op, no files modified.
- File that doesn't import from `oldSource`: no-op for that file.
- File that imports `oldSource` but not `symbolName`: no-op for that file.

**Implementation strategy decision — AST vs regex:**

The executor must decide between two approaches:
1. **AST-only:** Use temporary in-memory ts-morph projects for all files (TS and Vue `<script>` blocks). Consistent, handles edge cases, but heavier.
2. **AST for TS, regex for Vue:** Keep the regex approach for `.vue` files since parsing SFC script blocks with ts-morph requires extracting the `<script>` content first.

The spec does not prescribe which approach — the executor should choose based on implementation complexity. The key constraint is: the rewrite logic (full-move vs partial-move, merge with existing, handle re-exports) must be shared, not duplicated.

### `LanguageProvider.afterSymbolMove` signature change

```typescript
// Before:
afterSymbolMove(
  sourceFile: string,
  symbolName: string,
  destFile: string,
  workspace: string,
  alreadyModified?: ReadonlySet<string>,
): Promise<{ modified: string[]; skipped: string[] }>;

// After:
afterSymbolMove(
  sourceFile: string,
  symbolName: string,
  destFile: string,
  scope: WorkspaceScope,
): Promise<void>;
```

The return type changes to `void` because `scope` now tracks modified/skipped internally. The `alreadyModified` parameter is eliminated — `scope.modified` already contains those files, and the rewriter can check `scope.modified` (or the caller can filter the file list) to avoid double-rewriting.

## Security

- **Workspace boundary:** The rewriter reads and writes files. All writes go through `scope.writeFile()`, which enforces the workspace boundary via `isWithinWorkspace`. Files outside the boundary are recorded as skipped, not modified. No new bypass path is introduced.
- **Sensitive file exposure:** The rewriter reads file content to parse imports. It does not expose file content in responses — it only modifies import lines in place. No call to `isSensitiveFile` is needed because the rewriter only touches files that contain import/export declarations referencing the moved symbol.
- **Input injection:** `symbolName`, `oldSource`, and `newSource` are used to match and construct import specifiers. `symbolName` is matched as an identifier (not interpolated into a regex without escaping). Path values go through `computeRelativeImportPath`, which uses `path.relative` — no shell interpolation risk.
- **Response leakage:** N/A — this is an internal domain service, not a transport-facing API.

## Edges

- **Must not touch `afterFileRename`.** File-move import rewriting (`afterFileRename` in `TsProvider`, `updateVueImportsAfterMove` in `scan.ts`) is a different pattern (rewrite *all* imports from oldPath, not just one symbol). It is out of scope for this spec.
- **Must not change the `rewriteImporters` caller contract in `tsMoveSymbol`.** The function `tsMoveSymbol` currently calls `snapshotImporters` (which returns ts-morph AST nodes) then `rewriteImporters`. The ImportRewriter may need to accept pre-snapshotted AST data or re-snapshot internally. The key constraint: `tsMoveSymbol` must still snapshot importers *before* removing the declaration from the source file (AST references become invalid after removal).
- **`alreadyModified` filtering must be preserved.** The current `afterSymbolMove` skips files in `alreadyModified`. After migration, the same filtering must happen — either by checking `scope.modified` before rewriting, or by passing a pre-filtered file list. Double-rewriting a file must not occur.
- **Extension matching must be preserved.** The `afterSymbolMove` fallback uses `matchesSourceFile` / `toRelBase` to match specifiers with or without extensions (`.js`, `.ts`, bare). The ImportRewriter must handle the same specifier forms. The `isCoexistingJsFile` check (suppress rewrite when a real `.js` file exists) must also be preserved.
- **`removeVueImportsOfDeletedFile` and `updateVueImportsAfterMove` are not touched.** These are file-move and file-delete operations in `scan.ts`, not symbol-move. They remain as-is.

## Done-when

- [ ] All ACs verified by tests
- [ ] `ImportRewriter` unit tests use `InMemoryFileSystem` — no temp dirs, no tsconfig, no cleanup
- [ ] Unit tests cover the full rewrite matrix (AC1 items a-g)
- [ ] Integration tests (`ts-move-symbol.test.ts`, `ts-after-symbol-move.test.ts`) thinned: no import-rewrite edge cases that duplicate unit coverage
- [ ] Integration tests still verify orchestration paths (symbol lookup, AST surgery, fallback-scan triggering)
- [ ] `moveSymbol_tsProvider.test.ts` end-to-end tests pass unchanged
- [ ] Mutation score >= threshold for `src/domain/import-rewriter.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed: N/A (internal refactoring)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
