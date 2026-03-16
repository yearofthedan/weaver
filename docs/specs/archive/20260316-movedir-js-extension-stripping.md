# moveDirectory: .js extension stripping, source dir cleanup, sub-project corruption

**type:** bug
**date:** 2026-03-16
**tracks:** handoff.md # moveDirectory-js-extensions, moveDirectory-source-dir-cleanup, moveDirectory-sub-project-corruption

---

## Symptom

Three related bugs in `moveDirectory`, all rooted in the use of ts-morph's `dir.move()`:

**1. Import specifier corruption.** Imports with `.js` extensions (required by ESM/nodenext) are rewritten without the extension, and extensionless imports under certain module resolution modes are not rewritten at all. The operation returns `ok: true`.

```
input:    moveDirectory("src/utils", "src/lib") on a project using .js extensions
actual:   import { hello } from "./utils/a.js" → import { hello } from "./lib/a"
expected: import { hello } from "./utils/a.js" → import { hello } from "./lib/a.js"
```

**2. Source directory not deleted.** After a successful move, empty directory shells are left at the old path. `dir.move()` + `project.saveSync()` renames source files but does not clean up the vacated directories. Non-source files are moved by the operation layer, but the old directory tree remains.

**3. Sub-project boundary corruption.** When the moved directory contains its own `tsconfig.json`, internal relative imports (e.g. `"./utils"`) are rewritten to long cross-tree paths pointing back to the old location. `dir.move()` operates on the parent project's `Project` object, which doesn't recognise the sub-project's tsconfig boundary.

## Value / Effort

- **Value:** High. Silent data corruption — operation returns success with broken imports. No workaround short of manually fixing all imports after every directory move.
- **Effort:** Medium. The fix pattern is already established by `moveFile`: use `ls.getEditsForFileRename()` for import rewriting, ts-morph only for physical moves and graph updates. The main work is adapting the per-file pattern to a batch of files.

## Expected

1. Import specifiers preserve their original style (`.js` extensions kept, extensionless specifiers correctly resolved and rewritten) after a directory move, matching `moveFile` behaviour.
2. The old directory is fully removed after a successful move — no empty shells left behind.
3. Imports between files that moved together (internal to the directory) stay untouched — their relative paths are still correct. Only imports from files *outside* the moved directory are updated to point to the new location.

## Root cause

`TsMorphCompiler.moveDirectory()` (src/compilers/ts.ts:296-340) uses ts-morph's `dir.move()`, which internally uses `sourceFile.move()` for import rewriting. `sourceFile.move()` has two known bugs documented in `docs/tech/ts-morph-apis.md`:

1. **`.js` extensions stripped** — `getRelativePathAsModuleSpecifierTo()` drops `.js`/`.cjs`/`.mjs` from generated specifiers
2. **Extensionless imports not rewritten** — does not resolve extensionless specifiers to `.ts` files

## Fix

### Resolved decision: batch-first edit computation

Compute all edits before any physical moves. Call `getEditsForFileRename()` for every file in the directory, merge edits by target file, apply all edits to disk, then physically move the directory and update the project graph. This avoids intermediate inconsistent state — the TS language service sees the project as it was before any moves, producing consistent edits. Edit merging is straightforward: `getEditsForFileRename` returns edits keyed by target file with non-overlapping spans (TypeScript's own guarantee). The alternative (sequential per-file processing) was rejected because partially-moved state between files caused bugs in prior iterations.

### Acceptance criteria

- [ ] **AC1: Replace `dir.move()` with per-file `getEditsForFileRename` for import rewriting.** Enumerate source files in the directory, compute edits via the TS language service for each file's old→new path, merge edits by target file, apply all edits, then physically move files and update the project graph. `dir.move()` is no longer called.

- [ ] **AC2: `.js` extension preservation.** A test fixture with ESM-style `.js` imports verifies that `moveDirectory` preserves `.js` extensions in rewritten specifiers. Input: `import { a } from "./utils/a.js"` → after moving `utils/` to `lib/`, output: `import { a } from "./lib/a.js"`.

- [ ] **AC3: Extensionless import rewriting.** Verify that extensionless specifiers (e.g. `import { a } from "./utils/a"`) are correctly rewritten to the new path after a directory move. The existing `move-dir-ts` fixture uses this style — ensure it still works with the new implementation.

- [ ] **AC4: `afterFileRename` fallback scan runs for each moved file.** The fallback scan (which catches files outside `tsconfig.include`) must run for every file in the moved directory, not just once. This ensures test files and scripts that import from the moved directory are also updated.

- [ ] **AC5: Old directory removed after move.** After all files are moved, the old directory tree is deleted. No empty directory shells are left behind. Verify with a test that checks `fs.existsSync(oldPath)` returns `false` after a successful move.

- [ ] **AC6: Sub-project boundary respected.** When a moved directory contains its own `tsconfig.json`, internal relative imports between files that moved together are not rewritten. Only imports from files outside the moved directory are updated. Verify with a fixture containing a sub-project — internal `"./utils"` imports must be unchanged after the move.

## Security

- **Workspace boundary:** N/A — the fix changes how import specifiers are computed, not how files are read/written. Boundary checks remain in the operation layer.
- **Sensitive file exposure:** N/A — no change to file content reading.
- **Input injection:** N/A — no change to how user-supplied strings reach the filesystem.
- **Response leakage:** N/A — no change to error messages or response fields.

## Relevant files

| File | Why |
|------|-----|
| `src/compilers/ts.ts` (TsMorphCompiler.moveDirectory, lines 296-340) | Primary fix target — replace `dir.move()` |
| `src/compilers/ts.ts` (TsMorphCompiler.getEditsForFileRename, lines 179-224) | Reuse this for per-file edit computation |
| `src/compilers/ts.ts` (TsMorphCompiler.afterFileRename, lines 272-294) | Fallback scan — must run per moved file (AC4) |
| `src/operations/moveFile.ts` | Reference implementation — same pattern at single-file scale |
| `src/operations/moveDirectory.ts` | Operation layer — may need minor adjustments if compiler return shape changes |
| `src/utils/text-utils.ts` (applyTextEdits) | Edit application — reuse for applying merged edits |
| `docs/tech/ts-morph-apis.md` | Documents the root cause and correct approach |
| `src/__testHelpers__/fixtures/move-dir-ts/` | Existing fixture (extensionless imports) — AC3 |

## Red flags

- **Test hotspot:** `tests/operations/moveDirectory_tsMorphCompiler.test.ts` is 372 lines — above the 300-line review threshold. Assess during implementation whether Vue-specific tests (lines 183-290) should be extracted to a separate file. Do not make it worse by adding AC2 tests without reviewing first.

## Edges

- Existing extensionless import tests must not regress (the `move-dir-ts` fixture covers this)
- Vue import rewriting (`.vue` specifiers in TS files) must still work — VolarCompiler delegates to TsMorphCompiler
- `moveFile` behaviour must be unaffected — it has its own pipeline
- Non-source files (JSON, images, etc.) must still be physically moved by the operation layer
- The `isCoexistingJsFileEdit` guard must apply to directory moves too — if a `.js` file physically exists alongside a `.ts` file, don't rewrite imports pointing at the `.js` file

## Done-when

- [x] All fix criteria verified by tests
- [ ] Mutation score ≥ threshold for touched files (deferred — run separately)
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated — `docs/features/moveDirectory.md` updated to reflect new implementation
- [x] No new tech debt discovered
- [x] Gotchas: MEMORY.md updated with execution agent prompt guidance; feature doc updated with `.js` preservation and sub-project boundary constraints
- [x] Spec moved to docs/specs/archive/

## Outcome

### What was done

Replaced `dir.move()` in `TsMorphCompiler.moveDirectory()` with a batch `getEditsForFileRename` pipeline. Two shared utilities extracted to `src/domain/apply-rename-edits.ts`: `applyRenameEdits` (edit-application loop shared with `moveFile`) and `mergeFileEdits` (deduplicating merge for batch rename results). `moveFile.ts` refactored to use the shared utility.

Two latent bugs discovered and fixed during AC2:
- `getEditsForFileRename` edits targeting files *inside* the moved directory had to be filtered out — the language service doesn't know about the batch move and would corrupt intra-directory specifiers
- `rewriteMovedFileOwnImports` didn't recognise that `./a.js` can resolve to `./a.ts` in ESM/nodenext projects

### Test count

+12 tests (708 total): 9 unit tests for `applyRenameEdits`/`mergeFileEdits`, 1 ESM extension preservation, 1 old directory removal, 1 sub-project boundary. Two new fixtures: `move-dir-ts-esm`, `move-dir-subproject`.

### Reflection

**What went well:** The `moveFile` implementation was a clear reference pattern — the batch version followed naturally. Extracting `applyRenameEdits` and `mergeFileEdits` kept both `moveFile` and `moveDirectory` clean. Folding the P2 issues (dir cleanup, sub-project corruption) into this spec was the right call — they were free side effects of the fix.

**What didn't go well:** The execution agent left "Step 1:", "Step 2:" comments transcribed from the prompt instructions, and duplicated the same test at two layers. Both were prompt quality issues — the agent did exactly what it was told. Added guidance to MEMORY.md to prevent recurrence.

**What took longer than expected:** The AC2 agent discovered two additional bugs (intra-directory edit filtering, ESM `.js`→`.ts` resolution in `rewriteMovedFileOwnImports`) that weren't anticipated in the spec. These are inherent to the batch approach and couldn't have been predicted without implementation.

**Recommendation for next agent:** The `tests/operations/moveDirectory_tsMorphCompiler.test.ts` file is at 365 lines — still near the review threshold. The Vue-specific tests (lines 183-290) test compiler behaviour through the operation layer and could be pushed down to the compiler test file during the next refactoring pass.
