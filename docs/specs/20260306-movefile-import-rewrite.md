# moveFile does not reliably update import references

**type:** bug
**date:** 2026-03-06
**tracks:** handoff.md # moveFile-import-rewrite

---

## Symptom

After `moveFile` moves a source file, import paths in other in-project files that reference the moved file are sometimes not rewritten. The agent (or user) must manually fix the broken imports with `replaceText`. This is the most common source of manual cleanup after a move.

The failure is intermittent -- the same move works in a fresh project but fails in a long-lived daemon session or after a sequence of prior operations. Test-file imports are affected more often, but source-file imports within `tsconfig.include` are also affected under certain conditions.

## Value / Effort

- **Value:** High. `moveFile` is the most frequently used refactoring tool. Every missed import rewrite forces a manual `searchText` + `replaceText` cycle, which defeats the purpose of a compiler-aware move. Agents cannot reliably detect that imports were missed (no error is returned -- the move reports `ok: true`), so the breakage is often discovered only when `getTypeErrors` is called or the build fails.

- **Effort:** Medium. The root cause has multiple contributing factors (see below). The primary fix is localised to `TsProvider.getEditsForFileRename` and `moveFile.ts`, but each contributing factor needs its own regression test.

Reproduction (daemon mode, stale cache):

```
input:    Agent creates src/newHelper.ts importing from ./utils.ts, then calls
          moveFile(src/utils.ts, src/lib/utils.ts)
actual:   src/main.ts is updated (was in project at load time),
          src/newHelper.ts is NOT updated (added after project load,
          watcher debounce has not fired)
expected: Both src/main.ts and src/newHelper.ts have their import paths rewritten
```

Reproduction (symlinked workspace):

```
input:    Workspace is at /real/path/project, accessed via symlink /workspaces/project.
          moveFile(/workspaces/project/src/utils.ts, /workspaces/project/src/lib/utils.ts)
actual:   ts-morph project stores files under /real/path/project/src/*.ts internally.
          getEditsForFileRename receives /workspaces/project/src/utils.ts as oldPath,
          which does not match the internal canonical path. No edits are returned.
expected: Import paths in all referencing files are rewritten regardless of symlinks.
```

Reproduction (import extension mismatch):

```
input:    src/b.ts contains: import { foo } from "./utils.js"
          tsconfig has moduleResolution: "node" (or omitted, defaulting to "node")
          moveFile(src/utils.ts, src/lib/utils.ts)
actual:   TS module resolver cannot resolve "./utils.js" to "./utils.ts" under
          moduleResolution: "node". getSymbolAtLocation returns undefined.
          The import in src/b.ts is not updated.
expected: Import is rewritten to "../lib/utils.js"
```

## Expected

Every file in the project graph that contains an import/export/re-export referencing the moved file must have its specifier updated to the correct relative path. This includes:

1. Files that were in the program at project load time
2. Files that were added or modified after project load but before the move call
3. The moved file's own imports (already working in most cases)
4. Files accessed through a symlinked workspace path

The operation should return the updated files in `filesModified` so agents know what changed.

## Root cause

Three contributing factors, each independently sufficient to cause missed import rewrites:

### Factor 1: Stale ts-morph project in daemon mode

`TsProvider` caches `Project` instances by tsconfig path (`this.projects` map). The project is populated from tsconfig `include` at creation time. Files added to disk after project creation are not in `program.getSourceFiles()`. The file watcher (`startWatcher`) calls `invalidateAll` on file-add events, but with a 200ms debounce. If an agent creates a file and immediately calls `moveFile` (within the debounce window), the project cache is stale.

**Source:** `src/providers/ts.ts` lines 13-29 (project cache), `src/daemon/watcher.ts` line 23 (debounce constant).

The TS language service `getEditsForFileRename` iterates `program.getSourceFiles()` to find imports to update (TypeScript source: `updateImports` function in `src/services/getEditsForFileRename.ts`). Files not in the program are invisible to this iteration.

### Factor 2: Symlink path mismatch

`assertFileExists` uses `path.resolve()` which does not resolve symlinks. ts-morph's internal `Project` may store file paths using the real (resolved) path. When `getEditsForFileRename(oldPath, newPath)` is called with a symlink-based path, the `getPathUpdater` comparison in TypeScript (`getCanonicalFileName(pathToUpdate) === canonicalOldPath`) may fail because the symlinked path does not match the internal real path.

**Source:** `src/utils/assert-file.ts` line 11 (`path.resolve`, not `fs.realpathSync`), `src/providers/ts.ts` line 160.

This affects all environments where the workspace is accessed via a symlink (dev containers, CI with `/workspaces/` mounts, projects with symlinked directories in the tree).

### Factor 3: Module resolution and .js extensions

When source files use `.js` extensions in import specifiers (common in ESM-first projects), and the tsconfig uses `"moduleResolution": "node"` (the default), the TypeScript module resolver cannot resolve `./utils.js` to `./utils.ts`. In `getEditsForFileRename`, the `getSymbolAtLocation(importLiteral)` call returns `undefined` for these unresolved imports. The fallback path (`getResolvedModuleFromModuleSpecifier`) also fails. The import is silently skipped.

**Source:** TypeScript `updateImports` function, line handling `importedModuleSymbol === undefined`.

This is arguably a TypeScript limitation, but light-bridge can work around it in `afterFileRename` using the same text-based fallback already used for out-of-project files.

## Fix

Acceptance criteria:

- [ ] **AC1: Fresh project state before computing rename edits.** Before calling `ls.getEditsForFileRename`, the provider ensures the ts-morph project reflects the current disk state. The simplest correct approach is to invalidate and rebuild the project inline at the start of `getEditsForFileRename`. The fix must not require the watcher debounce to fire first.

  **Why not a reindexing queue?** A queue would batch invalidation events and rebuild asynchronously, reducing redundant rebuilds. But for this bug, the problem is that the move operation needs a fresh project *right now*, before computing edits. A queue doesn't help -- the operation can't wait for an async reindex that may or may not have been scheduled. The correct fix is synchronous: invalidate, rebuild, then compute. The watcher's debounced invalidation still serves its purpose (keeping the project fresh between explicit operations), and the inline invalidation here is a safety net that guarantees freshness at the moment it matters. If the project is already fresh (common case -- no files changed since load), `ts-morph` should detect no changes and the rebuild is a near-no-op. If profiling shows the rebuild is expensive even when nothing changed, a cheaper staleness check (compare `program.getSourceFiles()` count against a quick `walkFiles` count) can be added as a fast path.

- [ ] **AC2: Symlink-aware path resolution.** Paths passed to `getEditsForFileRename` are resolved through `fs.realpathSync` (or equivalent) to match ts-morph's internal path representation. If `oldPath` or `newPath` contains symlinks, the real paths are used for the TS language service call, but the original (symlink-based) paths are preserved for the `MoveResult` response and the physical `renameSync`.

  **Security note: symlink resolution must not bypass workspace boundary checks.** The existing `isWithinWorkspace` already resolves symlinks and checks the real path against the workspace (see `src/security.ts` lines 137-143). The dispatcher validates `oldPath` and `newPath` via `isWithinWorkspace` *before* calling `moveFile`. So the boundary check happens on both the symlink path and the real path before the operation runs. The `realpathSync` call in the provider is purely for ts-morph path matching -- it runs after the security check has already passed. However, the implementation must not introduce a new TOCTOU window: the `realpathSync` result should be used only for the `getEditsForFileRename` call, not for the physical `renameSync` (which uses the original validated path). The existing TOCTOU risk documented in `docs/tech/tech-debt.md` ("Security: TOCTOU race in symlink checks") is accepted and unchanged by this fix.

  **Additional consideration:** `isWithinWorkspace` uses `path.resolve(workspace)` as the boundary, not `realpathSync(workspace)`. If the workspace path itself is a symlink (e.g., `/workspaces/project` -> `/real/path/project`), then `realpathSync(oldPath)` produces `/real/path/project/src/utils.ts` but the workspace boundary is `/workspaces/project`. The `path.relative` check in `isWithinWorkspace` would see the real path as outside the workspace. This is already handled: `isWithinWorkspace` checks both the resolved path and the real path. But the implementation should verify this with a test (covered by AC4b).

- [ ] **AC3: Unresolved-import fallback for in-project files.** If `getEditsForFileRename` returns no edit for a file that has a string-literal import matching the old path's relative form (with or without extension), the `afterFileRename` text-based scan catches it. This extends the existing out-of-project fallback to also cover in-project files where module resolution failed.

  **Double-rewrite safety.** The concern is that a file already rewritten by `getEditsForFileRename` could be rewritten again by the fallback, corrupting it. This is safe because the fallback matches against the *old* relative path (e.g., `./utils`). If `getEditsForFileRename` already rewrote it to `../lib/utils`, the old specifier no longer appears in the file, so the fallback's string match fails and the file is skipped. To make this explicit, the `afterFileRename` scan should receive the set of files already modified by `getEditsForFileRename` and skip them entirely -- this is both a correctness safety net and a performance optimization (avoids parsing files that were already handled).

  **Coexisting `.js` and `.ts` files.** The fallback must NOT treat `./utils.js` as an alias for `./utils.ts` when an actual `utils.js` file exists on disk alongside `utils.ts`. Before rewriting an import with a `.js` extension, check `fs.existsSync` on the literal `.js` path — if it exists, the import genuinely refers to the JS file and must not be rewritten. The same guard applies to `.mjs`/`.mts`, `.cjs`/`.cts`, and `.jsx`/`.tsx` extension pairs.

  **Substring false positives.** The fallback must match on full import specifiers, not substrings. For example, if the moved file is `utils.ts`, the fallback must not rewrite imports of `./my-utils` or `./utils.test`. Match against the complete module specifier as parsed from the import declaration, not a regex against file contents.

  **Re-export chains and the skip set.** The skip set passed to the fallback should be based on "was the import specifier actually rewritten in this file," not just "was the file included in `getEditsForFileRename` results." A barrel file (`index.ts`) might appear in the edit set because one of its re-exports was updated, but it could have a second re-export with a `.js` extension that was missed. Using file-level granularity for the skip set is acceptable as a pragmatic first pass (the double-rewrite safety net handles the rest), but this edge case should be documented.

  **Side effect: the fallback scan walks the entire workspace.** Currently `afterFileRename` only processes files NOT in `projectFilePaths`. Extending it to also cover in-project files means removing the `projectFilePaths.has(filePath) continue` skip. This changes the scan from "out-of-project files only" to "all workspace files not already handled by `getEditsForFileRename`." The walk uses `git ls-files` (fast) or recursive readdir, then parses each candidate with a throwaway ts-morph project. For a 500-file workspace where `getEditsForFileRename` handled 490 files, only 10 files would actually be parsed. The implementation should pass the set of already-modified files (from step 1) as a skip set, NOT the project file set. This way in-project files with unresolved imports are caught, but files already correctly handled are not re-parsed.

  **ts-morph `setModuleSpecifier` formatting.** The fallback uses `decl.setModuleSpecifier()` which may produce slightly different formatting than what `getEditsForFileRename` produces (e.g., quote style, trailing semicolons). Since the fallback only runs on files NOT already handled, this is not a conflict risk. But the implementation should verify that `setModuleSpecifier` preserves the existing quote style of the file (ts-morph does this by default).

- [ ] **AC4: Regression tests for each factor.** Three test cases:
  - (a) Create a file importing the target, then move the target in the same provider instance without invalidation -- import must be rewritten.
  - (b) Move a file using a symlinked workspace path -- imports must be rewritten. (May require a test helper that creates a temp symlink.)
  - (c) Move a file where an importer uses `.js` extension with `moduleResolution: "node"` -- import must be rewritten.

- [ ] **AC5: `filesModified` includes all files that were actually rewritten.** No file is silently modified without appearing in the response.

> Adjacent inputs considered: moving to a deeper directory (import path gains `../` segments), moving to a shallower directory (import path loses `../` segments), moving within the same directory (rename, path prefix unchanged), moving an index file (`utils/index.ts` to `lib/index.ts` -- directory imports like `./utils` should become `./lib`).

## Edges

- **The P2 item (files outside `tsconfig.include`) is explicitly out of scope.** The `afterFileRename` fallback for out-of-project files already exists and is a separate task. This spec only extends the fallback to cover in-project resolution failures (AC3).

- **The fix must not break the happy path.** The existing test "moves a file and updates imports" must continue to pass. The fix must not cause double-rewriting (once by `getEditsForFileRename`, once by the fallback scan).

- **The `afterFileRename` fallback scan (AC3) must not rewrite files already handled by `getEditsForFileRename`.** The set of files returned by `getEditsForFileRename` should be passed to `afterFileRename` so the fallback knows which files to skip.

- **Vue projects are not directly affected.** The Vue provider has its own `afterFileRename` scan. However, if the same stale-cache issue affects `VolarProvider.getEditsForFileRename`, the same invalidation fix (AC1) should be applied there too. The spec does not add VolarProvider ACs but the implementation should check.

- **Performance.** Invalidating/rebuilding the project on every `moveFile` call adds latency. For a typical project (< 500 files), this should be < 500ms. If profiling shows it's too slow, a targeted `resolveSourceFileDependencies` might be cheaper than a full rebuild. The implementation should measure and document.

- **`notifyFileWritten` is a no-op for TsProvider.** This is by design (ts-morph reads from disk). But it means the project cache is not updated after `moveFile` writes edits to disk. Subsequent operations in the same daemon session will use stale in-memory state until the watcher fires. This is a pre-existing issue and not in scope for this spec, but worth noting in `docs/agent-memory.md`.

## Done-when

- [ ] All fix criteria (AC1-AC5) verified by tests
- [ ] Existing moveFile tests still pass (no regression)
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (use `docs/specs/templates/feature.md` for new feature docs)
- [ ] `docs/features/moveFile.md` Constraints section updated to remove or soften the "imports in files outside the project graph may not be updated" caveat for in-project files
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
