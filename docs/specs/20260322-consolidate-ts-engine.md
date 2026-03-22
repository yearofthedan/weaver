# Consolidate `compilers/` and `domain/` into `ts-engine/`

**type:** change
**date:** 2026-03-22
**tracks:** handoff.md # `domain/` and `compilers/` consolidation after engine migration

---

## Context

The engine layer migration is complete. All action functions now live in `src/ts-engine/` — but two directories still hold code that logically belongs there: `src/compilers/` (standalone TS helpers and `tsMoveSymbol`) and `src/domain/` (import rewriters, `applyRenameEdits`). The cross-directory imports today tell the story: `ts-engine/engine.ts` imports from `compilers/`, `ts-engine/*.ts` files import from `domain/`, `domain/*.ts` files import from `compilers/`. All of this belongs in one place.

## User intent

*As a contributor to light-bridge, I want all TypeScript-engine logic in `src/ts-engine/`, so that the directory layout reflects the actual dependency graph and navigating to any compiler helper is predictable.*

## Relevant files

**Moving from `compilers/` (AC1):**
- `src/compilers/throwaway-project.ts` — creates in-memory ts-morph projects for one-off AST parsing; imported by `ts-engine/remove-importers.ts` and three domain files
- `src/compilers/symbol-ref.ts` — `SymbolRef` value object for resolved exports; imported by `ts-move-symbol.ts`
- `src/compilers/ts-move-symbol.ts` — `tsMoveSymbol()` standalone action; imports from `domain/import-rewriter.ts`
- `src/compilers/__helpers__/mock-compiler.ts` — `makeMockCompiler()` test helper; imported by 4 operation tests; moves to `ts-engine/__testHelpers__/`
- `src/ports/__helpers__/filesystem-conformance.ts` — conformance test suite; moves to `ports/__testHelpers__/`; 2 callers (`node-filesystem.test.ts`, `in-memory-filesystem.test.ts`)

**Moving from `domain/` (AC2):**
- `src/domain/import-rewriter.ts` — `ImportRewriter`; imports `throwaway-project` from `compilers/` (resolved after AC1 moves it to `ts-engine/`)
- `src/domain/rewrite-own-imports.ts` — `rewriteMovedFileOwnImports`; same `throwaway-project` dependency
- `src/domain/rewrite-importers-of-moved-file.ts` — `rewriteImportersOfMovedFile`; same dependency
- `src/domain/apply-rename-edits.ts` — `applyRenameEdits`; still actively called by `tsMoveFile` and `tsMoveDirectory`; moves, does not get deleted

**Staying put:**
- `src/domain/workspace-scope.ts` — genuinely cross-cutting; used by operations, plugins, ports, and ts-engine equally

**Key callers to update:**
- `ts-engine/engine.ts` — imports `tsMoveSymbol` from `compilers/`
- `ts-engine/remove-importers.ts` — imports `createThrowawaySourceFile` from `compilers/`
- `plugins/vue/engine.ts` — imports from `domain/` (import-rewriter, rewrite helpers)
- `ts-engine/after-file-rename.ts`, `move-file.ts`, `move-directory.ts` — import from `domain/`
- `operations/*.test.ts` (rename, moveFile, moveSymbol, moveDirectory_tsMorphCompiler) — import `makeMockCompiler` from `compilers/__helpers__/`

### Red flags

- `compilers/ts-moveDirectory.test.ts` (tests `TsMorphEngine.moveDirectory`) and `ts-engine/move-directory.test.ts` (tests `tsMoveDirectory` standalone) cover complementary concerns. Merge the former into the latter as a second `describe("TsMorphEngine.moveDirectory")` block rather than creating a new file.
- `compilers/ts-after-symbol-move.test.ts` tests the fallback scan inside `TsMorphEngine.moveSymbol`. No conflicting file in `ts-engine/`; can keep its name or rename to `move-symbol-fallback.test.ts`.
- `operations/deleteFile.test.ts` has a stale `notifyFileWritten: vi.fn()` in its mock stub — `notifyFileWritten` is no longer on the `Engine` interface. Clean up in AC2.

## Value / Effort

- **Value:** After this spec, `src/ts-engine/` is the single place to look for any TypeScript compiler helper. No more following cross-directory imports between `ts-engine/`, `compilers/`, and `domain/` to understand how a function works. Speeds up navigation and makes the dependency graph legible.
- **Effort:** Low-to-moderate. Pure file moves with import path updates — no logic changes. Two ACs, each leaves the build green. The main work is enumerating callers and updating paths. The `mcp__light-bridge__moveFile` tool can handle the heavy lifting.

## Behaviour

- [ ] **AC1: Move all of `compilers/` into `ts-engine/`.** Move the following, renaming where the `ts-` prefix would be redundant inside `ts-engine/`:
  - `compilers/throwaway-project.ts` → `ts-engine/throwaway-project.ts` (no rename)
  - `compilers/symbol-ref.ts` → `ts-engine/symbol-ref.ts` (no rename)
  - `compilers/ts-move-symbol.ts` → `ts-engine/move-symbol.ts` (drop `ts-` prefix)
  - `compilers/throwaway-project.test.ts` → `ts-engine/throwaway-project.test.ts`
  - `compilers/symbol-ref.test.ts` → `ts-engine/symbol-ref.test.ts`
  - `compilers/ts-move-symbol.test.ts` → `ts-engine/move-symbol.test.ts`
  - `compilers/ts-move-symbol-errors.test.ts` → `ts-engine/move-symbol-errors.test.ts`
  - `compilers/ts-move-symbol-imports.test.ts` → `ts-engine/move-symbol-imports.test.ts`
  - `compilers/ts-after-symbol-move.test.ts` → `ts-engine/move-symbol-fallback.test.ts`
  - `compilers/ts-moveDirectory.test.ts` — merge into `ts-engine/move-directory.test.ts` as a new `describe("TsMorphEngine.moveDirectory")` block alongside the existing `describe("tsMoveDirectory")` block. The two describe blocks test different entry points: standalone function vs. delegation method.
  - `compilers/__helpers__/mock-compiler.ts` → `ts-engine/__testHelpers__/mock-compiler.ts`

  Also normalize the remaining `__helpers__` directory: rename `src/ports/__helpers__/` → `src/ports/__testHelpers__/` and update the 2 callers (`ports/node-filesystem.test.ts`, `ports/in-memory-filesystem.test.ts`). After AC1, `__testHelpers__` is the single convention used everywhere.

  Update all import paths in callers:
  - `ts-engine/engine.ts`: `../compilers/ts-move-symbol.js` → `./move-symbol.js`
  - `ts-engine/remove-importers.ts`: `../compilers/throwaway-project.js` → `./throwaway-project.js`
  - `domain/import-rewriter.ts`: `../compilers/throwaway-project.js` → `../ts-engine/throwaway-project.js`
  - `domain/rewrite-own-imports.ts`: same
  - `domain/rewrite-importers-of-moved-file.ts`: same
  - `operations/rename.test.ts`, `operations/moveFile.test.ts`, `operations/moveSymbol.test.ts`, `operations/moveDirectory_tsMorphCompiler.test.ts`: `../compilers/__helpers__/mock-compiler.js` → `../ts-engine/__testHelpers__/mock-compiler.js`
  - All internal imports within the moved test files (e.g. `./ts-move-symbol.js` → `./move-symbol.js`)

  Delete the now-empty `src/compilers/` directory. `pnpm check` passes.

- [ ] **AC2: Move `domain/` ts-engine-facing files into `ts-engine/`.** Move:
  - `domain/import-rewriter.ts` → `ts-engine/import-rewriter.ts`
  - `domain/rewrite-own-imports.ts` → `ts-engine/rewrite-own-imports.ts`
  - `domain/rewrite-importers-of-moved-file.ts` → `ts-engine/rewrite-importers-of-moved-file.ts`
  - `domain/apply-rename-edits.ts` → `ts-engine/apply-rename-edits.ts`
  - Move their test files alongside (same names).

  Update all import paths in callers. After AC1, `throwaway-project.ts` is already in `ts-engine/`, so `import-rewriter.ts`'s import becomes same-directory (`./throwaway-project.js`). The key external callers:
  - `ts-engine/move-symbol.ts`: `../domain/import-rewriter.js` → `./import-rewriter.js`
  - `ts-engine/after-file-rename.ts`, `move-file.ts`, `move-directory.ts`: update domain/ imports to `./`
  - `plugins/vue/engine.ts`: update domain/ imports to `../ts-engine/`
  - Any remaining callers of `apply-rename-edits`, `rewrite-own-imports`, `rewrite-importers-of-moved-file`

  Also clean up: remove `notifyFileWritten: vi.fn()` from the mock stub in `operations/deleteFile.test.ts` — this property is no longer on the `Engine` interface.

  `domain/` now contains only `workspace-scope.ts` and its test. `pnpm check` passes.

## Interface

No public API changes. The MCP tool signatures, operation function signatures, and `Engine` interface are all unchanged. This is a source layout change only.

**Final `src/ts-engine/` additions** (files that weren't there before):
```
ts-engine/
  throwaway-project.ts        ← from compilers/
  symbol-ref.ts               ← from compilers/
  move-symbol.ts              ← from compilers/ts-move-symbol.ts
  import-rewriter.ts          ← from domain/
  rewrite-own-imports.ts      ← from domain/
  rewrite-importers-of-moved-file.ts ← from domain/
  apply-rename-edits.ts       ← from domain/
  __testHelpers__/
    mock-compiler.ts          ← from compilers/__helpers__/ (renamed to __testHelpers__)
```

**`src/domain/` after AC2:**
```
domain/
  workspace-scope.ts
  workspace-scope.test.ts
```

## Open decisions

None. Move order is determined by the dependency graph: `throwaway-project` has no internal dependencies so it can move first (AC1). `import-rewriter` depends on `throwaway-project`, so it moves second (AC2) once `throwaway-project` is in `ts-engine/`.

## Security

- **Workspace boundary:** N/A — pure file moves, no logic changes.
- **Sensitive file exposure:** N/A
- **Input injection:** N/A
- **Response leakage:** N/A

## Edges

- `workspace-scope.ts` stays in `domain/` permanently. It is imported by operations, plugins, ports, and ts-engine — it has no single home.
- `apply-rename-edits.ts` moves but is NOT dead code. It is still called by `tsMoveFile` and `tsMoveDirectory`.
- The `operations/moveDirectory_tsMorphCompiler.test.ts` file in `operations/` is not in scope — it tests the operation layer and its location is not obviously wrong (it tests via the operation entry point). Leave it.
- No exports are added or removed. All existing `import … from` statements in non-moved files must resolve after each AC.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/architecture.md` — layout section: `compilers/` removed, `ts-engine/` additions listed, `domain/` shows only `workspace-scope.ts`
      - `docs/handoff.md` — P1 entry removed; current-state layout updated
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to relevant docs or `.claude/MEMORY.md`
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
