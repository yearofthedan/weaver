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
  |   3. Call compiler.moveDirectory(oldPath, newPath, scope) -- atomic batch move
  |      of all source files (.ts, .tsx, .js, .jsx, .vue) via ts-morph directory.move().
  |      All import rewrites are computed in the project graph before any disk writes,
  |      so intra-directory imports (e.g. ./utils) are preserved as-is.
  |   4. For each non-source file (.json, .md, .css, images, etc.):
  |      plain fs.rename() via scope.fs -- no compiler involvement
  |   5. Return aggregated result
  v dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  v result { ok, filesMoved, filesModified, filesSkipped, oldPath, newPath, typeErrors }
```

The operation is a thin orchestrator: it delegates all source-file work to `compiler.moveDirectory()`, which uses ts-morph's `directory.move()` API to compute all import rewrites atomically in the project graph before writing anything to disk.

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
- Source-file moves are atomic: ts-morph computes all import rewrites in the project graph before writing anything to disk. Intra-directory imports are preserved as-is.
- Dynamic `import()` calls with computed paths are not updated (inherited from ts-morph's language service).

## Technical decisions

**Why enumerate all files, not just source files?**
Users expect "move this directory" to move everything -- config files, images, markdown. Only source files need compiler-aware import rewriting; the rest get a plain filesystem rename. This matches user intent without wasting compiler cycles on non-source files.

**Why ts-morph `directory.move()` instead of per-file calls?**
The per-file approach (`moveFile` in a loop) is fundamentally broken for intra-directory imports. When `main.ts` is moved first, the rewriter sees `utils.ts` still at the old path and rewrites the import to an absolute or cross-tree path. When `utils.ts` moves next, nobody goes back to fix `main.ts`. ts-morph's `directory.move()` API solves this by operating on the project graph — all files in the directory move together, all import rewrites are computed before any disk writes, and intra-directory specifiers (`./utils`) are preserved unchanged. The operation calls `compiler.moveDirectory()` without knowing about ts-morph internals (following design principle #2).

**Why not reuse `walkFiles` from `file-walk.ts`?**
`walkFiles` filters by extension (only `.ts`, `.tsx`, `.vue` etc.) and uses `git ls-files` or `readdirSync` for discovery. `moveDirectory` needs all files regardless of extension, so it uses its own `enumerateAllFiles` recursive walk that only skips `SKIP_DIRS`.
