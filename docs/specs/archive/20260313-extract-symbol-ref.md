# Extract SymbolRef value object

**type:** change
**date:** 2026-03-13
**tracks:** handoff.md # target-architecture-step-6 → docs/target-architecture.md

---

## Context

Step 6 of the target architecture migration ([`docs/target-architecture.md`](../../target-architecture.md)). The `tsMoveSymbol` function in `src/compilers/ts-move-symbol.ts` inlines all symbol-resolution logic: looking up an exported declaration by name, unwrapping `VariableDeclaration → VariableStatement`, extracting declaration text, validating it's a direct export, and removing it from the AST. This logic is accessed through a local `Removable` type alias and a `toRemovableStatement` helper, used twice (source symbol at line 52-54 and dest symbol at line 98-100). Extracting a `SymbolRef` domain object makes this concept reusable and testable in isolation.

## User intent

*As a contributor building composable operations (split-file, move-multiple-symbols), I want a reusable value object for "an exported symbol in a file," so that I can resolve, inspect, and remove symbols without reimplementing lookup/unwrapping logic in every operation.*

## Relevant files

- `src/compilers/ts-move-symbol.ts` — contains `Removable` type, `toRemovableStatement()`, inline symbol lookup/validation; will consume `SymbolRef` after extraction
- `src/domain/workspace-scope.ts` — existing domain service; `SymbolRef` follows the same pattern (domain object, no I/O dependency)
- `src/domain/import-rewriter.ts` — existing domain service; does not need `SymbolRef` but establishes the domain layer conventions
- `src/types.ts` — error codes (`SYMBOL_NOT_FOUND`, `NOT_SUPPORTED`, `SYMBOL_EXISTS`)
- `src/utils/errors.ts` — `EngineError` class
- `tests/compilers/ts-move-symbol.test.ts` (255 lines) — integration tests for symbol move
- `tests/compilers/ts-move-symbol-errors.test.ts` (245 lines) — error path tests for symbol move

### Red flags

- None. `ts-move-symbol.ts` is 124 lines (well under threshold). Test files are under 300 lines. No prep step needed.

## Value / Effort

- **Value:** Creates a named domain concept that future composable operations can use without reimplementing symbol lookup, unwrapping, and validation. Eliminates the `Removable` type hack (`as unknown as Removable`) and the inline `toRemovableStatement` function. Makes symbol resolution independently testable — current tests can only exercise it through the full `tsMoveSymbol` flow.
- **Effort:** Small. One new file (`src/domain/symbol-ref.ts`, ~50 lines), one unit test file, and a refactor of `ts-move-symbol.ts` to use it. No interface changes, no new infrastructure.

## Behaviour

- [x] **AC1: `SymbolRef.fromExport(sourceFile, symbolName)` resolves an exported symbol.** Given a ts-morph `SourceFile` containing `export function foo() {}` and `symbolName = "foo"`, `SymbolRef.fromExport(sourceFile, "foo")` returns a `SymbolRef` with `name === "foo"`, `filePath` equal to the source file's path, and `declarationText` starting with `"export function foo"`. Given `symbolName = "nonexistent"`, throws `EngineError` with code `SYMBOL_NOT_FOUND`.
- [x] **AC2: `SymbolRef` unwraps variable declarations.** Given a source file containing `export const BAR = 42;`, `SymbolRef.fromExport(sourceFile, "BAR")` returns a `SymbolRef` whose `declarationText` is `"export const BAR = 42;"` (the full `VariableStatement`, not the inner `VariableDeclaration`).
- [x] **AC3: `isDirectExport()` rejects re-exports.** Given a source file containing `export { Baz } from "./other";`, `SymbolRef.fromExport(sourceFile, "Baz")` returns a `SymbolRef` where `isDirectExport()` returns `false`. Given `export function Baz() {}`, `isDirectExport()` returns `true`.
- [x] **AC4: `remove()` deletes the symbol's declaration from the AST.** After calling `ref.remove()`, the source file's text no longer contains the declaration. Calling `remove()` a second time is a no-op (does not throw).
- [x] **AC5: `tsMoveSymbol` uses `SymbolRef` instead of inline logic.** The `Removable` type alias, `toRemovableStatement` function, and inline `getExportedDeclarations` + validation in `tsMoveSymbol` are replaced by `SymbolRef.fromExport()` calls. All existing `ts-move-symbol` tests continue to pass without modification.

## Interface

No public surface change. `SymbolRef` is an internal domain object — not exposed via MCP or CLI.

```typescript
// src/domain/symbol-ref.ts

import type { SourceFile } from "ts-morph";

class SymbolRef {
  /** Absolute path of the file containing this symbol. */
  readonly filePath: string;      // e.g. "/workspace/src/utils.ts"

  /** The exported name. */
  readonly name: string;          // e.g. "foo"

  /** Full text of the top-level statement (includes `export` keyword). */
  readonly declarationText: string; // e.g. "export function foo() { ... }"

  /** Private constructor — use static factory. */
  private constructor(filePath: string, name: string, declarationText: string, removeFn: () => void);

  /**
   * Resolve an exported symbol by name from a ts-morph SourceFile.
   * @throws EngineError SYMBOL_NOT_FOUND if the symbol is not exported.
   */
  static fromExport(sourceFile: SourceFile, symbolName: string): SymbolRef;

  /** Whether this is a direct export (not a re-export via `export { } from`). */
  isDirectExport(): boolean;

  /** Remove this symbol's declaration from the source AST. Idempotent. */
  remove(): void;
}
```

**Bounds:**
- `filePath`: absolute path, always from `sourceFile.getFilePath()`.
- `name`: non-empty string; validated by the caller (schema layer).
- `declarationText`: full statement text; can be multi-line for large functions/classes. No size cap — mirrors what ts-morph returns.
- `remove()`: mutates the ts-morph AST in-place. Idempotent — tracks whether removal already happened.
- `fromExport()`: takes the first declaration if multiple exist (matches current behaviour).

**Zero/empty cases:**
- Symbol not found → `SYMBOL_NOT_FOUND` error (not a null return).
- Empty source file → `SYMBOL_NOT_FOUND`.

**Adversarial cases:**
- Re-export (`export { X } from "./y"`) → resolves successfully, `isDirectExport()` returns false. Callers must check before using.

## Open decisions

(none — the design follows directly from the existing inline code and the target architecture doc)

## Security

- **Workspace boundary:** N/A — `SymbolRef` operates on in-memory ts-morph AST nodes. It does not read or write files. Workspace boundary enforcement remains in `tsMoveSymbol` (via `WorkspaceScope`).
- **Sensitive file exposure:** N/A — no file I/O.
- **Input injection:** N/A — `symbolName` is used only as a Map key lookup against `getExportedDeclarations()`. No path construction or shell interpolation.
- **Response leakage:** N/A — `declarationText` is already returned to callers via the existing flow. No new exposure surface.

## Edges

- `SymbolRef` must not import from `src/compilers/` or `src/operations/` — it's a domain object. Dependencies: only `ts-morph` types and `src/utils/errors.ts`.
- `SymbolRef` does not own file I/O — it doesn't call `save()` or write to disk. File persistence remains in `tsMoveSymbol`.
- All existing `ts-move-symbol` tests (basic moves, error paths, import rewriting) must pass unchanged after the refactor.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed:
      - No public surface change — no doc updates needed
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

- **Tests:** 1 new test file (`tests/domain/symbol-ref.test.ts`) covering all 5 ACs. All 50 existing `ts-move-symbol` tests pass unchanged.
- **Mutation score:** 100% for `symbol-ref.ts` (16/16 mutants killed).
- **Files added:** `src/domain/symbol-ref.ts` (~100 lines), `tests/domain/symbol-ref.test.ts`.
- **Files modified:** `src/compilers/ts-move-symbol.ts` (replaced `Removable` type alias, `toRemovableStatement` helper, and inline `getExportedDeclarations` calls with `SymbolRef.fromExport()`).
- **Semantic gap noted:** `tsMoveSymbol` still uses `declarationText.trimStart().startsWith("export")` for its direct-export check rather than `sourceRef.isDirectExport()`. The two approaches differ: `isDirectExport()` compares file paths (declaration origin vs. queried file), while the inline check inspects the text. Both are correct for the current use case (same-file `export { localFn }` patterns produce text starting with `export`), but the mismatch is worth noting if `isDirectExport()` is ever extended to cover additional re-export patterns. Not worth a handoff entry -- the gap is localized to one function.
- **No new tech debt or agent-memory entries required.**
