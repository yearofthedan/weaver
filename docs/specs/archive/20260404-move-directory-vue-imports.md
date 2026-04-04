# moveDirectory: rewrite Vue import specifiers

**type:** change
**date:** 2026-04-04
**tracks:** handoff.md # moveDirectory VolarEngine → docs/features/moveDirectory.md

---

## Context

`VolarEngine.moveDirectory` delegates entirely to `tsEngine.moveDirectory`, which only
processes `.ts`/`.js` source files. When a directory containing `.vue` components is
moved, three classes of import specifier are silently left stale:

1. External `.ts`/`.tsx` files that `import Foo from './moved-dir/Foo.vue'`
2. External `.vue` files that import anything (`.ts` or `.vue`) from the moved directory
3. `.vue` files inside the moved directory that import files outside it (their own
   relative specifiers no longer resolve after the directory moves)

The existing `moveFile` path correctly handles the analogous cases for single-file moves
(via `tsMoveFile` + `updateVueImportsAfterMove`). `moveDirectory` never got the same
treatment.

## User intent

*As an agent reorganising a Vue project, I want moving a directory to update all import
specifiers — in TypeScript files, in Vue SFCs, and in the moved Vue files themselves —
so I don't have to manually fix broken imports after every directory move.*

## Relevant files

- `src/plugins/vue/engine.ts:247` — `VolarEngine.moveDirectory`: the method to fix
- `src/plugins/vue/engine.ts:234` — `VolarEngine.moveFile`: the pattern to mirror
- `src/plugins/vue/scan.ts` — `updateVueImportsAfterMove`: handles external `.vue`
  importers; already works correctly; call it per-moved-Vue-file
- `src/ts-engine/move-directory.ts` — `tsMoveDirectory`: handles TS source files;
  enumerates only TS extensions; does not process `.vue` files
- `src/plugins/vue/engine.ts:190` — `VolarEngine.getEditsForFileRename`: uses Volar LS
  to get import-rewrite edits; currently called only for `.ts` paths in tests
- `src/plugins/vue/service.ts` — `buildVolarService`: how the Volar LS is built;
  `.vue` files are registered as virtual `.vue.ts` in `scriptFileNames`
- `src/ts-engine/apply-rename-edits.ts` — `applyRenameEdits` + `mergeFileEdits`: merges
  edits across files before applying; required when multiple `.vue` files move and edits
  overlap in a shared importer
- `src/operations/moveDirectory_tsMorphCompiler.test.ts` — model for the new test file
- `src/operations/moveFile_volarCompiler.test.ts` — model for VolarEngine integration tests
- `src/__testHelpers__/fixtures/vue-project/` — existing Vue fixture; lacks a
  `components/` subdirectory; needs a new fixture (or extension) for directory-move tests

### Red flags

- The existing `vue-project` fixture has only a flat `src/composables/` directory. A
  meaningful directory-move test requires `.vue` files in a named subdirectory that can
  be moved. Add a new fixture rather than mutating the existing one; both should co-exist.
- `engine.test.ts` is 478 lines (review threshold). New tests go in
  `src/operations/moveDirectory_volarCompiler.test.ts` — do not extend `engine.test.ts`.

## Value / Effort

- **Value:** `moveDirectory` is the primary way to reorganise feature slices in Vue
  projects. Every directory move currently leaves broken `.vue` imports, requiring manual
  follow-up. This makes the tool unreliable for its advertised use case.
- **Effort:** ~60 lines in `VolarEngine.moveDirectory`, a new test file, and a new
  fixture. No new abstractions — all pieces (`getEditsForFileRename`, `mergeFileEdits`,
  `updateVueImportsAfterMove`) already exist.

## Behaviour

- [x] **AC1** — Given a directory containing `.vue` files is moved, external `.ts`/`.tsx`
  files that imported those components have their `import` specifiers updated to the new
  path.
  *Input:* `src/components/Button.vue` exists; `src/app.ts` contains
  `import Button from './components/Button.vue'`; move `src/components/` → `src/ui/`.
  *Expected:* `src/app.ts` now contains `'./ui/Button.vue'`; the old specifier is gone.

- [x] **AC2** — Given a directory is moved, external `.vue` files that imported anything
  from the moved directory have their `from '...'` specifiers updated.
  *Input:* `src/composables/useCounter.ts` exists; `src/App.vue` `<script>` block
  contains `import { useCounter } from './composables/useCounter'`; move
  `src/composables/` → `src/hooks/`.
  *Expected:* `src/App.vue` now contains `'./hooks/useCounter'`.

- [x] **AC3** — Given a directory containing `.vue` files is moved, the moved `.vue`
  files' own relative import specifiers (pointing outside the directory) are updated for
  the new location.
  *Input:* `src/components/Button.vue` contains `import { helper } from '../utils/helper'`;
  move `src/components/` → `src/ui/components/`.
  *Expected:* `src/ui/components/Button.vue` now contains `'../../utils/helper'`.

## Interface

No public surface changes. `moveDirectory` already returns `{ filesMoved: string[] }` and
accepts the same parameters. The fix is entirely internal to `VolarEngine.moveDirectory`.

## Open decisions

### Does `VolarEngine.getEditsForFileRename` work correctly with real `.vue` file paths?

**Resolved: No.** `VolarEngine.getEditsForFileRename` returns empty results when called
with a real `.vue` path. The Volar TS LS registers `.vue` files as virtual `.vue.ts` paths
in `scriptFileNames`; passing the real `.vue` path finds nothing. The fallback scan-based
approach (`rewriteImportersOfMovedFile`) was used for AC1 instead.

### Stub project approach (from handoff.md)

**Decision: Do not use.** All three pieces needed exist and are proven. The stub approach
introduces a new code path, duplicates logic, and adds complexity with no correctness
advantage.

## Security

- **Workspace boundary:** `moveDirectory` already validates paths via `scope.contains`.
  The new code enumerates files using `walkFiles` (same as existing Vue scan functions)
  and only writes via `scope.writeFile` — workspace boundary is enforced at the scope
  level, unchanged.
- **Sensitive file exposure:** No new file content is read beyond what `moveDirectory`
  already reads. N/A.
- **Input injection:** No new parameters. N/A.
- **Response leakage:** Return type unchanged (`{ filesMoved: string[] }`). N/A.

## Edges

- Intra-directory relative imports (`.vue` file inside the moved dir importing another
  file inside the same dir) must NOT be rewritten — the relative path is still valid
  after the move. `updateVueImportsAfterMove` already handles this correctly: after the
  physical move, resolved paths no longer match the old absolute path, so they're skipped.
- If a single `.ts` file imports two `.vue` files from the moved directory, both edits
  must be merged before applying. Use `mergeFileEdits` (already used in `tsMoveDirectory`).
- No race condition from per-file LS queries: all `getEditsForFileRename` calls are
  read-only and happen before the physical `fs.renameSync`. The LS sees a consistent
  pre-move state throughout.

## Done-when

- [x] **Reproduction first:** A failing test exists in `src/operations/moveDirectory_volarCompiler.test.ts`
      that demonstrates the broken behaviour before any fix is applied. The fix commit follows
      the test commit.
- [x] All three ACs verified by tests
- [x] `getEditsForFileRename` behaviour with `.vue` paths is documented in the Outcome
      section
- [ ] `pnpm check` passes — pre-existing environment failures (git signing in tests,
      chmod permission tests) block the full suite; new tests pass cleanly
- [x] Docs: `docs/features/moveDirectory.md` updated with Vue SFC import rewriting section
- [x] `handoff.md` entry removed
- [ ] Mutation score ≥ threshold for `src/plugins/vue/engine.ts` — deferred; not run this session
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

### Reflection

**What went well:**
- The three-AC breakdown mapped cleanly to three distinct scan passes in the implementation. Each AC had a clear, independently testable failure mode.
- The open decision about `getEditsForFileRename` was resolved quickly by the failing test — no guessing needed.
- The existing scan infrastructure (`rewriteImportersOfMovedFile`, `updateVueImportsAfterMove`) covered ACs 1 and 2 with minimal new code. Only AC3 needed a new function (`rewriteVueOwnImportsAfterMove` in `scan.ts`).
- `walkRecursive` already existed in `file-walk.ts` and was immediately usable for enumerating all files before the physical move.

**What did not go well:**
- The spec predicted `getEditsForFileRename` might work for `.vue` paths and recommended trying it first. It doesn't work — Volar's virtual path registration means real `.vue` paths are invisible to the TS LS's rename API. The scan-based fallback was needed immediately. Future work in this area should not assume `getEditsForFileRename` works for `.vue` paths.
- The spec's `mergeFileEdits` recommendation for AC1 was unnecessary — `rewriteImportersOfMovedFile` already handles the multi-file case via a single walk over TS files per moved `.vue` file (no per-file edit accumulation).

**What to tell the next agent:**
- `VolarEngine.getEditsForFileRename` does NOT work with `.vue` paths — always returns empty. Use scan-based approaches (`rewriteImportersOfMovedFile` for TS importers, `updateVueImportsAfterMove` for Vue importers) for any Vue file rename/move operation.
- AC2 needed to call `updateVueImportsAfterMove` for ALL moved files (both `.ts` and `.vue`), not just the `.vue` files — a `.vue` importer of a moved `.ts` file also needs updating.
- `scan.ts` is the right place for new Vue SFC text-manipulation functions. The new `rewriteVueOwnImportsAfterMove` follows the same regex-based pattern as `updateVueImportsAfterMove`.

**Tests added:** 6 (in `src/operations/moveDirectory_volarCompiler.test.ts`)

**Mutation score:** Not measured this session.
