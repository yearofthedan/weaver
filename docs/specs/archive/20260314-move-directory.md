# moveDirectory

**type:** change
**date:** 2026-03-14
**tracks:** handoff.md # moveDirectory → docs/features/moveFile.md

---

## Context

When an agent restructures a project layout, it needs to move entire directories -- not individual files. Today the only option is calling `moveFile` once per file, which means the agent must enumerate the directory contents, construct N `moveFile` calls, and hope nothing breaks mid-sequence. This is friction that should not exist: the user said "move this folder there," and the tool should do exactly that.

## User intent

*As an AI coding agent restructuring a project, I want to move a directory to a new location and have all imports across the project update automatically, so that I can reorganize project structure without manually chasing import paths.*

## Relevant files

- `src/operations/moveFile.ts` -- the per-file move operation; `moveDirectory` will call this internally for each file
- `src/daemon/dispatcher.ts` -- OPERATIONS table where the new operation is registered; also shows the pathParams/schema/invoke pattern
- `src/schema.ts` -- Zod schemas for all operations; new `MoveDirectoryArgsSchema` goes here
- `src/mcp.ts` -- TOOLS table for MCP tool definitions; new tool entry goes here
- `src/types.ts` -- `MoveResult` type; `moveDirectory` needs its own result type
- `src/security.ts` -- `isWithinWorkspace` and `validateFilePath`; both paths need validation
- `src/utils/file-walk.ts` -- `walkFiles()` enumerates files by extension; useful for discovering files to move
- `src/utils/extensions.ts` -- `TS_EXTENSIONS`, `VUE_EXTENSIONS` for file discovery
- `src/domain/workspace-scope.ts` -- `WorkspaceScope` used by all mutating operations
- `docs/features/moveFile.md` -- feature doc that will need a `moveDirectory` section or companion doc

### Red flags

- `tests/operations/moveFile_tsMorphCompiler.test.ts` is at 319 lines -- near the 300-line review threshold. Adding `moveDirectory` integration tests to this file would push it over. The executor should assess whether a separate `moveDirectory_tsMorphCompiler.test.ts` file is warranted, or whether the existing file can be thinned first.
- `walkFiles` in `src/utils/file-walk.ts` uses `spawnSync("git", ...)` and `fs.readdirSync` directly, bypassing the `FileSystem` port. This is a known issue (handoff.md P3). For `moveDirectory`, we need directory enumeration -- the implementation must decide whether to use `walkFiles` (which filters by extension) or a simpler `fs.readdirSync` approach (which captures all files). Either way, the port bypass is inherited tech debt, not new debt.

## Value / Effort

- **Value:** The user says "move `src/utils/` to `src/lib/helpers/`." Today there is no tool that does this — the user must list the files, move each one individually, and hope imports end up correct. `moveDirectory` takes two paths and handles everything: file discovery, physical moves, import rewriting across the project. The user's job is deciding where things go; the tool handles the mechanics.

- **Effort:** Moderate. The core logic is a loop over `moveFile` -- the hard part (import rewriting) is already solved. New code: one operation function (~60-80 lines), one schema, one dispatcher entry, one MCP tool entry, one result type. No new compiler APIs or domain abstractions needed. The main implementation question is file enumeration strategy (see Open decisions).

## Behaviour

- [x] **AC1: Basic directory move.** Given `moveDirectory(oldPath: "/project/src/utils", newPath: "/project/src/lib/helpers")` where `src/utils/` contains `a.ts` and `b.ts`, moves both files to `src/lib/helpers/a.ts` and `src/lib/helpers/b.ts`, rewrites all imports across the project that referenced either file, and returns `{ filesMoved: ["...a.ts", "...b.ts"], filesModified: [...all files with rewritten imports...], filesSkipped: [...] }`. The laziest wrong implementation would move files without rewriting imports -- the response must include `filesModified` entries beyond just the moved files themselves.

- [x] **AC2: Nested subdirectories preserved.** Given `src/utils/` containing `helpers/format.ts` and `helpers/parse.ts`, `moveDirectory` preserves the subdirectory structure: `src/lib/helpers/format.ts` and `src/lib/helpers/parse.ts`. The laziest wrong implementation would flatten all files into the destination root. The response `filesMoved` must reflect the nested paths.

- [x] **AC3: Import rewriting across all moved files.** Given `src/utils/a.ts` imports from `./b` (both in `src/utils/`), and an external file `src/app.ts` imports from `./utils/a`, after `moveDirectory(src/utils, src/lib)`: the import in the moved `a.ts` (now `src/lib/a.ts`) from `./b` is unchanged (relative path still valid), the import in `src/app.ts` is rewritten from `./utils/a` to `./lib/a`. The laziest wrong implementation would only rewrite external imports and break intra-directory references, or vice versa.

- [x] **AC4: Error when source is not a directory.** Given `oldPath` points to a regular file (not a directory), returns error `{ ok: false, error: "NOT_A_DIRECTORY" }`. Given `oldPath` does not exist, returns `{ ok: false, error: "FILE_NOT_FOUND" }`. Given `newPath` already exists as a non-empty directory, returns `{ ok: false, error: "DESTINATION_EXISTS" }`.

- [x] **AC5: Empty directory.** Given `oldPath` is a directory with no files matching supported extensions (or no files at all), returns success with `filesMoved: []`, `filesModified: []`. Does not error -- an empty move is a valid no-op.

## Interface

### Tool: `moveDirectory`

**MCP tool description:**
"When restructuring project layout, use this to move an entire directory and rewrite every import across the project automatically. Handles nested subdirectories, preserves internal structure, and updates all external references. Use this instead of multiple moveFile calls when relocating a folder. Returns filesMoved (files that were relocated), filesModified (all files with rewritten imports, including the moved files), and filesSkipped (outside workspace, not written). Type errors in modified files are returned automatically; pass checkTypeErrors:false to suppress."

**Parameters:**

| Param | Type | Description | Example | Bounds | Zero/empty | Adversarial |
|-------|------|-------------|---------|--------|------------|-------------|
| `oldPath` | `string` | Absolute path to the source directory | `/project/src/utils` | Must be absolute, within workspace, must be an existing directory | Empty string: rejected by Zod `.min(1)` | Path with trailing slash: normalize. Symlink to directory outside workspace: rejected by `isWithinWorkspace` realpath check |
| `newPath` | `string` | Absolute path to the destination directory. Created if it does not exist. Must not already exist as a non-empty directory. | `/project/src/lib/helpers` | Must be absolute, within workspace | Empty string: rejected | `newPath` inside `oldPath` (move into self): must error, not infinite loop |
| `checkTypeErrors` | `boolean?` | When false, skip post-write type check. Defaults to on. | `false` | N/A | Absent: type errors returned | N/A |

**Return type: `MoveDirectoryResult`**

| Field | Type | Description |
|-------|------|-------------|
| `filesMoved` | `string[]` | Absolute paths of files that were physically moved (new locations) |
| `filesModified` | `string[]` | All files with rewritten imports, including the moved files themselves |
| `filesSkipped` | `string[]` | Files outside workspace boundary that needed import updates but were not written |
| `oldPath` | `string` | Echo of the resolved source directory path |
| `newPath` | `string` | Echo of the resolved destination directory path |

**Error codes:**

| Code | When |
|------|------|
| `NOT_A_DIRECTORY` | `oldPath` exists but is not a directory |
| `FILE_NOT_FOUND` | `oldPath` does not exist |
| `DESTINATION_EXISTS` | `newPath` already exists as a non-empty directory |
| `WORKSPACE_VIOLATION` | Either path is outside the workspace |
| `MOVE_INTO_SELF` | `newPath` is inside `oldPath` |
| `INVALID_PATH` | Path contains control characters or URI special characters |

## Resolved decisions

### File enumeration strategy

**Decision (resolved):** Move all files; use compiler-aware rewriting only for source files.

`moveDirectory` moves ALL files in the directory, matching user expectation of "move this folder." The enumeration uses a recursive `readdirSync` walk (like the existing `walkRecursive` in `file-walk.ts`) that skips `SKIP_DIRS`. No extension filtering during enumeration -- enumerate everything, then branch on extension at move time:

- For files with extensions in `VUE_EXTENSIONS` (`.ts`, `.tsx`, `.js`, `.jsx`, `.vue`), call `moveFile()` which invokes the compiler to rewrite imports.
- For all other files (`.json`, `.md`, `.css`, images, etc.), do a plain `scope.fs.rename()` to physically move them without compiler involvement.

**Reasoning:** Three options were considered:
1. Move all files via `moveFile` -- wrong, wastefully invokes the compiler for files with no imports.
2. Move only supported extensions -- surprises users ("I moved the directory but my config files are still in the old location").
3. Move all files, compiler-aware rewriting only for source files -- correct.

Option 3 was chosen because it matches what users mean by "move this directory" while keeping compiler work scoped to files that actually have imports.

**Consequences:** The `FileSystem` port bypass is inherited tech debt from `walkFiles` (noted in handoff.md P3), not new debt introduced by this change.

### Internal execution: sequential moveFile vs. batch

**Decision (resolved):** Use sequential `moveFile` calls internally. This was flagged in the previous spec as an open question and the answer is clear: sequential `moveFile` is correct for v1. The compiler needs to see each file's new location before computing edits for the next. Batching would require a new compiler API (`getEditsForMultipleFileRenames`) that does not exist and is not worth building until sequential performance is proven insufficient. The `WorkspaceScope` accumulates all modifications across the loop, so the final result is a single aggregated response.

## Security

- **Workspace boundary:** Both `oldPath` and `newPath` are validated at the dispatcher layer via `isWithinWorkspace`. Each individual `moveFile` call within the loop also enforces boundaries on its import rewrites (files outside workspace go to `filesSkipped`). Plain filesystem moves of non-source files must also be boundary-checked before write. The `newPath` inside `oldPath` case (move-into-self) must be caught before enumeration begins -- otherwise the walker could loop indefinitely.
- **Sensitive file exposure:** `moveDirectory` moves files but does not read their content for display. The `moveFile` operation reads file content only to apply import edits. No new exposure surface. `isSensitiveFile` is not needed here -- moving a `.env` file is a valid operation (it changes location, not content).
- **Input injection:** Two new string parameters (`oldPath`, `newPath`) that reach the filesystem. Both go through `validateFilePath` (control chars, URI specials) and `isWithinWorkspace` (boundary check) before any filesystem operation. No shell execution.
- **Response leakage:** Response contains only file paths, not file content. No new leakage vector.

## Edges

- `moveDirectory` must not move `node_modules`, `.git`, or other directories in `SKIP_DIRS` if they happen to be nested inside the source directory. The file walker already skips these.
- A single file failure mid-sequence (e.g., permission error on one file) should not silently continue. The operation should fail with the error and report which files were already moved -- partial moves are expected (same as the existing `moveFile` precondition: clean git working tree).
- `moveDirectory` followed by `rename` on a symbol in a moved file must work. This is an existing invariant of `moveFile` and should be preserved.
- Performance: should handle directories with up to ~100 source files without timeout. Larger directories are unlikely in practice (projects rarely have 100+ files in a single directory).

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score >= threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed:
      - README.md (tool table, CLI commands, error codes, project structure)
      - Feature doc created or updated (use `docs/features/_template.md` for new docs)
      - handoff.md current-state section
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Shipped.** All 5 ACs implemented and tested. 636 tests passing.

- **Source:** `src/operations/moveDirectory.ts` (109 lines) -- recursive file enumeration, sequential `moveFile` for source files, plain `fs.rename` for non-source files
- **Registration:** `MoveDirectoryArgsSchema` in `schema.ts`, dispatcher entry in `dispatcher.ts`, MCP tool in `mcp.ts`, `MoveDirectoryResult` type in `types.ts`
- **Tests:** `tests/operations/moveDirectory_tsMorphCompiler.test.ts` (separate file, as recommended by the red flag assessment)
- **Error codes:** `NOT_A_DIRECTORY`, `DESTINATION_EXISTS`, `MOVE_INTO_SELF` (new); `FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `INVALID_PATH` (existing)
- **Feature doc:** `docs/features/moveDirectory.md` (new companion doc to `moveFile.md`)
- **Design note:** Symlinks are silently skipped during enumeration (`entry.isFile()` returns false for symlinks). This is documented in the feature doc Constraints section.
- **No new tech debt.** The `FileSystem` port bypass in `enumerateAllFiles` is inherited from the existing `walkFiles` pattern (already tracked in handoff.md P3).
