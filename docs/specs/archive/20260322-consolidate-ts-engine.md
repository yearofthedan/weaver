# Consolidate `compilers/` and `domain/` into `ts-engine/`

**type:** change
**date:** 2026-03-22
**tracks:** handoff.md # `domain/` and `compilers/` consolidation after engine migration

---

## Context

The engine layer migration is complete. All action functions now live in `src/ts-engine/` — but two directories still hold code that logically belongs there: `src/compilers/` (standalone TS helpers and `tsMoveSymbol`) and `src/domain/` (import rewriters, `applyRenameEdits`). The cross-directory imports today tell the story: `ts-engine/engine.ts` imports from `compilers/`, `ts-engine/*.ts` files import from `domain/`, `domain/*.ts` files import from `compilers/`. All of this belongs in one place.

## User intent

*As a contributor to light-bridge, I want all TypeScript-engine logic in `src/ts-engine/`, so that the directory layout reflects the actual dependency graph and navigating to any compiler helper is predictable.*

## Behaviour

- [x] **AC1: Move all of `compilers/` into `ts-engine/`.** Source files (`throwaway-project.ts`, `symbol-ref.ts`, `ts-move-symbol.ts` → `move-symbol.ts`), test files (6 moves + 1 merge), mock helper (`__helpers__/mock-compiler.ts` → `__testHelpers__/mock-compiler.ts`). Renamed `src/ports/__helpers__/` → `src/ports/__testHelpers__/`. Deleted `src/compilers/`. All import paths updated.

- [x] **AC2: Move `domain/` ts-engine-facing files into `ts-engine/`.** `import-rewriter.ts`, `rewrite-own-imports.ts`, `rewrite-importers-of-moved-file.ts`, `apply-rename-edits.ts` + tests. Cleaned up stale `notifyFileWritten: vi.fn()` in `deleteFile.test.ts`. `domain/` now contains only `workspace-scope.ts`.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (Stryker blocked by pnpm store ENOENT in this environment)
- [x] `pnpm check` passes — 775 + 29 tests green
- [x] Docs updated: `docs/architecture.md`, `docs/handoff.md`
- [x] No new tech debt discovered
- [x] No gotchas worth capturing
- [x] Spec archived with Outcome section

---

## Outcome

**Tests:** 775 unchanged — pure file moves, no logic changes, no new tests needed.

**Mutation score:** Blocked by pre-existing Stryker pnpm store ENOENT.

**What was moved:**
- `src/compilers/` → dissolved into `src/ts-engine/`: `throwaway-project.ts`, `symbol-ref.ts`, `ts-move-symbol.ts` (→ `move-symbol.ts`), 5 test files, `ts-moveDirectory.test.ts` merged into `ts-engine/move-directory.test.ts`
- `src/domain/` → 4 files moved to `src/ts-engine/`: `import-rewriter.ts`, `rewrite-own-imports.ts`, `rewrite-importers-of-moved-file.ts`, `apply-rename-edits.ts`
- `src/ports/__helpers__/` and `src/compilers/__helpers__/` → both renamed to `__testHelpers__` for consistency with root `src/__testHelpers__/`

**Architectural decisions:**
- `ts-move-symbol.ts` renamed to `move-symbol.ts` on move — the `ts-` prefix is redundant inside `ts-engine/`, consistent with `move-file.ts`, `move-directory.ts`, `rename.ts`, etc.
- `compilers/ts-moveDirectory.test.ts` merged into `ts-engine/move-directory.test.ts` as a second `describe("TsMorphEngine.moveDirectory")` block. The two blocks cover different entry points: standalone function vs. delegation method. Keeping them together makes it easy to see both layers tested in one file.
- `workspace-scope.ts` stays in `domain/` — it's imported by operations, plugins, ports, and ts-engine. It has no single owner.
- `apply-rename-edits.ts` moved (not deleted) — still actively called by `tsMoveFile` and `tsMoveDirectory`.
- `mcp__light-bridge__moveFile` handled compiler-aware import updates for all source file moves. Manual edits were only needed for the test file merge and the `__helpers__` → `__testHelpers__` renames.

**Reflection:**
- Both ACs were clean and fast. The move tool handled nearly all import path updates automatically.
- The `__helpers__` vs `__testHelpers__` inconsistency was a good catch — now `__testHelpers__` is the single convention everywhere in the project.
- `src/ts-engine/` is now the authoritative location for all TypeScript compiler logic. Future contributors only need to look in one place.
