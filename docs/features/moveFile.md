# Feature: moveFile

**Purpose:** Move a file and rewrite every import that references it, project-wide — including relative path depth changes and Vue SFC imports.

The TypeScript language service computes the exact set of import paths that need updating. In Vue workspaces, a post-scan patches `.vue` SFC imports that the language service doesn't track.

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

`filesModified` includes the moved file itself plus every file with updated imports. See [mcp-transport.md](./mcp-transport.md) for the full response contract.

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates oldPath and newPath against workspace boundary; selects provider
  ▼ moveFile() (src/operations/moveFile.ts)
  │   ├─ ls.getEditsForFileRename(oldPath, newPath)
  │   │     language service computes per-file text spans for all import path rewrites
  │   ├─ boundary-check each rewrite target → write passing files; add others to filesSkipped
  │   ├─ renameSync(oldPath → newPath) — physical file move on disk
  │   └─ afterFileRename() — compiler hook
  │         TsMorphCompiler: explicit project cache invalidation (keyed by old path)
  │         VolarCompiler: updateVueImportsAfterMove() regex scan patches .vue SFC imports
  │                        (Volar edits use virtual .vue.ts names; can't be written directly)
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { ok, filesModified, filesSkipped, typeErrors }
```

## Security

- Both `oldPath` and `newPath` are validated at the dispatcher before the engine is called.
- The language service computes import rewrites for all files in the project graph, which may include files physically outside the workspace (via tsconfig `include` paths). These are boundary-checked per-file and skipped to `filesSkipped` if they fail.
- The Vue post-scan enforces workspace boundaries per file before writing.

See [security.md](../security.md) for the full threat model.

## Constraints

- `newPath` must not already exist. The operation does not overwrite existing files.
- Both paths must be within the workspace boundary.
- Import rewrites are computed from the project graph, with a fallback scan that catches imports the TS language service misses (e.g. `.js` extension imports under `moduleResolution: "node"`, or files added after project load). Imports in files outside `tsconfig.include` (tests, scripts) are also rewritten by the fallback. The Vue post-scan handles `.vue` SFC imports separately using regex.
- Dynamic `import()` calls with computed paths are not updated.
- Moving a `.ts` file to a `.vue` path (or vice versa) is not supported — semantic mismatch; TypeScript modules can't become Vue SFCs or vice versa.

## Technical decisions

**Why `ls.getEditsForFileRename()` directly instead of `sourceFile.move()` (ts-morph)?**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Workspace boundary enforcement would require reverting writes after the fact. `getEditsForFileRename()` returns per-file text spans. Boundary-check each file before writing; skip those that fail.

**Why a post-scan for Vue imports?**
Volar's `getEditsForFileRename` returns edits with virtual `.vue.ts` filenames that can't be written to disk directly. The Vue import string rewriting is done by a separate regex scan in `plugins/vue/scan.ts`, invoked by the compiler `afterFileRename` hook.

**Why does invalidation happen after the move?**
ts-morph and Volar both cache project state keyed by file path. After `renameSync`, the old path no longer exists but may still be in the cache. Explicit invalidation forces the engine to rebuild on the next request. Without it, a subsequent operation referencing the moved file would use stale state.
