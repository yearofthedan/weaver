# Operation: moveFile

## Why use this

Use `moveFile` when you need to relocate a file and have every import that references it rewritten automatically. A manual `mv` + `replaceText` can achieve the same result, but `moveFile` uses the TypeScript language service to compute the exact set of import paths that need updating — including relative path depth changes that are easy to get wrong by hand. In Vue workspaces, it also patches `.vue` SFC imports that the language service doesn't track.

## What it does

Moves a file from one path to another and rewrites all import statements that reference it, project-wide.

**MCP tool call:**

```json
{
  "name": "moveFile",
  "arguments": {
    "oldPath": "/path/to/project/src/utils/helpers.ts",
    "newPath": "/path/to/project/src/lib/helpers.ts"
  }
}
```

**Response:**

```json
{
  "ok": true,
  "filesModified": ["src/utils/helpers.ts", "src/App.vue", "src/components/Button.ts"],
  "filesSkipped": [],
  "message": "Moved src/utils/helpers.ts → src/lib/helpers.ts, updated 3 files"
}
```

The moved file itself is included in `filesModified`. All files with import paths that referenced the old location are updated to point to the new location. The file is physically moved on disk.

## Key concepts

- **Language-service edits, not ts-morph `sourceFile.move()`.** Uses `getEditsForFileRename()` which returns per-file text spans. This allows boundary-checking each file before writing, rather than atomically writing everything and hoping nothing escapes the workspace.
- **Vue post-scan.** Volar's `getEditsForFileRename` returns edits with virtual `.vue.ts` filenames that can't be written to disk directly. A separate regex scan (`updateVueImportsAfterMove`) patches `.vue` SFC import strings. This runs via the provider `afterFileRename` hook.
- **Explicit invalidation after move.** ts-morph and Volar cache project state keyed by file path. After the physical rename, the engine explicitly invalidates its project cache so the next operation sees the new path.
- **Post-write type errors.** Type errors in modified files are returned automatically (pass `checkTypeErrors: false` to suppress).

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` → `.ts` | Yes |
| `.ts` ↔ `.tsx` | Yes |
| `.vue` → `.vue` | Yes |
| `.js` / `.jsx` ↔ `.js` / `.jsx` | Yes (when in project graph via `allowJs`) |
| `.ts` ↔ `.vue` | No — semantic mismatch; TypeScript module can't become a Vue SFC or vice versa |

Moving a file does not change the file's content or type. The engine only rewrites import paths in referencing files.

## Constraints & limitations

- `newPath` must not already exist. The operation does not overwrite existing files.
- Both `oldPath` and `newPath` must be within the workspace boundary.
- Import rewrites are computed from the project graph. Imports in files outside the project graph (e.g. files not covered by tsconfig `include`) may not be updated. The Vue post-scan mitigates this for `.vue` files but uses regex, not semantic binding.
- Dynamic `import()` calls with computed paths are not updated.

## Security & workspace boundary

- Both `oldPath` and `newPath` are validated at the dispatcher before the engine is called.
- The TypeScript language service computes import rewrites for all files in the project graph, which may include files physically outside the workspace (e.g. via tsconfig `include` paths that escape the workspace). These are skipped per-file and reported in `filesSkipped`.
- Vue post-scan enforces workspace boundaries per file before write. Out-of-workspace files are skipped.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why `ls.getEditsForFileRename()` directly instead of `sourceFile.move()` (ts-morph)?**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Workspace boundary enforcement would require reverting writes after the fact. `getEditsForFileRename()` returns per-file text spans. Boundary-check each file before writing; skip those that fail.

**Why a post-scan for Vue imports?**
Volar's `getEditsForFileRename` returns edits with virtual `.vue.ts` filenames that can't be written to disk directly. The Vue import string rewriting is done by a separate regex scan in `providers/vue-scan.ts`, invoked by the provider `afterFileRename` hook.

**Why does invalidation happen after the move?**
ts-morph and Volar both cache project state keyed by file path. After `renameSync`, the old path no longer exists but may still be in the cache. Explicit invalidation forces the engine to rebuild on the next request. Without it, a subsequent operation referencing the moved file would use stale state.
