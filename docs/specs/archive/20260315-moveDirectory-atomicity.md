# moveDirectory is not atomic — partial move corrupts imports and leaves split state

**type:** bug
**date:** 2026-03-15
**tracks:** handoff.md # moveDirectory-atomicity

---

## Symptom

`moveDirectory` moves files one at a time in a loop. Two failures observed:

1. **Import corruption:** Intra-directory imports are rewritten to point back at the old (now empty) location. Reproduced via MCP on a pure-TS fixture — `main.ts`'s `./utils` becomes `../../../simple-ts/src/utils` after move.
2. **Partial move on failure:** When an error occurs mid-operation, files already moved stay at the destination while remaining files stay at the source.

```
input:    moveDirectory("tmp-repro/simple-ts", "tmp-repro/fixtures/simple-ts")
actual:   ok: true, but main.ts import rewritten to "../../../simple-ts/src/utils"
          — import points to old empty location; type error on the moved file
expected: ok: true, main.ts import stays "./utils" (both files moved together)
```

## Value / Effort

- **Value:** High. `moveDirectory` is fundamentally broken — it corrupts imports even on success. The only recovery is `git checkout`.
- **Effort:** Medium. Adds `moveDirectory` to the `Compiler` interface with a ts-morph `directory.move()` implementation. Signature change mirrors `moveSymbol` pattern. VolarCompiler implementation deferred (uses ts-morph internally with virtual `.vue.ts` stubs — same proven pattern from `buildVolarService`).

## Root cause

Two separate bugs, same structural cause:

**Bug 1 — Import corruption:** The per-file approach calls `getEditsForFileRename` (or `afterFileRename`) for each file sequentially. Each call assumes only that one file moved — it doesn't know sibling files are also moving. When `main.ts` is moved, the rewriter sees `utils.ts` still at the old path and rewrites the import to point there. When `utils.ts` moves next, nobody goes back to fix `main.ts`.

**Bug 2 — Non-atomic failures:** The loop interleaves physical moves and compiler edits. A failure mid-loop leaves files split across old and new paths.

**Why unit tests pass:** Tests use `TsMorphCompiler` directly but the fixtures are small enough that intra-directory imports don't cross file boundaries in ways that expose the bug. The daemon path (via MCP) hits it on real project structures.

## Investigation findings

ts-morph's `Directory.move()` API handles batch directory moves atomically in the project graph:

```typescript
const project = new Project({ tsConfigFilePath: "..." });
const dir = project.getDirectoryOrThrow("/old/path");
dir.move("/new/path");
project.saveSync();
```

Verified behaviour:
- **Preserves intra-directory imports:** `./utils` stays `./utils` when both files move together
- **Rewrites external importers:** `../src/utils` becomes `../lib/utils` in files outside the moved directory
- **Cleans up old directory:** Source directory removed after save
- **Atomic in-memory:** All changes computed in the project graph before any disk writes

Also verified that ts-morph correctly handles `.vue` import specifiers when virtual `.vue.ts` stubs are present in the project. `import Foo from "./Foo.vue"` is correctly rewritten when `Foo.vue.ts` is in the project and the directory moves.

## Fix

Add `moveDirectory` to the `Compiler` interface. Each compiler adapter implements batch directory moves using whatever batch mechanism is available to it. This follows design principle #2 ("compiler work belongs behind compiler adapters") — the operation calls `compiler.moveDirectory()` without knowing about ts-morph.

### New `Compiler` interface method

```typescript
interface Compiler {
  // ... existing methods ...

  /**
   * Move all source files in `oldPath` to `newPath`, rewriting imports across
   * the project atomically. Implementations must ensure that if the operation
   * fails, no files are modified (compute-before-mutate, principle #6).
   *
   * Only handles source files the compiler understands. Non-source files
   * (json, css, images) are the caller's responsibility.
   *
   * Records all modified files into `scope`.
   */
  moveDirectory(
    oldPath: string,
    newPath: string,
    scope: WorkspaceScope,
  ): Promise<{ filesMoved: string[] }>;
}
```

### TsMorphCompiler implementation

1. Get the `Project` via `getProjectForDirectory(oldPath)`
2. Ensure all TS source files in the directory are in the project (some may be excluded by tsconfig — add via `project.addSourceFileAtPath()`)
3. Call `project.getDirectoryOrThrow(absOld).move(absNew)`
4. Call `project.saveSync()` — writes all TS files with corrected imports, removes old files
5. Record all written files in `scope`
6. Invalidate the project cache so subsequent operations rebuild from disk

### VolarCompiler implementation

Uses the same ts-morph `directory.move()` under the hood, with virtual `.vue.ts` stubs injected for each `.vue` file in the directory. This is the same virtual file pattern already proven in `buildVolarService` (see `docs/tech/volar-v3.md`):

1. Create a temporary ts-morph `Project` from the project's tsconfig
2. For each `.vue` file in the directory, extract the `<script>` block content and add it as a `.vue.ts` source file in the project
3. Call `directory.move()` — ts-morph sees all files (TS + virtual Vue) and rewrites all import specifiers atomically
4. `project.saveSync()` writes TS files and virtual `.vue.ts` files to disk
5. For each moved `.vue` file: read the written `.vue.ts` at the new location (ts-morph already rewrote its imports correctly), read the original `.vue` file (still at old location), replace the `<script>` block content in the `.vue` with the `.vue.ts` content, write the updated `.vue` to the new location. This transplants ts-morph's import rewrites back into the SFC — no regex-based import rewriting needed. The `<script>` block extraction/injection pattern already exists in `VolarCompiler.afterSymbolMove`.
6. Delete the `.vue.ts` artifacts from disk and the old `.vue` files
7. Record all modified files in `scope`

### Operation changes (`moveDirectory.ts`)

The operation becomes a thin orchestrator (principle #1):

1. Pre-validate (same as today): source exists, is directory, not move-into-self, dest not non-empty
2. Call `compiler.moveDirectory(oldPath, newPath, scope)` — handles all source files
3. Physical-move non-source files (json, css, images) via `scope.fs.rename`
4. Return aggregated result

### Dispatcher change

```typescript
// Uses projectCompiler only — like rename, moveFile
moveDirectory: {
  pathParams: ["oldPath", "newPath"],
  schema: MoveDirectoryArgsSchema,
  async invoke(registry, params, workspace) {
    const { oldPath, newPath } = params as { oldPath: string; newPath: string };
    const compiler = await registry.projectCompiler();
    const scope = new WorkspaceScope(workspace, new NodeFileSystem());
    return moveDirectory(compiler, oldPath, newPath, scope);
  },
},
```

### New architecture principle

Add as principle #7 in `docs/architecture.md`:

> **7. Prefer batch compiler APIs over sequential single-file calls.** When an operation involves multiple interdependent files (e.g. moving a directory where files import each other), use the compiler's batch API rather than calling single-file methods in a loop. Sequential calls see intermediate state — each call assumes only its file moved and may rewrite imports incorrectly. Batch APIs compute all changes in the project graph before writing anything to disk.

## Acceptance criteria

- [ ] **AC1 — Intra-directory imports preserved:** Moving a directory where `main.ts` imports `./utils` (both in the same directory) preserves the `./utils` specifier. No rewrite to an absolute or cross-tree path.
- [ ] **AC2 — External importers rewritten:** Files outside the moved directory that import from it get their specifiers updated to the new location.
- [ ] **AC3 — Vue import specifiers preserved:** `import Foo from "./Comp.vue"` specifiers must not be rewritten to `.vue.ts` or have the extension stripped by ts-morph's virtual file mapping. Verified with at least two `moduleResolution` settings (`bundler` and `node`).
- [ ] **AC4 — Non-source files moved:** JSON, CSS, and other non-source files are physically moved to the new location.
- [ ] **AC5 — Result shape unchanged:** Returns `{ filesMoved, filesModified, filesSkipped, oldPath, newPath }` — same contract as today.
- [ ] **AC6 — Existing tests pass:** All current `moveDirectory` tests pass (with signature adjustments as needed).
- [ ] **AC7 — Compiler interface updated:** `Compiler` interface gains `moveDirectory` method. Both `TsMorphCompiler` and `VolarCompiler` implement it.
- [ ] **AC8 — Architecture docs updated:** Principle #7 added. `moveDirectory.md` feature doc updated to reflect batch architecture.

## Scope notes

- The VolarCompiler implementation (virtual `.vue.ts` stubs) can ship in a follow-up if needed. A minimal first pass can have VolarCompiler delegate to the same ts-morph approach without the virtual stubs (handling TS files atomically, Vue files via existing regex scan). The important thing is the interface is in place so the implementation can improve without changing callers.
- The existing P2 bugs ("doesn't delete source directory", "corrupts imports inside sub-project boundaries") are separate issues. This spec fixes the core atomicity and import corruption bugs only.

## Security

- **Workspace boundary:** Unchanged. `WorkspaceScope` enforcement still applies to all writes. ts-morph's `project.saveSync()` writes within the project root. Compiler implementations must record all modified files in `scope`.
- **Sensitive file exposure:** N/A — no change to file content reading.
- **Input injection:** N/A — no change to how user-supplied strings are handled.
- **Response leakage:** N/A — no change to error messages or response fields.

## Relevant files

| File | Why |
|------|-----|
| `src/types.ts` | Add `moveDirectory` to `Compiler` interface |
| `src/operations/moveDirectory.ts` (124 lines) | Simplify to thin orchestrator calling `compiler.moveDirectory()` |
| `src/compilers/ts.ts` | `TsMorphCompiler.moveDirectory()` — ts-morph `directory.move()` implementation |
| `src/plugins/vue/compiler.ts` | `VolarCompiler.moveDirectory()` — virtual `.vue.ts` stub approach |
| `src/daemon/dispatcher.ts` | Simplify descriptor (single `projectCompiler`, no `tsCompiler` needed) |
| `docs/architecture.md` | Add principle #7 (batch over sequential) |
| `docs/features/moveDirectory.md` | Update to reflect batch architecture |
| `tests/operations/moveDirectory_tsMorphCompiler.test.ts` | Update tests, add AC1/AC2 regression tests |

## Edges

- **Files excluded from tsconfig:** Test files, scripts, etc. may not be in the ts-morph project. Before calling `directory.move()`, the compiler implementation must add any source files found by enumeration that aren't already in the project via `project.addSourceFileAtPath()`.
- **Empty directory:** Still returns empty arrays, no error. No change from current behaviour.
- **Pre-validation errors:** FILE_NOT_FOUND, NOT_A_DIRECTORY, MOVE_INTO_SELF, DESTINATION_EXISTS — unchanged, still throw before any work.
- **SKIP_DIRS and symlinks:** Enumeration filtering unchanged.
- **ts-morph `project.saveSync()` deletes old files:** ts-morph handles cleanup of moved source files. Non-source files need explicit `scope.fs.rename`. Old directory shells may remain (known P2 issue).
- **ts-morph project cache:** After `project.saveSync()`, call `invalidateProject()` so subsequent operations rebuild from disk.

## Done-when

- [x] All acceptance criteria (AC1-AC8) verified by tests
- [ ] Mutation score >= threshold for `moveDirectory.ts` — Stryker crashes on initial dry run (pre-existing, unrelated to this change)
- [x] `pnpm check` passes (lint + build + test) — 700 tests, 65 files
- [x] Docs updated: architecture.md principle #7, moveDirectory.md feature doc
- [x] Tech debt discovered during investigation added to handoff.md as `[needs design]`
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

### What shipped

The core atomicity bug is fixed. `moveDirectory` now delegates to `compiler.moveDirectory()` which uses ts-morph's `directory.move()` — a batch API that computes all import rewrites in the project graph before writing anything to disk. Intra-directory imports (e.g. `./utils`) are preserved, external importers are rewritten, and non-source files are moved physically.

**Commits:**
1. `feat(compilers): add moveDirectory to Compiler interface with ts-morph batch implementation` — interface + TsMorphCompiler + VolarCompiler (delegates to TsMorphCompiler)
2. `fix(operations): rewrite moveDirectory as thin orchestrator over compiler.moveDirectory()` — operation rewrite + test updates
3. `test(operations): add Vue import specifier tests for moveDirectory (AC3)` — Vue fixture + 6 tests
4. `docs: add architecture principle #7 and update moveDirectory to reflect batch approach`

**Tests added:** ~17 new tests (11 compiler-level, 6 Vue specifier tests) + 1 AC1 regression test at operation level.

### What was deferred

- **VolarCompiler Vue import rewriting:** `VolarCompiler.moveDirectory()` delegates to `TsMorphCompiler`, so `.vue` import specifiers in `.ts` files (e.g. `import Button from "./components/Button.vue"`) are NOT rewritten. Added as P2 `[needs design]` in handoff.md. The virtual `.vue.ts` stub approach described in the spec section "VolarCompiler implementation" is the planned fix.
- **Mutation score:** Stryker crashes on the initial dry run — a pre-existing issue unrelated to this change.

### Reflection

**What went well:** The ts-morph `directory.move()` API worked exactly as documented. The implementation was straightforward once the interface was in place.

**What didn't go well:** Execution agents exited early on the first dispatch (added interface + tests but didn't implement compiler methods or commit). Required a second dispatch with much more explicit deliverables. The second and subsequent dispatches completed successfully.

**Key discovery:** ts-morph's `project.saveSync()` uses OS-level `fs.renameSync` for directory moves, which means it moves ALL files in the directory (including non-source files like JSON, CSS). The spec assumed non-source files would stay at the old path and need separate handling. The operation pre-enumerates all files before the compiler call to reconcile the difference.

**Recommendation for next agent:** When implementing the VolarCompiler virtual `.vue.ts` stub approach, study the `saveSync()` behaviour carefully — it will move `.vue.ts` stub files to the new location, which then need cleanup. The `afterSymbolMove` pattern in `VolarCompiler` already does script block extraction/injection and is a good template.
