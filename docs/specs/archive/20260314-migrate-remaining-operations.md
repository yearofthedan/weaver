# Migrate remaining operations to WorkspaceScope + FileSystem port

**type:** change
**date:** 2026-03-14
**tracks:** handoff.md # migrate-remaining-operations

---

## Context

`deleteFile`, `extractFunction`, `getTypeErrors`, `searchText`, and `replaceText` still use `workspace: string` parameters, direct `node:fs` calls, and manual `isWithinWorkspace` checks. The `rename`, `moveFile`, and `moveSymbol` operations have already been migrated to use `WorkspaceScope` (which encapsulates workspace boundary checking, file modification tracking, and `FileSystem` port access). The `Compiler.afterFileRename` signature also needs aligning with `afterSymbolMove`, which already accepts `WorkspaceScope`.

## User intent

*As a contributor, I want all operations to use the same `WorkspaceScope` + `FileSystem` port pattern, so that workspace boundary enforcement and file I/O are centralized and testable through a single seam rather than scattered across ad-hoc `fs.*` calls and `isWithinWorkspace` checks.*

## Relevant files

**Pattern to follow (already migrated):**
- `src/domain/workspace-scope.ts` -- `WorkspaceScope` class: `contains()`, `writeFile()`, `recordModified()`, `recordSkipped()`, `fs` accessor
- `src/operations/rename.ts` -- reference migration: uses `scope.contains()`, `scope.writeFile()`, returns `scope.modified`/`scope.skipped`
- `src/operations/moveFile.ts` -- reference migration: uses `scope.fs.resolve()`, `scope.fs.exists()`, `scope.fs.mkdir()`, `scope.fs.rename()`
- `src/operations/moveSymbol.ts` -- reference migration: passes `scope` through to compiler methods

**Files to modify:**
- `src/operations/deleteFile.ts` -- target: 158 lines, uses `fs.readFileSync`, `fs.writeFileSync`, `fs.unlinkSync`, `isWithinWorkspace` (3 call sites)
- `src/operations/extractFunction.ts` -- target: 164 lines, uses `fs.readFileSync` (2 call sites), `fs.writeFileSync`, `isWithinWorkspace`
- `src/operations/getTypeErrors.ts` -- target: 118 lines, uses `fs.existsSync` (2 call sites in two functions), `isWithinWorkspace`
- `src/operations/searchText.ts` -- target: 191 lines, uses `fs.readFileSync`, `fs.readdirSync`; no `isWithinWorkspace` (implicit boundary via workspace walk)
- `src/operations/replaceText.ts` -- target: 175 lines, uses `fs.readFileSync` (2), `fs.writeFileSync` (2), `isWithinWorkspace` (2)
- `src/plugins/vue/scan.ts` -- `removeVueImportsOfDeletedFile` uses `fs.readFileSync`, `fs.writeFileSync`, `isWithinWorkspace`; `updateVueImportsAfterMove` uses same
- `src/compilers/ts.ts` -- `afterFileRename` uses `fs.readFileSync`, `fs.writeFileSync`, `isWithinWorkspace`, `walkFiles`
- `src/plugins/vue/compiler.ts` -- `afterFileRename` delegates to `updateVueImportsAfterMove`
- `src/types.ts` -- `Compiler.afterFileRename` interface signature
- `src/daemon/dispatcher.ts` -- constructs `WorkspaceScope` for migrated ops; needs updating for newly migrated ops

**Supporting files:**
- `src/ports/filesystem.ts` -- `FileSystem` interface (has `readFile`, `writeFile`, `exists`, `unlink`, `resolve`, `stat`; lacks `readdir`)
- `src/security.ts` -- `isWithinWorkspace()`, `isSensitiveFile()`

### Red flags

- `searchText.ts` at 191 lines and `replaceText.ts` at 175 lines are within thresholds but close to 150-line ideal. The migration should not meaningfully change line counts (parameter swaps, not new logic).
- `deleteFile.ts` at 158 lines is near ideal threshold. No concerns.
- `getTypeErrors.test.ts` at 331 lines exceeds the 300-line review threshold. However, this migration only changes the function signature (adding `scope` parameter), so existing tests need mechanical updates (constructing `WorkspaceScope` instead of passing `workspace` string), not new test cases. No prep step needed.
- Duplicated `stripExt` function exists in both `deleteFile.ts` and `scan.ts`. Out of scope for this spec but worth noting.

## Value / Effort

- **Value:** Eliminates the last pocket of direct `fs.*` + manual `isWithinWorkspace` calls. After this, all workspace-boundary enforcement flows through `WorkspaceScope.contains()` and `WorkspaceScope.writeFile()`, making it impossible to forget a boundary check when modifying an operation. Tests can inject `InMemoryFileSystem` for any operation, not just the already-migrated ones.
- **Effort:** Mechanical pattern application across 5 operations + 1 compiler interface + 2 `scan.ts` functions + dispatcher wiring. No new abstractions, no new infrastructure. ~10 files touched, all following the established pattern from `rename`/`moveFile`/`moveSymbol`.

## Behaviour

- [x] **AC1: `deleteFile` uses `WorkspaceScope`.** Given `deleteFile(tsCompiler, targetFile, scope)` where `scope` is a `WorkspaceScope`: (a) all `isWithinWorkspace(path, workspace)` checks are replaced with `scope.contains(path)`; (b) `fs.readFileSync` calls are replaced with `scope.fs.readFile()`; (c) `fs.writeFileSync` calls are replaced with `scope.writeFile()` (which enforces boundary + records modification); (d) `fs.unlinkSync` is replaced with `scope.fs.unlink()`; (e) manual `filesModified`/`filesSkipped` Sets are replaced with `scope.recordModified()`/`scope.recordSkipped()` and returned via `scope.modified`/`scope.skipped`; (f) `removeVueImportsOfDeletedFile` in `scan.ts` is updated to accept `WorkspaceScope` instead of separate `searchRoot`/`workspace` strings, using `scope.fs.readFile()`, `scope.writeFile()`, and `scope.contains()` internally.

- [x] **AC2: `extractFunction` uses `WorkspaceScope`.** Given `extractFunction(tsCompiler, file, startLine, startCol, endLine, endCol, functionName, scope)` where `scope` is a `WorkspaceScope`: (a) `fs.readFileSync` calls are replaced with `scope.fs.readFile()`; (b) `fs.writeFileSync` is replaced with `scope.writeFile()`; (c) `isWithinWorkspace` check is replaced with `scope.contains()`; (d) files outside the workspace are recorded via `scope.recordSkipped()` instead of silently skipped; (e) `filesModified` and `filesSkipped` are returned from `scope.modified`/`scope.skipped`.

- [x] **AC3: `getTypeErrors` uses `WorkspaceScope`.** Given `getTypeErrors(compiler, file, scope)` where `scope` is a `WorkspaceScope`: (a) `fs.existsSync` in the main function is replaced with `scope.fs.exists()`; (b) `isWithinWorkspace` is replaced with `scope.contains()`; (c) `getTypeErrorsForFiles` (a utility called from the dispatcher, not a workspace-scoped operation) accepts a `FileSystem` parameter and uses `fs.exists()` instead of `node:fs.existsSync`.

- [x] **AC4: `searchText` uses `WorkspaceScope`.** Given `searchText(pattern, scope, opts)` where `scope` is a `WorkspaceScope`: (a) `scope.root` replaces the `workspace` string for file enumeration root; (b) `fs.readFileSync` for file content is replaced with `scope.fs.readFile()`; (c) file enumeration (`git ls-files`, `readdir` fallback in `walkWorkspaceFiles` and `walkRecursive`) remains as direct `child_process`/`node:fs` calls -- these are out of scope (tracked separately in handoff.md). Binary file detection reads the content returned by `scope.fs.readFile()` and checks for null characters in the string.

- [x] **AC5: `replaceText` uses `WorkspaceScope`.** Given `replaceText(scope, opts)` where `scope` is a `WorkspaceScope`: (a) `isWithinWorkspace` checks in both pattern mode and surgical mode are replaced with `scope.contains()`; (b) `fs.readFileSync` calls are replaced with `scope.fs.readFile()`; (c) `fs.writeFileSync` calls are replaced with `scope.writeFile()` (enforces boundary + records modification); (d) `walkWorkspaceFiles` receives `scope.root` instead of `workspace` string.

- [x] **AC6: `Compiler.afterFileRename` accepts `WorkspaceScope`.** The `Compiler` interface signature changes from `afterFileRename(oldPath, newPath, workspace, alreadyModified?)` to `afterFileRename(oldPath, newPath, scope: WorkspaceScope): Promise<void>`, matching `afterSymbolMove`. Specifically: (a) `TsMorphCompiler.afterFileRename` replaces `isWithinWorkspace` with `scope.contains()`, `fs.readFileSync`/`fs.writeFileSync` with `scope.fs.readFile()`/`scope.writeFile()`, `walkFiles(path.resolve(workspace), ...)` with `walkFiles(scope.root, ...)`, and derives `alreadyModified` from `scope.modified` instead of accepting it as a parameter; (b) `VolarCompiler.afterFileRename` passes `scope` to `updateVueImportsAfterMove`, which is updated to accept `WorkspaceScope` and use `scope.fs.readFile()`, `scope.writeFile()`, `scope.contains()`; (c) the caller in `moveFile.ts` passes `scope` directly and removes the manual merging of `extraModified`/`extraSkipped` (the compiler records into the shared scope); (d) return type changes from `Promise<{ modified; skipped }>` to `Promise<void>`.

## Interface

This is an internal refactoring -- no public MCP/CLI surface changes. The dispatcher continues to construct `WorkspaceScope(workspace, new NodeFileSystem())` and pass it to each operation. All five operations change their last parameter from `workspace: string` to `scope: WorkspaceScope`.

**Operation signature changes:**

| Operation | Before | After |
|-----------|--------|-------|
| `deleteFile` | `(tsCompiler, file, workspace: string)` | `(tsCompiler, file, scope: WorkspaceScope)` |
| `extractFunction` | `(tsCompiler, file, ..., functionName, workspace: string)` | `(tsCompiler, file, ..., functionName, scope: WorkspaceScope)` |
| `getTypeErrors` | `(compiler, file, workspace: string)` | `(compiler, file, scope: WorkspaceScope)` |
| `searchText` | `(pattern, workspace: string, opts)` | `(pattern, scope: WorkspaceScope, opts)` |
| `replaceText` | `(workspace: string, opts)` | `(scope: WorkspaceScope, opts)` |

**Compiler interface change:**

| Method | Before | After |
|--------|--------|-------|
| `afterFileRename` | `(old, new, workspace, alreadyModified?) => Promise<{ modified; skipped }>` | `(old, new, scope: WorkspaceScope) => Promise<void>` |

**Utility signature change:**

| Function | Before | After |
|----------|--------|-------|
| `getTypeErrorsForFiles` | `(compiler, files)` | `(compiler, files, fs: FileSystem)` |

**`scan.ts` function changes:**

| Function | Before | After |
|----------|--------|-------|
| `removeVueImportsOfDeletedFile` | `(deletedFile, searchRoot, workspace: string)` | `(deletedFile, searchRoot, scope: WorkspaceScope)` |
| `updateVueImportsAfterMove` | `(oldPath, newPath, searchRoot, workspace: string)` | `(oldPath, newPath, searchRoot, scope: WorkspaceScope)` |

No new error codes. No new parameters. No response shape changes. The dispatcher's `invoke` signature already receives `workspace` and constructs `WorkspaceScope` for the three migrated operations; it will now do the same for all five.

## Open decisions

(none -- all decisions resolved during review: file enumeration stays as-is with a separate handoff entry; `getTypeErrorsForFiles` takes `FileSystem` not `WorkspaceScope`; binary detection uses string null-char check.)

## Security

- **Workspace boundary:** This change improves boundary enforcement by centralizing all `isWithinWorkspace` checks through `WorkspaceScope.contains()` and `WorkspaceScope.writeFile()`. No new code paths bypass the boundary -- the migration replaces scattered checks with the same centralized check. The `searchText` file enumeration still uses direct `fs` calls for directory listing, but this only determines *which files to enumerate* (always under workspace root); content reads are migrated to the port.
- **Sensitive file exposure:** No change. `isSensitiveFile` calls in `searchText` and `replaceText` remain as-is -- they check against a filename blocklist, not a workspace boundary.
- **Input injection:** N/A -- no new string parameters introduced. All existing parameters retain their validation.
- **Response leakage:** N/A -- no changes to response shapes or error messages.

## Edges

- Existing tests for all five operations must continue to pass with mechanical updates (constructing `WorkspaceScope` instead of passing `workspace` string).
- `moveFile` must still work end-to-end after the `afterFileRename` signature change -- the caller no longer merges `extraModified`/`extraSkipped` manually; the compiler writes directly into the shared scope.
- `getTypeErrorsForFiles` is called from the dispatcher post-write diagnostic step. It must continue to work with the dispatcher passing a `FileSystem` instance.
- `walkWorkspaceFiles` (used by `searchText` and `replaceText`) continues to accept a `workspace: string` root path (not a `WorkspaceScope`), since it only needs the root directory for enumeration.
- `isSensitiveFile` calls remain in `searchText` and `replaceText` -- they are not workspace-boundary checks and do not move to `WorkspaceScope`.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score threshold met for touched files -- skipped by user decision
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed:
      - No public surface changes (internal refactoring)
      - handoff.md current-state section updated (operation signatures in directory layout)
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**What went well:** The migration was mechanical and consistent. The established pattern from `rename`/`moveFile`/`moveSymbol` transferred cleanly to all five remaining operations. Each AC left the codebase in a passing state. The `Compiler.afterFileRename` signature change (AC6) unified the last asymmetry between `afterFileRename` and `afterSymbolMove`, with `moveFile.ts` simplified by removing manual result-merging logic.

**What took longer or was surprising:** Binary content detection in `searchText` changed from a `Buffer`-based null-byte check to a string `charCodeAt` check (`isBinaryContent`). This was a natural consequence of migrating from `fs.readFileSync` (which returns `Buffer`) to `scope.fs.readFile()` (which returns `string`). The `getTypeErrorsForFiles` utility deliberately takes `FileSystem` rather than `WorkspaceScope` because it is a post-write diagnostic utility called from the dispatcher, not a workspace-scoped operation -- this design fork was resolved during spec creation.

**Mutation score:** Skipped by user decision for this task.

**Architectural decisions worth preserving:**
- `getTypeErrorsForFiles` accepts `FileSystem` (not `WorkspaceScope`) because it is a dispatcher-level utility, not an operation. It only needs `fs.exists()` to check file existence before requesting diagnostics.
- `walkWorkspaceFiles` retains its `workspace: string` parameter (not `WorkspaceScope`). File enumeration via `git ls-files` and `fs.readdirSync` is tracked as a separate `FileSystem` port gap in handoff.md.
- All operations now consistently use `scope.root` for workspace path access, `scope.contains()` for boundary checks, `scope.writeFile()` for writes (enforcing boundary + recording modifications), and `scope.fs.*` for reads.
