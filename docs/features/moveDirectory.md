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
  |   3. For each file:
  |      - Source files (.ts, .tsx, .js, .jsx, .vue): call moveFile() which invokes
  |        the compiler to rewrite imports project-wide
  |      - Non-source files (.json, .md, .css, images, etc.): plain fs.rename()
  |        via scope.fs -- no compiler involvement
  |   4. Return aggregated result across all individual moves
  v dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  v result { ok, filesMoved, filesModified, filesSkipped, oldPath, newPath, typeErrors }
```

The operation delegates to `moveFile` for each source file, so all import rewriting -- including the Vue post-scan for `.vue` SFC imports -- is inherited from that operation.

## Security

- Both `oldPath` and `newPath` are validated at the dispatcher before the operation runs.
- Each individual `moveFile` call within the loop enforces workspace boundaries on its import rewrites. Files outside the workspace go to `filesSkipped`.
- Non-source file moves also use `scope.fs.rename()` which records modifications through the `WorkspaceScope`.
- The `newPath` inside `oldPath` case (move-into-self) is caught before enumeration begins to prevent infinite loops.

See [security.md](../security.md) for the full threat model.

## Constraints

- `newPath` must not already exist as a non-empty directory. An empty or non-existent destination is fine (created automatically).
- Both paths must be within the workspace boundary.
- Directories in `SKIP_DIRS` (`node_modules`, `.git`, etc.) nested inside the source directory are skipped during enumeration.
- Symlinks are skipped -- `enumerateAllFiles` only processes regular files (`entry.isFile()`), not symbolic links.
- Moving an empty directory (no files, or no files outside SKIP_DIRS) is a valid no-op: returns success with `filesMoved: []`.
- The operation is sequential: files are moved one at a time via `moveFile`. A failure mid-sequence leaves a partial move (same precondition as `moveFile`: clean git working tree).
- Dynamic `import()` calls with computed paths are not updated (inherited from `moveFile`).

## Technical decisions

**Why enumerate all files, not just source files?**
Users expect "move this directory" to move everything -- config files, images, markdown. Only source files need compiler-aware import rewriting; the rest get a plain filesystem rename. This matches user intent without wasting compiler cycles on non-source files.

**Why sequential `moveFile` instead of a batch API?**
The compiler needs to see each file's new location before computing edits for the next. A batch API (`getEditsForMultipleFileRenames`) does not exist in ts-morph or Volar. Sequential execution through `WorkspaceScope` accumulates all modifications into a single aggregated response.

**Why not reuse `walkFiles` from `file-walk.ts`?**
`walkFiles` filters by extension (only `.ts`, `.tsx`, `.vue` etc.) and uses `git ls-files` or `readdirSync` for discovery. `moveDirectory` needs all files regardless of extension, so it uses its own `enumerateAllFiles` recursive walk that only skips `SKIP_DIRS`.
