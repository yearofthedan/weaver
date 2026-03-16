# moveFile: stale project graph causes false PARSE_ERROR on sequential moves

**type:** bug
**date:** 2026-03-16
**tracks:** handoff.md # moveFile-stale-graph

---

## Symptom

When calling `moveFile` multiple times in sequence (e.g., moving test files during a colocation migration), every call after the first returns:

```
{"ok":false,"error":"PARSE_ERROR","message":"ENOENT: no such file or directory, open '/workspaces/light-bridge/tests/compilers/__helpers__/mock-compiler.ts'"}
```

The move actually succeeds — the file lands at the new path with correct imports — but the response says `ok: false`. The referenced file (`mock-compiler.ts`) was moved in a previous `moveFile` call. The daemon's project graph still references the old path.

```
input:    moveFile("tests/compilers/ts.test.ts", "src/compilers/ts.test.ts")
          (after previously moving tests/compilers/__helpers__/mock-compiler.ts)
actual:   ok: false, error: "PARSE_ERROR", message: "ENOENT: ...mock-compiler.ts"
expected: ok: true, filesModified: ["src/compilers/ts.test.ts", ...]
```

## Value / Effort

- **Value:** High. Sequential moves are the common case — any agent moving multiple files (test colocation, package restructure, feature extraction) hits this on every call after the first. The false `ok: false` means agents can't trust the response and have no way to distinguish real failures from false negatives. This is a blocking dogfooding bug — discovered during test colocation Phase 1 (AC1).
- **Effort:** Moderate. The root cause is clear (hand-rolled move doesn't update the project graph), and ts-morph provides `sourceFile.move()` which handles this natively. The fix is localised to `TsMorphCompiler` but requires verifying that `sourceFile.move()` covers all the edge cases the current hand-rolled approach handles.

## Expected

Sequential `moveFile` calls succeed. Each call returns `ok: true` with the correct `filesModified` list. The project graph is updated after each move so subsequent operations see files at their new paths.

```
input:    moveFile("tests/compilers/__helpers__/mock-compiler.ts", "src/compilers/__helpers__/mock-compiler.ts")
          then: moveFile("tests/compilers/ts.test.ts", "src/compilers/ts.test.ts")
expected: both return ok: true with correct filesModified
          ts.test.ts import of mock-compiler.ts rewritten to new relative path
```

## Root cause

`TsMorphCompiler.getEditsForFileRename()` (line 179-222 of `src/compilers/ts.ts`) hand-rolls the move:

1. `invalidateProject(oldPath)` — deletes the cached ts-morph `Project`
2. `getProject(oldPath)` — creates a fresh `Project` from tsconfig
3. `addSourceFileAtPath(oldPath)` — adds the file being moved to the project
4. ts-morph resolves the file's imports, discovers a reference to a previously-moved file at its old path, tries to read it from disk → **ENOENT**

The fundamental issue: **we hand-rolled the file move instead of using ts-morph's native `sourceFile.move()` API.** The native API updates the project graph immediately after a move — subsequent operations see the file at its new path. Our approach destroys and rebuilds the project graph on every call, losing knowledge of previous moves within the same daemon session.

This is the same pattern as the `moveDirectory` bug (hand-rolled per-file loop when `directory.move()` was available). ts-morph 27.0.2 provides:

- `sourceFile.move(newPath)` — updates project graph, rewrites importers, queues physical move for `project.save()`
- `sourceFile.moveImmediatelySync(newPath)` — same but writes to disk immediately

A secondary issue compounds the problem: the catch-all error handler at `daemon.ts:229` labels any unhandled exception as `PARSE_ERROR`, making it indistinguishable from actual JSON parse failures.

## Fix

- [ ] **AC1: `TsMorphCompiler` project graph survives sequential moves.** Remove the destructive `invalidateProject(oldPath)` call from `getEditsForFileRename` — this is what causes the ENOENT (rebuilding the project from scratch loses knowledge of previous moves). In `afterFileRename`, replace `invalidateProject(newPath)` with an incremental graph update: remove the source file at the old path from the project, add the source file at the new path. The TS language service's `getEditsForFileRename` is preserved for import rewriting (it handles `.js` extensions, path aliases, and barrel re-exports correctly — verified that `sourceFile.move()` does not). The `afterFileRename` fallback scan for out-of-project files still runs after the graph update.

  *Narrowest wrong implementation:* removing `invalidateProject` from `getEditsForFileRename` but not updating the graph in `afterFileRename` — subsequent non-move operations (rename, findReferences) would still see the file at the old path.

- [ ] **AC2: Sequential `moveFile` calls succeed.** Regression test: move file A (which is imported by file B), then move file B. Both return `ok: true`. B's import of A is correctly rewritten to the new relative path. Test both in-project and out-of-project files.

  *Narrowest wrong implementation:* test only covers two files in the same tsconfig project. Must also test files outside tsconfig (the common case for test files).

- [ ] **AC3: Out-of-project files still get import rewriting.** Files outside tsconfig (tests, scripts, config) that import the moved file have their import specifiers updated via the existing `rewriteImportersOfMovedFile` fallback scan. `sourceFile.move()` only handles files in the project graph — the fallback covers the rest.

  *Narrowest wrong implementation:* removing the fallback scan because "sourceFile.move() handles everything". It doesn't — it only handles files in the project.

- [ ] **AC4: Error codes distinguish real failures from unexpected errors.** The catch-all at `daemon.ts:229` uses `INTERNAL_ERROR` (not `PARSE_ERROR`) for unhandled `Error` instances. `PARSE_ERROR` is reserved for actual JSON parse failures at `daemon.ts:220`.

  *Narrowest wrong implementation:* only changing the error code string without updating the `ErrorCode` union type in `errors.ts`, causing type errors or inconsistent error handling elsewhere.

## Security

- **Workspace boundary:** N/A — the fix changes how files are moved internally but doesn't alter workspace boundary enforcement. `WorkspaceScope.contains()` checks remain in `moveFile.ts`.
- **Sensitive file exposure:** N/A — no change to what file content is read or returned.
- **Input injection:** N/A — file paths go through the same `validateFilePath` + `isWithinWorkspace` checks.
- **Response leakage:** AC4 changes the error code string from `PARSE_ERROR` to `INTERNAL_ERROR` for unexpected errors. No file content is exposed in either case.

## Relevant files

| File | Why it matters |
|------|----------------|
| `src/compilers/ts.ts` (lines 179-222) | `getEditsForFileRename` — the hand-rolled move that AC1 replaces |
| `src/compilers/ts.ts` (lines 271-277) | `afterFileRename` — fallback scan that AC3 preserves |
| `src/operations/moveFile.ts` | Operation orchestrator — calls compiler methods in sequence |
| `src/daemon/daemon.ts` (line 229) | Catch-all error handler — AC4 fix |
| `src/utils/errors.ts` | `ErrorCode` union type — needs `INTERNAL_ERROR` added |
| `src/domain/rewrite-own-imports.ts` | Shared utility for moved file's own imports — may be superseded by `sourceFile.move()` for TsMorphCompiler |
| `src/domain/rewrite-importers-of-moved-file.ts` | Fallback scan for out-of-project importers — stays for AC3 |
| `src/plugins/vue/compiler.ts` (lines 155-168, 220-228) | VolarCompiler's hand-rolled move — same pattern, out of scope for this spec but worth noting |

### Red flags

- **`ts.ts` is 330 lines** — near the review threshold. The `getEditsForFileRename` removal (-40 lines) and `sourceFile.move()` addition (~10 lines) should net reduce.
- **VolarCompiler has the same hand-rolled pattern** — out of scope for this spec but should be tracked. VolarCompiler doesn't use ts-morph so `sourceFile.move()` doesn't help there.

## Edges

- **VolarCompiler:** Not changed by this spec. It uses the Volar language service, not ts-morph. The same sequential-move bug likely exists there but requires a different fix. Track separately.
- **`rewriteMovedFileOwnImports`:** May become dead code for the TsMorphCompiler path if `sourceFile.move()` handles the moved file's own imports. Verify before removing — VolarCompiler still needs it.
- **`moveDirectory`:** Already uses `directory.move()` (fixed in a recent session). Not affected by this change.
- **`moveSymbol`:** Uses `tsMoveSymbol` which operates on the ts-morph AST directly. Not affected.
- **Test reduction:** If `sourceFile.move()` handles import rewriting natively, some TsMorphCompiler-specific tests for `rewriteMovedFileOwnImports` and `afterFileRename` fallback scan edge cases may become redundant. Verify and remove in the same pass — don't leave dead tests.

## Resolved decisions

### Does `sourceFile.move()` handle all edge cases that `getEditsForFileRename` handles?

**Answer: No.** Verified empirically with ts-morph 27.0.2 (test: create `foo.ts` imported by `bar.ts` via `"./foo.js"`, move `foo.ts` to `subdir/foo.ts`):

1. **`.js` extension imports** — `sourceFile.move()` **strips** `.js` extensions. `import { hello } from "./foo.js"` becomes `"./subdir/foo"` (no `.js`). **Breaks ESM/nodenext projects.**
2. **Extensionless imports** — `import { hello } from "./foo"` was **NOT rewritten at all** when moving `foo.ts` to `subdir/foo.ts`. ts-morph failed to detect the dependency. Second bug.
3. **Barrel re-exports** — Specifier rewritten correctly but `.js` extension also stripped.
4. **Algorithm** — `sourceFile.move()` uses its own AST-based rewriting via `_referenceContainer` + `getRelativePathAsModuleSpecifierTo()`, not the TS language service.

**Decision: Keep the TS language service's `getEditsForFileRename` for import rewriting.** Fix the stale project graph by:
- Removing the destructive `invalidateProject()` from `getEditsForFileRename` (this is what causes the ENOENT — rebuilding the project from scratch loses knowledge of previous moves)
- In `afterFileRename`, replace `invalidateProject()` with incremental graph updates: `project.removeSourceFile(oldPath)` + `project.addSourceFileAtPath(newPath)`

**Consequences:**
- The `Compiler` interface does not change — no impact on VolarCompiler
- AC1 is reframed: keep `getEditsForFileRename` but fix the project graph lifecycle around it
- All existing import rewriting behaviour preserved (`.js` extensions, path aliases, barrel re-exports)
- `sourceFile.move()` findings documented in `docs/tech/ts-morph-apis.md` for future reference
- `moveDirectory` already uses `dir.move()` — `.js` extension stripping is a latent bug there too (add `[needs design]` entry)

## Done-when

- [x] All fix criteria (AC1-AC4) verified by tests
- [ ] Mutation score >= threshold for touched files (deferred to end of session)
- [x] `pnpm check` passes (lint + build + test) — 696 tests pass
- [x] Docs updated: `docs/features/moveFile.md` — updated graph update description, technical decisions section
- [x] Tech debt discovered during investigation added to handoff.md as `[needs design]` — `moveDirectory` `.js` stripping promoted to P1
- [x] Non-obvious gotchas added to `docs/tech/ts-morph-apis.md` — `sourceFile.move()` bugs, alternatives analysis, correct approach
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

### What shipped

- **AC1:** Removed destructive `invalidateProject()` from `getEditsForFileRename` and `afterFileRename`. Replaced with incremental graph updates (`removeSourceFile` + `addSourceFileAtPath`). The TS language service is preserved for import rewriting.
- **AC2:** Regression tests for sequential moves — both in-project (src files) and out-of-project (test files outside tsconfig include).
- **AC3:** Tests verifying the fallback scan (`rewriteImportersOfMovedFile`) still rewrites imports in out-of-project files after the incremental graph update.
- **AC4:** Catch-all error handler now uses `INTERNAL_ERROR` for unexpected errors. `SyntaxError` (from `JSON.parse`) still returns `PARSE_ERROR`. `INTERNAL_ERROR` added to `ErrorCode` union.
- **Verified end-to-end:** Two sequential `moveFile` calls through the live daemon both returned `ok: true` with correct import rewriting and `.js` extension preservation.

### Tests added: 5

1. `getEditsForFileRename` doesn't throw after dependency physically moved (AC1)
2. Sequential `moveFile` for in-project files succeeds with correct import rewriting (AC1/AC2)
3. Sequential moves of out-of-project files both return ok and rewrite imports correctly (AC2)
4. Fallback scan rewrites out-of-project importer on the second move after graph update (AC3)
5. `PARSE_ERROR` for invalid JSON, `INTERNAL_ERROR` for unexpected errors (AC4)

### Reflection

- **Could not reproduce the exact ENOENT in a unit test.** ts-morph silently skips missing files rather than throwing. The original bug likely manifested through a specific interaction between the TS language service's internal file reading and the project graph state that's hard to isolate in a synthetic fixture. The fix is directionally correct regardless — removing unnecessary `invalidateProject` is strictly better. Verified through the live daemon instead.
- **The spec's AC4 overcorrected.** The original spec said all non-EngineError exceptions should return `INTERNAL_ERROR`, but that made genuine JSON parse errors (`SyntaxError`) return a misleading code. Refined during implementation to check `instanceof SyntaxError` specifically.
- **Parallel AC execution would have saved time.** AC2+AC3 and AC4 were dispatched in parallel but ran on the same working tree. Using `isolation: "worktree"` would have been safer for truly independent ACs. Added to `.claude/MEMORY.md` as a process rule.
