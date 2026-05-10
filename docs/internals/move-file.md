# Internals: move-file

User-facing reference: [docs/commands/move-file.md](../commands/move-file.md).

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
  │         TsMorphCompiler: incremental project graph update (remove old path, add new)
  │         VolarCompiler: updateVueImportsAfterMove() regex scan patches .vue SFC imports
  │                        (Volar edits use virtual .vue.ts names; can't be written directly)
  │         Both compilers: rewriteMovedFileOwnImports() adjusts relative specifiers
  │                         inside the moved file when directory depth changes
  │         Both compilers: rewriteImportersOfMovedFile() fallback walk rewrites
  │                         specifiers in TS/JS files the language service missed
  │                         (out-of-project files, stale cache, .js extension imports)
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { ok, filesModified, filesSkipped, typeErrors }
```

## Technical decisions

**Why `ls.getEditsForFileRename()` directly instead of `sourceFile.move()` (ts-morph)?**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Workspace boundary enforcement would require reverting writes after the fact. `getEditsForFileRename()` returns per-file text spans. Boundary-check each file before writing; skip those that fail.

**Why a post-scan for Vue imports?**
Volar's `getEditsForFileRename` returns edits with virtual `.vue.ts` filenames that can't be written to disk directly. The Vue import string rewriting is done by a separate regex scan in `plugins/vue/scan.ts`, invoked by the compiler `afterFileRename` hook.

**Why incremental graph updates instead of full invalidation?**
ts-morph and Volar both cache project state keyed by file path. After `renameSync`, the old path no longer exists but may still be in the cache. TsMorphCompiler updates the graph incrementally (remove old source file, add new) rather than rebuilding the entire project. Full invalidation (`invalidateProject`) destroys the in-memory project graph, losing knowledge of files moved in previous calls within the same daemon session — causing ENOENT on sequential moves. Incremental updates keep the graph accurate across calls. See [docs/tech/ts-morph-apis.md](../tech/ts-morph-apis.md) for why `sourceFile.move()` is not used for this.

## Reach beyond `tsconfig.include`

Files outside `tsconfig.include` (tests, scripts) are temporarily added to the project via `addSourceFileAtPath` before the language service runs (TsMorphCompiler), so their imports are rewritten correctly. After the physical move, both compilers run `rewriteMovedFileOwnImports()` to adjust the moved file's own relative specifiers when the language service didn't, then `rewriteImportersOfMovedFile()` to catch any TS/JS files the language service missed (out-of-project importers, stale cache, `.js` extension imports under `moduleResolution: "node"`). The Vue post-scan handles `.vue` SFC imports separately using regex.
