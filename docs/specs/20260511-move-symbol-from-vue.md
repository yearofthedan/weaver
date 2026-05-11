# moveSymbol from a .vue source file

**type:** change
**date:** 2026-05-11
**tracks:** handoff.md # P3 → docs/commands/move-symbol.md, docs/internals/move-symbol.md

---

## Context

`moveSymbol` currently rejects `.vue` source files with `NOT_SUPPORTED`. Agents
working on Vue projects regularly need to extract a helper or composable defined
inline in a `<script setup>` block out to a shared `.ts` module. Without this
support they must cut-paste manually and use `replace-text` to fix importers —
exactly the error-prone workflow `moveSymbol` was designed to eliminate.

## User intent

*As an agent refactoring a Vue project, I want to move a named export from a
`<script setup>` block to a `.ts` file, so that the declaration, the source
file, and every importer are all updated in one operation.*

## Relevant files

- `src/plugins/vue/move-symbol.ts` — **new file** (vueMoveSymbol implementation)
- `src/plugins/vue/engine.ts` — VolarEngine.moveSymbol; add `.vue`-source branch
- `src/plugins/vue/extract-function.ts` — pattern for parsing `<script setup>`, using a throwaway project, and splicing back
- `src/ts-engine/move-symbol.ts` — tsMoveSymbol; reference for the full workflow; reused for the dest `.ts` write
- `src/ts-engine/symbol-ref.ts` — SymbolRef; reuse for symbol lookup and declaration extraction from throwaway SF
- `src/ts-engine/import-rewriter.ts` — ImportRewriter; reuse rewriteScript() for .ts and .vue importer scanning
- `src/ts-engine/throwaway-project.ts` — createThrowawaySourceFile; use for in-memory parsing of script content
- `src/ts-engine/refs-outside-declaration.ts` — hasRefsOutsideDeclaration; reuse on throwaway SF to detect self-import need
- `src/plugins/vue/scan.ts` — updateVueImportsAfterSymbolMove; reuse for .vue importer scanning after the move
- `src/utils/file-walk.ts` — walkFiles; use for .ts importer scan
- `src/utils/relative-path.ts` — computeRelativeImportPath; needed when writing self-import
- `docs/commands/move-symbol.md` — command reference; update Limitations section
- `docs/internals/move-symbol.md` — internals doc; update How it works diagram

### Red flags

- None found in the target area.
- `engine.test.ts` is 356 lines — well under threshold. Adding 1–2 smoke tests is fine.
- `src/plugins/vue/move-symbol.test.ts` will be a new file; all unit tests for
  `vueMoveSymbol` live there. The engine test gets only one integration smoke test.

**Layer-fit per AC:**
- AC1 (extraction + dest write): pure function of file content → unit test with temp dir, no Volar service needed
- AC2–AC3 (error cases): pure function → unit tests, in-memory content, no disk needed
- AC4 (importer rewriting): scans real files on disk → unit test with temp dir fixture; `.vue` importer path already covered by `updateVueImportsAfterSymbolMove`'s existing tests; add one integration smoke to engine.test.ts covering both importer types
- AC5 (self-import): pure function of script content → unit test with temp dir

## Value / Effort

- **Value:** Agents can extract a utility function from a Vue component's `<script
  setup>` block the same way they would from a `.ts` file — one tool call instead of
  manual cut-paste plus search-and-replace. The importer rewriting works project-wide,
  so every component that imported the symbol gets its import path updated automatically.
- **Effort:** ~2 new files (vueMoveSymbol function + its tests). VolarEngine.moveSymbol
  gets a small branch. Reuses `SymbolRef`, `ImportRewriter`, `createThrowawaySourceFile`,
  and `updateVueImportsAfterSymbolMove` — no new infrastructure. Moderate effort.

## Behaviour

- [ ] **AC1 — extraction and write.** Given `sourceFile` is a `.vue` file whose
  `<script setup>` block contains `export function|const|class|type foo …`, and
  `destFile` is a `.ts` path: the declaration is removed from the `<script setup>`
  block, written as a top-level export to `destFile` (creating it if it does not
  exist, or appending if it does), and both `sourceFile` and `destFile` appear in
  `filesModified`. The rest of the `.vue` file (`<template>`, `<style>`, other
  `<script setup>` content) is byte-for-byte unchanged.
  _Laziest wrong impl_: rewrite the whole `.vue` file from scratch — fails the
  "rest is unchanged" clause.
  _Layer_: unit test with temp dir (no Volar service).

- [ ] **AC2 — no `<script setup>` block.** Given `sourceFile` is a `.vue` file with
  no `<script setup>` block (template-only, or classic `<script>` only), returns
  `NOT_SUPPORTED`. No files are written.
  _Layer_: unit test, in-memory content.

- [ ] **AC3 — symbol not found.** Given `sourceFile` is a `.vue` file whose
  `<script setup>` block exists but does not contain a direct export named
  `symbolName` (either absent or only re-exported via `export { } from`), returns
  `SYMBOL_NOT_FOUND` (absent) or `NOT_SUPPORTED` (re-export). No files are written.
  _Layer_: unit test, in-memory content.

- [ ] **AC4 — importer rewriting.** Given `.ts` and `.vue` files that contain
  `import { symbolName } from './Source.vue'`, after a successful move those
  specifiers are rewritten to point to `destFile`. Files that do not import the
  symbol are unchanged.
  _Laziest wrong impl_: only rewrite `.vue` importers (misses `.ts` ones) or only
  rewrite by file extension matching without checking the symbol name.
  _Layer_: unit test with temp dir for the `.ts` importer path; `engine.test.ts`
  integration smoke that exercises both `.ts` and `.vue` importers together.

- [ ] **AC5 — self-import when symbol still used in script.** Given `sourceFile` is
  a `.vue` file where `symbolName` is also referenced within the same `<script
  setup>` block outside its own declaration (i.e. the block calls or uses the
  symbol), after the move a `import { symbolName } from '<relative-dest>'` line
  is prepended to the `<script setup>` content so the component continues to
  compile.
  _Laziest wrong impl_: always add a self-import regardless of whether it is
  needed — breaks files where the symbol is not used locally.
  _Layer_: unit test with temp dir.

## Interface

No new parameters. `moveSymbol` gains support for `.vue` `sourceFile` values; all
existing inputs and the return shape are unchanged.

| Field | Behaviour with .vue source |
|---|---|
| `sourceFile` | Now accepts `.vue` paths. Must exist. Must have `<script setup>`. |
| `symbolName` | Same as .ts: a named direct export in the `<script setup>`. |
| `destFile` | `.ts` only in this slice. Created if absent. |
| `force` | Same semantics: replaces same-named export in destFile if true. |
| `checkTypeErrors` | Same. Post-write errors include both source and dest. |
| `filesModified` | Source `.vue`, dest `.ts`, and every rewritten importer. |
| `filesSkipped` | Same: files outside the workspace boundary. |

**Known limitation (out of scope for this slice):** Transitive imports used by the
moved symbol (e.g. `import { ref } from 'vue'` inside `<script setup>`) are **not**
carried to `destFile`. The resulting type errors in `destFile` precisely identify
what to add. A future slice can address this once Volar LS integration makes module
resolution available to the throwaway project approach.

## Open decisions

None — all forks resolved during spec exploration:

- **`.vue → .ts` only (not `.vue → .vue`)**: Matches the real-world use case
  (extract helper to shared module). `.vue → .vue` would require SFC composition
  on the destination side (creating or locating a `<script setup>` block while
  preserving template/style), which is a significantly larger surface. Defer.
- **`<script setup>` only (not classic `<script>`)**: Classic `<script>` blocks
  hold the component's options/default export, not extractable standalone helpers.
  The handoff entry specifically calls out `<script setup>`.
- **Leave empty block in place**: Weaver does not delete structural SFC content.
  An empty `<script setup></script>` is valid Vue; the user removes it if desired.
- **No transitive import carrying**: The throwaway project approach cannot resolve
  `node_modules` or relative modules to absolute paths the way the live ts-morph
  project can. Type errors in the dest are actionable. Carry across when Volar LS
  integration is available.
- **Importer scanning via filesystem walk (not ts-morph project graph)**: ts-morph's
  project graph cannot resolve `.vue` module specifiers, so `project.getSourceFiles()`
  cannot find `.ts` files that import from a `.vue` source. Use `walkFiles` + 
  `ImportRewriter.rewriteScript()` for all importer types — consistent with how
  `updateVueImportsAfterSymbolMove` already handles `.vue` importers.

## Security

- **Workspace boundary:** `sourceFile` and `destFile` are validated by the existing
  dispatcher `pathParams` check (same as all other operations). `vueMoveSymbol` writes
  only via `scope.writeFile()` and `scope.fs.readFile()`, which enforce the workspace
  boundary. Importer scanning iterates files returned by `walkFiles` from the project
  root — all within the workspace. No new bypass risk.
- **Sensitive file exposure:** Reads `.vue` and `.ts` source files. No different from
  existing rename/move operations. `isSensitiveFile` is not applicable (these are source
  files, not config/secrets).
- **Input injection:** `symbolName` reaches ts-morph's AST lookup (not a shell or
  filesystem path). `sourceFile` and `destFile` are path-validated by dispatcher. No
  new injection surface.
- **Response leakage:** Same as existing operations — `filesModified` contains paths,
  not file content. No new leakage surface.

## Edges

- `destFile` must end with `.ts` (not `.vue`). A `.vue` destFile returns `NOT_SUPPORTED`.
- `SYMBOL_EXISTS` / `force` behaviour for the dest `.ts` is identical to the `.ts → .ts` case.
- The `<template>` and `<style>` blocks of the source `.vue` must be byte-for-byte
  unchanged after the move.
- A `.vue` source file with both `<script>` and `<script setup>` blocks: only
  `<script setup>` is scanned; symbols found only in the classic `<script>` return
  `NOT_SUPPORTED`.
- Template-level usage of the moved symbol is out of scope for the self-import check
  (AC5 covers script-level only). Template references cause type errors post-move, which
  the user resolves by retaining the import.
- The existing `updateVueImportsAfterSymbolMove` post-step in `VolarEngine.moveSymbol`
  must NOT run for the `.vue`-source path — importer rewriting is handled entirely inside
  `vueMoveSymbol` in that branch.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/plugins/vue/move-symbol.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated:
      - `docs/commands/move-symbol.md`: remove "Moving symbols from a .vue source file is
        not yet supported" from Limitations; add note about transitive imports limitation
      - `docs/internals/move-symbol.md`: update How it works diagram to show the `.vue` source branch
      - `.claude/skills/refactor/SKILL.md`: confirm `moveSymbol` entry mentions `.vue` source support (primary agent discovery surface)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to `docs/internals/move-symbol.md` or `.claude/MEMORY.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
