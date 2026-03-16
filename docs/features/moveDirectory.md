# Feature: moveDirectory

**Purpose:** Move an entire directory to a new location and rewrite every import across the project automatically -- handling nested subdirectories, non-source files, and internal references in a single operation.

---

## How it works

```
tool call
  |
  v dispatcher (src/daemon/dispatcher.ts)
  |   validates oldPath and newPath against workspace boundary; selects compiler
  v moveDirectory() (src/operations/moveDirectory.ts)
  |   1. Validate: oldPath exists and is a directory, newPath is not inside oldPath,
  |      destination is not a non-empty directory
  |   2. Enumerate all files recursively (skips SKIP_DIRS: node_modules, .git, etc.)
  |   3. Call compiler.moveDirectory(oldPath, newPath, scope) -- batch move
  |      of all source files (.ts, .tsx, .js, .jsx, .vue) via the TS language
  |      service (getEditsForFileRename per file, merged, then applied).
  |      Import rewrites are computed before any disk writes; intra-directory
  |      imports (e.g. ./utils) are filtered out and preserved as-is.
  |   4. For each non-source file (.json, .md, .css, images, etc.):
  |      plain fs.rename() via scope.fs -- no compiler involvement
  |   5. Return aggregated result
  v dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  v result { ok, filesMoved, filesModified, filesSkipped, oldPath, newPath, typeErrors }
```

The operation is a thin orchestrator: it delegates all source-file work to `compiler.moveDirectory()`, which uses the TS language service (`getEditsForFileRename`) per source file, merges edits, applies them to importers outside the moved directory, then does an atomic `fs.renameSync` for the physical move.

## Security

- Both `oldPath` and `newPath` are validated at the dispatcher before the operation runs.
- `compiler.moveDirectory()` records all modified files through the `WorkspaceScope`; workspace boundary enforcement applies to all writes. Files outside the workspace go to `filesSkipped`.
- Non-source file moves also use `scope.fs.rename()` which records modifications through the `WorkspaceScope`.
- The `newPath` inside `oldPath` case (move-into-self) is caught before enumeration begins to prevent infinite loops.

See [security.md](../security.md) for the full threat model.

## Constraints

- `newPath` must not already exist as a non-empty directory. An empty or non-existent destination is fine (created automatically).
- Both paths must be within the workspace boundary.
- Directories in `SKIP_DIRS` (`node_modules`, `.git`, etc.) nested inside the source directory are skipped during enumeration.
- Symlinks are skipped -- `enumerateAllFiles` only processes regular files (`entry.isFile()`), not symbolic links.
- Moving an empty directory (no files, or no files outside SKIP_DIRS) is a valid no-op: returns success with `filesMoved: []`.
- Import rewrites are computed in batch before any physical move. Intra-directory edits are filtered out — imports between files that move together are preserved as-is.
- `.js`/`.mjs`/`.cjs` extensions in import specifiers are preserved (uses the TS language service, not ts-morph's specifier generator).
- Sub-project boundaries (directories with their own `tsconfig.json`) are respected — internal imports are not corrupted.
- Dynamic `import()` calls with computed paths are not updated (inherited from ts-morph's language service).

## Technical decisions

**Why enumerate all files, not just source files?**
Users expect "move this directory" to move everything -- config files, images, markdown. Only source files need compiler-aware import rewriting; the rest get a plain filesystem rename. This matches user intent without wasting compiler cycles on non-source files.

**Why batch `getEditsForFileRename` instead of sequential `moveFile` calls?**
Sequential per-file moves are fundamentally broken for intra-directory imports. When `main.ts` is moved first, the rewriter sees `utils.ts` still at the old path and rewrites the import to a cross-tree path. When `utils.ts` moves next, nobody goes back to fix `main.ts`. The batch approach computes all edits while files are still at their original locations, filters out intra-directory edits (those specifiers are still valid after the move), applies external edits, then does a single `fs.renameSync` for the physical move.

**Why `getEditsForFileRename` instead of ts-morph's `directory.move()`?**
ts-morph's `directory.move()` has two bugs: it strips `.js`/`.mjs`/`.cjs` extensions from import specifiers (breaking ESM/nodenext projects) and doesn't resolve extensionless specifiers to `.ts` files. The TS language service's `getEditsForFileRename` handles both correctly. See `docs/tech/ts-morph-apis.md` for the full analysis.

**Why not reuse `walkFiles` from `file-walk.ts`?**
`walkFiles` filters by extension (only `.ts`, `.tsx`, `.vue` etc.) and uses `git ls-files` or `readdirSync` for discovery. `moveDirectory` needs all files regardless of extension, so it uses its own `enumerateAllFiles` recursive walk that only skips `SKIP_DIRS`.
