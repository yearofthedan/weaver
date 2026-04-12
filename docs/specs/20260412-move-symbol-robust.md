# Make moveSymbol robust

**type:** change
**date:** 2026-04-12
**tracks:** handoff.md # make-movesymbol-robust → docs/features/moveSymbol.md

---

## Context

`moveSymbol` handles the happy path (exported symbol, self-contained declaration, no callers in the source file, no name collision in dest) but fails silently or errors in four common real-world scenarios. Together they force agents into multi-step manual fixup loops after every non-trivial symbol move, negating the tool's value.

## User intent

*As an agent performing a codebase refactoring, I want to move a function or variable to another file and have all import relationships — including the declaration's own type/value dependencies — updated correctly, so that the codebase compiles without manual intervention after the move.*

## Relevant files

- `src/ts-engine/move-symbol.ts` — the full move workflow; all four gaps live here or are caused by its design
- `src/ts-engine/symbol-ref.ts` — `SymbolRef.fromExport`: only looks up exported declarations; needs a companion for local declarations (Gap 3)
- `src/ts-engine/import-rewriter.ts` — `ImportRewriter.rewrite`: rewrites importers; source file is currently excluded from this pass (Gap 2)
- `src/ts-engine/move-symbol.test.ts` — test file at 255 lines; see Red flags
- `src/operations/moveSymbol.ts` — thin operation wrapper; no changes needed
- `docs/features/moveSymbol.md` — feature doc; Constraints and Known limitations sections need updating when this ships

### Red flags

**Test hotspot:** `move-symbol.test.ts` is 255 lines. Adding four new `describe` blocks (one per AC) would push it to ~340 lines, crossing the 300-line review threshold. Before adding new tests, extract the repeated inline `mkdirSync + writeFileSync` scaffolding into parameterised helpers (the `setupSimpleTs` pattern already exists; the boundary and collision tests inline their own setup instead of reusing it). This is a **prep step** that should ship as a separate commit before the AC tests are added.

## Value / Effort

- **Value:** After a symbol move the codebase compiles. Currently it does not in four common cases: (1) the moved function uses a type from another file — now the dest has an unresolved reference; (2) the source file still calls the moved function — now it has a broken call; (3) an agent tries to move an unexported helper — the tool errors rather than helping; (4) the dest happens to have a local with the same name — a silent duplicate is created. Fixing all four means `moveSymbol` produces a correct result in the common case, not just the trivial case.
- **Effort:** All changes are in `src/ts-engine/move-symbol.ts` and `src/ts-engine/symbol-ref.ts`, with small additions to the existing test file. Gap 1 (import carrying) requires AST traversal to find identifier → import source mappings, which is the most involved piece. Gaps 2, 3, and 4 are structural additions to the existing workflow with no new infrastructure.

## Behaviour

- [ ] **AC 1 — Transitive imports carried to dest.** Given `src/a.ts` exports `function Foo(x: Bar): void {}` and has `import { Bar } from "./types"`, when `Foo` is moved to `src/b.ts`, then `b.ts` gains `import { Bar } from "./types.js"` with the relative path recomputed from `b.ts`'s location. Given the declaration references only globally available types (`string`, `Date`, etc.), no import is added to dest. Scope: only imports *directly referenced* by the moved declaration's own AST nodes are carried; transitive dependencies of those imports are out of scope.

- [ ] **AC 2 — Source self-import added when symbol still used in source.** Given `utils.ts` exports `greetUser()` and `doSomething()` calls `greetUser()`, when `greetUser` is moved to `helpers.ts`, `utils.ts` gains `import { greetUser } from "./helpers.js"` and the body of `doSomething` is unchanged. Given no other code in `utils.ts` references the moved symbol, `utils.ts` does NOT gain any new import.

- [ ] **AC 3 — Non-exported local symbols can be moved.** Given `utils.ts` has `function privateHelper() { return 42; }` (local, no `export` keyword) and `doWork()` calls `privateHelper()`, when `moveSymbol(utils.ts, "privateHelper", helpers.ts)` is called, `helpers.ts` gains `export function privateHelper() { return 42; }` (the `export` keyword is added), `utils.ts` gains `import { privateHelper } from "./helpers.js"` (AC 2 behaviour applied), and the local declaration is removed from `utils.ts`. Re-exports (`export { Foo } from "./other"`) remain `NOT_SUPPORTED` and are not affected by this AC.

- [ ] **AC 4 — Local collision in dest detected and handled.** Given `dest.ts` has `function Foo() {}` (local, not exported) and `src.ts` has `export function Foo() {}`, calling `moveSymbol(src.ts, "Foo", dest.ts)` without `force` throws `SYMBOL_EXISTS`. Calling it with `force: true` removes the local `Foo` from `dest.ts` before appending the moved declaration. No changes are made to any file when `SYMBOL_EXISTS` is thrown.

## Interface

No new parameters or result fields. The existing `force?: boolean` option already covers AC 4. `MoveSymbolResult` fields are unchanged.

Behavioural changes to existing error codes:
- `SYMBOL_EXISTS` — now thrown when the dest contains a *local* (non-exported) declaration with the same name, not only an exported one. Previously a local collision was silently allowed; now it is treated as a conflict.
- `SYMBOL_NOT_FOUND` — no longer thrown for non-exported local symbols (Gap 3); only thrown when the name does not appear in the file at all.

## Open decisions

**Decision A — How to detect source-file callers (for AC 2 and AC 3)**

- **Decision:** When should we determine that the source file still uses the moved symbol after the move?
- **Options:**
  - Option 1 (recommended): Before `sourceRef.remove()`, while the ts-morph project is intact, walk the source file for identifier nodes that match `symbolName` and are not part of the declaration being moved. If any exist, set a flag to add an import after the move is complete.
  - Option 2: After saving the mutated source file, text-scan for the symbol name as a word boundary (`\bsymbolName\b`). Simpler, but produces false positives from comments, string literals, and substrings (e.g. `greetUser` found in `"greetUser is deprecated"`).
- **Tradeoffs:** Option 1 is AST-accurate and runs before any mutation, so it cannot be confused by the removal itself. Option 2 is easier to implement but unreliable. The pre-removal window is short and ts-morph is already loaded.
- **Recommendation:** Option 1. Resolve before starting implementation.

**Decision B — Export prefix for local declarations (for AC 3)**

- **Decision:** When moving a non-exported local (`function Foo() {}`), the declaration text has no `export` keyword. What do we write to the dest file?
- **Options:**
  - Option 1 (recommended): Prepend `export ` to the declaration text before appending to dest, making the moved symbol publicly importable.
  - Option 2: Append as-is (local in dest). The source's callers would still have broken references; the import added by AC 2 behaviour would try to import a non-exported name and produce a type error.
- **Tradeoffs:** Option 1 changes the visibility of a previously-private symbol — but that is inherent to moving it to another file. The caller asked to move it; a symbol that cannot be imported back is not useful. Option 2 is never correct in practice.
- **Recommendation:** Option 1. Resolve before starting implementation.

## Security

- **Workspace boundary:** No new file paths are introduced. Import-carrying writes only to `destFile`, which is already boundary-checked by the dispatcher before `tsMoveSymbol` is called. The source self-import write goes to `sourceFile`, also pre-validated.
- **Sensitive file exposure:** No new file content is read beyond what already occurs. Import path strings from the declaration's AST are compiler-generated (not user-controlled strings) and do not reach the filesystem independently.
- **Input injection:** `symbolName` is already validated as a JS identifier at the dispatcher layer. No new string parameters.
- **Response leakage:** No new fields in `MoveSymbolResult`. Error messages already contain file paths and symbol names, consistent with existing behaviour.

## Edges

- If the moved symbol's imports point to files outside the workspace, those import paths are still copied to dest (they are read-only references, not writes — the workspace boundary only constrains writes).
- If both source and dest are the same file, the operation should throw or be a no-op; this is already rejected upstream (undefined behaviour prevented by the dispatcher).
- Moving a symbol to a dest that already imports it from yet another file (a re-export chain) is out of scope; the operation handles the direct source → dest case only.
- Symbols with multiple declarations (function overloads) are out of scope; `SymbolRef` takes the first declaration. This is pre-existing behaviour and not changed here.
- `getTypeErrors` post-step in the dispatcher is unaffected — it runs on `filesModified` after the operation returns, and the additional modified files (dest import additions, source self-import) will be included via `scope.modified`.

## Done-when

- [ ] All ACs verified by tests
- [ ] Prep step complete: repeated inline setup in `move-symbol.test.ts` extracted to shared helpers before new tests are added
- [ ] Mutation score ≥ threshold for touched files (`src/ts-engine/move-symbol.ts`, `src/ts-engine/symbol-ref.ts`)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - `docs/features/moveSymbol.md` — remove the "Known limitations" entry for source self-import (Gap 2), update Constraints to reflect that unexported locals are now supported (Gap 3) and that local collisions trigger `SYMBOL_EXISTS` (Gap 4)
      - `.claude/skills/move-and-rename/SKILL.md` — update `moveSymbol` description to reflect that local symbols and transitive imports are now handled
      - `docs/handoff.md` current-state section (no change needed — no new files added)
- [ ] Open decisions A and B resolved and recorded in this spec before implementation starts
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/features/moveSymbol.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
