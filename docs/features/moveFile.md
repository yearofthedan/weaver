# Operation: moveFile

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

The moved file itself is included in `filesModified`. All files with import paths that referenced the old location are updated to point to the new location. The file is physically moved on disk (`fs.renameSync`).

## How it works

1. The MCP layer validates `oldPath` and `newPath` (Zod schema).
2. The dispatcher validates both paths are within the workspace.
3. `operations/moveFile.ts` calls `LanguageProvider.getEditsForFileRename(oldPath, newPath)` to get the set of text edits for every affected file.
4. Each edit is boundary-checked; out-of-workspace files are skipped.
5. Edits are applied in-memory via `applyTextEdits` and written to disk.
6. The file is physically renamed via `fs.renameSync`.
7. Provider post-step (`afterFileRename`) runs `updateVueImportsAfterMove` for Vue workspaces — a regex scan over `.vue` SFC files to catch import strings that the TypeScript language service doesn't track (e.g. bare string paths in `<script setup>` that aren't statically analysable).
8. The engine invalidates its in-memory project state so the next operation sees the new path.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` → `.ts` | ✓ |
| `.ts` → `.tsx` | ✓ |
| `.tsx` → `.tsx` | ✓ |
| `.vue` → `.vue` | ✓ |
| `.js` / `.jsx` → `.js` / `.jsx` | ✓ (when in project graph via `allowJs`) |
| `.ts` ↔ `.jsx` | ✓ (importers updated regardless of extension) |
| `.ts` → `.vue` | Not applicable — semantic mismatch; TypeScript module can't become a Vue SFC |
| `.vue` → `.ts` | Not applicable — same reason |

Moving a file does not change the file's content or type. The engine only rewrites import paths in referencing files.

## Constraints & limitations

- `newPath` must not already exist. The operation does not overwrite existing files.
- Both `oldPath` and `newPath` must be within the workspace boundary.
- Import rewrites are computed by the TypeScript language service from the project graph. Imports in files outside the project graph (e.g. files not covered by tsconfig `include`) may not be updated. The `updateVueImportsAfterMove` post-scan mitigates this for `.vue` files but uses regex, not semantic binding info.
- Dynamic `import()` calls with computed paths are not updated.

## Security & workspace boundary

- Both `oldPath` and `newPath` are validated at the dispatcher before the engine is called.
- The TypeScript language service computes import rewrites for all files in the project graph, which may include files physically outside the workspace (e.g. via tsconfig `include` paths that escape the workspace). These are skipped per-file and reported in `filesSkipped`.
- Vue post-scan enforces workspace boundaries per file before write. Out-of-workspace files are skipped.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why `ls.getEditsForFileRename()` directly instead of `sourceFile.move()` (ts-morph)?**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Workspace boundary enforcement would require reverting writes after the fact. `getEditsForFileRename()` returns per-file text spans. Boundary-check each file before writing; skip those that fail. The Vue engine already used this pattern; the TS engine was rewritten to match.

**Why a post-scan for Vue imports?**
Volar's `getEditsForFileRename` returns edits with virtual `.vue.ts` filenames that can't be written to disk directly (they don't exist as real files). The Vue import string rewriting (`import Foo from './Foo.vue'`) is done by a separate regex scan in `providers/vue-scan.ts`, invoked by the provider `afterFileRename` hook.

**Why does invalidation happen after the move?**
ts-morph and Volar both cache project state keyed by file path. After `renameSync`, the old path no longer exists but may still be in the cache. Explicit invalidation (`TsProvider.invalidateProject()`) forces the engine to rebuild on the next request. Without it, a subsequent rename or move referencing the moved file would use stale state.
