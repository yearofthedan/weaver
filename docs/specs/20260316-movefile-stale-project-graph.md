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

- [ ] **AC1: `TsMorphCompiler` uses `sourceFile.move()` for file renames.** Replace the hand-rolled `getEditsForFileRename` + manual edit application + physical rename with ts-morph's native `sourceFile.move()` (or `moveImmediatelySync`). The project graph stays correct across sequential operations — no stale references, no ENOENT. The `afterFileRename` fallback scan for out-of-project files still runs after the native move to catch files outside tsconfig. Verify that `sourceFile.move()` handles: `.js` extension preservation in import specifiers, `moduleResolution: "node"` vs `"nodenext"`, type-only imports, re-exports, and side-effect imports.

  *Narrowest wrong implementation:* using `sourceFile.move()` but not calling `project.save()` / `project.saveSync()`, leaving the physical file at the old path. Or: using `sourceFile.move()` but not running the `afterFileRename` fallback, breaking out-of-project files.

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

## Open decisions

### Does `sourceFile.move()` handle all edge cases that `getEditsForFileRename` handles?

The TS language service's `getEditsForFileRename` and ts-morph's `sourceFile.move()` use different algorithms. Before committing to the switch, verify these edge cases:

1. **`.js` extension imports** — `import { x } from "./foo.js"` when moving `foo.ts`. Does `sourceFile.move()` preserve the `.js` extension?
2. **`moduleResolution: "node"` vs `"nodenext"`** — different resolution strategies may produce different specifier rewrites.
3. **Path aliases** (`paths` in tsconfig) — are aliased imports left untouched?
4. **Barrel re-exports** — `export { x } from "./foo"` in an index file.

**Approach:** Write the AC2 regression test first with these edge cases. Run it against both the current implementation and the `sourceFile.move()` implementation. If `sourceFile.move()` fails any case, keep the TS language service for that case and document the gap.

## Done-when

- [ ] All fix criteria (AC1-AC4) verified by tests
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated: `docs/features/moveFile.md` if behaviour or error codes changed
- [ ] Tech debt discovered during investigation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/tech/ts-morph-apis.md` (new file — document `sourceFile.move()` behaviour, edge cases discovered, and comparison with `getEditsForFileRename`)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
