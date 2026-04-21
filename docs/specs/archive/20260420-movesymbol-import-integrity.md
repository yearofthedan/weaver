# moveSymbol import integrity

**type:** change
**date:** 2026-04-20
**tracks:** handoff.md # Make-moveSymbol-robust → docs/features/moveSymbol.md

---

## Context

`moveSymbol` leaves the project in a broken state in three ways: when the moved symbol is still called inside the source file, no import is added back to source; when the moved declaration depends on imported types, those imports aren't carried to the destination; and when the destination has a non-exported declaration with the same name, no conflict is detected and a duplicate is silently appended.

## User intent

*As an agent refactoring a TypeScript codebase, I want to move a named export to another file and have all import dependencies — in both the source and destination files — automatically resolved, so that the project compiles without manual fixup after the move.*

## Relevant files

- `src/ts-engine/move-symbol.ts` — the operation; line 75 explicitly excludes `absSource` from the importer list passed to `ImportRewriter`, which is the root cause of Gap 2
- `src/ts-engine/import-rewriter.ts` — rewrites import/export declarations in importer files; `rewriteScript` is the entry point for callers that handle SFC extraction
- `src/ts-engine/symbol-ref.ts` — `SymbolRef.fromExport()` uses `getExportedDeclarations()`, which is why non-exported conflicts aren't caught (Gap 4)
- `src/ts-engine/move-symbol.test.ts` — 255 lines; will reach the 300-line review threshold with new cases — see Red flags

### Red flags

**Test hotspot:** `move-symbol.test.ts` is 255 lines. Adding 4 new test cases (~40 lines) will push it to ~295 — just under the review threshold. Before adding tests, extract a shared `setupProject(files: Record<string, string>)` helper that takes filename → content pairs, creates a temp dir, writes tsconfig and the files, and returns `{ dir, tsCompiler, scope }`. This replaces the repeated `writeTsConfig` / `makeTmpDir` / inline `fs.writeFileSync` boilerplate. Do this in the same commit as the first AC, not as a separate pass.

## Value / Effort

- **Value:** Agents can move a symbol and trust the result compiles. Currently every `moveSymbol` call involving imported types or self-use in source requires manual import fixup — the tool breaks the contract it advertises.
- **Effort:** `move-symbol.ts` is 108 lines; changes are self-contained. The main complexity is the AST identifier walk for transitive imports (AC2). No new files needed; no interface changes.

## Behaviour

- [ ] **AC1 (source self-import):** When remaining code in the source file references the moved symbol after the declaration is removed, `moveSymbol` adds `import { <symbolName> } from '<relPath>'` to the source file pointing at the destination. Example: `source.ts` has `export function Foo()` and `export function Bar() { return Foo() }`. After moving `Foo` to `dest.ts`, `source.ts` gets `import { Foo } from './dest.js'` and `source.ts` appears in `filesModified`.

- [ ] **AC2 (transitive import carry):** When the moved declaration references a name that is a named import in the source file and that name is not already imported in the destination, that import is added to the destination with its path recomputed relative to the destination's location. Example: source imports `Bar` from `./types`; moved `Foo` uses `Bar` in its body or signature; after the move, `dest.ts` gets `import { Bar } from '../types.js'` (path adjusted for dest's directory).

- [ ] **AC3 (transitive import dedup):** When a needed transitive import already exists in the destination (same named export, any matching specifier), no duplicate import declaration is added.

- [ ] **AC4 (non-exported conflict detection):** When the destination file contains a non-exported declaration (function, const, class, type, interface) with the same name as the symbol being moved, it is treated as a conflict: `SYMBOL_EXISTS` error without `force`, declaration replaced with `force: true`.

## Interface

No changes to the external interface. Parameters (`sourceFile`, `symbolName`, `destFile`, `force`, `checkTypeErrors`) and return shape (`filesModified`, `filesSkipped`, `typeErrors`) are unchanged. `SYMBOL_EXISTS` error code already exists and is reused for AC4.

## Open decisions

Both decisions are resolved — recorded here for the executor.

### AC2: How to identify which imports the moved declaration depends on

**Options:**
- **A — Text heuristic:** For each named import in source, check if the identifier appears in the declaration's text string. Simple but produces false positives from string literals and misses aliased imports (`import { Bar as B }` — must check `B`, not `Bar`).
- **B — AST identifier walk:** Use ts-morph to get all `Identifier` nodes within the declaration statement, resolve each via `identifier.getSymbol()?.getDeclarations()?.[0]?.getSourceFile()`, then locate the corresponding import declaration in source.

**Resolution: Option B.** This codebase uses ts-morph precisely to avoid text-based heuristics for code structure. Handles aliases correctly, no false positives. Walk `stmt.getDescendantsOfKind(SyntaxKind.Identifier)`; skip identifiers whose resolved source file is the same as `srcSF` (local declarations) or is a built-in lib file (no import to carry).

### AC1: When to detect remaining usages of moved symbol in source

**Options:**
- **A — Before removal:** Scan `srcSF` for `Identifier` nodes referencing the moved declaration, excluding those inside the declaration node itself, while the compiler graph is still intact.
- **B — After mutation:** Regex scan the post-removal source text for `symbolName`.

**Resolution: Option A.** Compiler graph is available before `sourceRef.remove()` runs. Use `srcSF.getDescendantsOfKind(SyntaxKind.Identifier)` filtered to those whose resolved declaration is the moved symbol's node, then exclude any that are inside the declaration's own subtree. If any remain, add the import to source after saving dest.

## Security

- **Workspace boundary:** No new file reads or writes beyond what `moveSymbol` already performs. Import additions to source and dest go through `scope.writeFile()`, which is already boundary-checked.
- **Sensitive file exposure:** N/A — no new file content is read beyond import declarations already in memory.
- **Input injection:** N/A — no new string parameters introduced.
- **Response leakage:** N/A — no new content fields in the response.

## Edges

- Source imports not referenced by the moved symbol are left as-is — no unused-import cleanup from source. TypeScript/biome will flag those.
- If the moved symbol uses an aliased import in source (`import { Bar as B }`), the alias is preserved when added to dest: `import { Bar as B } from './adjusted-path.js'`.
- Importers of the moved symbol continue to be rewritten exactly as before — this spec does not change `ImportRewriter`.
- `force: true` behavior for exported conflicts is unchanged.
- `SYMBOL_NOT_FOUND` and `NOT_SUPPORTED` errors are unchanged.
- Out-of-workspace files remain in `filesSkipped`, not `filesModified`.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/ts-engine/move-symbol.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
  - `docs/features/moveSymbol.md` — remove "Known limitations" item for source self-use; update Constraints section to reflect Gap 4 behavior
  - `.claude/skills/move-and-rename/SKILL.md` — no change needed (behavior improves silently; no interface change)
  - `handoff.md` current-state section — no layout change
- [ ] `[needs design]` entry added to handoff.md for moving non-exported functions (Gap 3)
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/features/moveSymbol.md` or `.claude/MEMORY.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

### Reflection

**What went well**
- Open decisions in the spec (AST vs text heuristic; before-vs-after removal) were resolved up front — the executor had no architectural forks to make.
- The original 4 ACs landed cleanly on first dispatch; tests pass, mutation-killing tests were added, feature doc updated.
- The follow-up extraction exercise (pushing pure helpers out of move-symbol.ts with direct unit tests) was the right call — it took the integration file from 506 → 343, brought three new source files to 100%/100%/86% mutation coverage on the helpers individually, and let the integration file focus on wiring.

**What didn't**
- The executor wrote 506 lines of integration tests for behaviour that was clearly pure-helper logic. Code-standards.md §"Push integration tests down" already said to do this, but nothing in the spec/slice workflow forced a layer-fit check at the right moment. Addressed in the same session: added a per-AC layer-fit prompt to the spec skill + change template, and a file-size Done-when check to the slice skill.
- The executor classified 9 surviving mutants as "untestable defensive guards" and recommended accepting them. Three were actually dead code: an identity comparison replaces a position+filepath comparison (no boundary conditions), destructuring replaces `arr[0]` after length check (no double guard), and a union return type replaces five widening `as Node & { remove(): void }` casts (no upcast required). Restructure took 5 minutes and raised refs-outside-declaration from 70.97 → 85.71 and non-exported-declaration to 100%. Addressed in the same session: added a `refactor` classification to mutate-triage before `noise`, plus a new §"Defensive code vs. dead branches" to code-standards.md.
- Dispatching two docs commits in parallel collided on the shared Vitest coverage temp directory — one hook ran into `ENOENT: .../coverage/.tmp/coverage-36.json` while the other held the file. Commit sequentially from now on; parallelism doesn't pay when the tool-chain shares global state.

**For the next agent picking up related work**
- `move-symbol.ts` orchestrator is 165 lines. The three extracted helpers (`transitive-imports`, `refs-outside-declaration`, `non-exported-declaration`) each have dedicated unit tests — edit them there, not through integration tests.
- The ImportRewriter `matchesDestSpecifier` method was made package-visible to share dedup logic with `tsMoveSymbol`. If you're touching `ImportRewriter`'s surface, check whether that coupling is still needed — it's a small code smell left over from this work.
- Gap 3 (moving non-exported functions) remains unaddressed. It was split to its own `[needs design]` during this spec.

### Numbers

- **Source size:** `move-symbol.ts` 108 → 165 (after full flow + extraction); three new helper modules at 74/19/41 lines.
- **Integration test size:** `move-symbol.test.ts` 255 → 343; three new unit test modules at 218/99/72 lines.
- **Mutation scores (post-refactor, per-file):**
  - `move-symbol.ts`: 76.70%
  - `transitive-imports.ts`: 80.33%
  - `refs-outside-declaration.ts`: **85.71%** (was 70.97 before dead-branch removal)
  - `non-exported-declaration.ts`: **100%** (was 78.95 before cast cleanup)
  - Overall run below 75% threshold is dragged by `dispatcher.ts` (0%, pre-existing, unrelated).
- **Test count:** +33 unit tests across the three new helper files, −10 integration tests (net +23).

### Artefacts preserved
- Workflow hardening: `spec` skill layer-fit prompt; `slice` skill file-size Done-when; `change.md` template mirrors both.
- Teaching: `code-standards.md` §Type casts and §Defensive code vs. dead branches; `mutate-triage` skill `refactor` classification.
- Agent notes: `.claude/agent-notes/movesymbol-import-integrity.md` and `.claude/agent-notes/movesymbol-extract-helpers.md`.
