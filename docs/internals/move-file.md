# Internals: move-file

User-facing reference: [docs/commands/move-file.md](../commands/move-file.md).

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates oldPath and newPath against workspace boundary; selects provider
  ▼ moveFile() (src/operations/moveFile.ts)
  │   ├─ VolarEngine only: vueRenameEdits() takes the SFC half from the Vue language
  │   │     service, mapping each virtual .vue.ts span back onto the SFC's own source
  │   ├─ ls.getEditsForFileRename(oldPath, newPath)
  │   │     language service computes per-file text spans for all import path rewrites
  │   ├─ boundary-check each rewrite target → write passing files; add others to filesSkipped
  │   ├─ renameSync(oldPath → newPath) — physical file move on disk
  │   └─ afterFileRename() — compiler hook
  │         TsMorphCompiler: incremental project graph update (remove old path, add new)
  │         VolarCompiler: updateVueImportsAfterMove() regex scan, now a fallback for
  │                        .vue files the language service does not register
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

**Why SFC imports come from the language service, not the regex scan.**
Volar's `getEditsForFileRename` names each SFC by a virtual `<name>.vue.ts`, and its spans are offsets into generated TypeScript — so an edit cannot be written to the path it names. `VolarEngine.toRealFileEdit` maps each span back onto the SFC's own source through `language.maps`, the same mechanism rename and find-references use, which makes the edit writable against the real `.vue` file.

That matters because the specifier forms a project can use are open-ended — `paths` aliases, `baseUrl`-rooted bare specifiers, `#foo` subpath imports, package `exports` maps — and resolution answers all of them, where a pattern matcher needs a new case for each. The regex scan in `plugins/vue/scan.ts` remains as a fallback for `.vue` files the service does not register; once the language-service edits land, the old specifier is gone and the scan matches nothing.

Two consequences worth knowing. A moved `.vue` file must be queried under its virtual `<name>.vue.ts` path — a query against the real path returns no edits at all, silently. And TypeScript resolves `./x.js` to `x.ts` under every `moduleResolution` mode when the `.js` is not itself in the program, so it offers to repoint a specifier naming a real hand-written `.js` that is staying put; `isCoexistingJsFileEdit` (`ts-engine/rewrite-importers-of-moved-file.ts`) suppresses that, and both engines need it, not just the TypeScript one.

**Why incremental graph updates instead of full invalidation?**
ts-morph and Volar both cache project state keyed by file path. After `renameSync`, the old path no longer exists but may still be in the cache. TsMorphCompiler updates the graph incrementally (remove old source file, add new) rather than rebuilding the entire project. Full invalidation (`invalidateProject`) destroys the in-memory project graph, losing knowledge of files moved in previous calls within the same daemon session — causing ENOENT on sequential moves. Incremental updates keep the graph accurate across calls. See [docs/tech/ts-morph-apis.md](../tech/ts-morph-apis.md) for why `sourceFile.move()` is not used for this.

## Reach beyond `tsconfig.include`

Files outside `tsconfig.include` (tests, scripts) are temporarily added to the project via `addSourceFileAtPath` before the language service runs (TsMorphCompiler), so their imports are rewritten correctly. After the physical move, both compilers run `rewriteMovedFileOwnImports()` to adjust the moved file's own relative specifiers when the language service didn't, then `rewriteImportersOfMovedFile()` to catch any TS/JS files the language service missed (out-of-project importers, stale cache, `.js` extension imports under `moduleResolution: "node"`). SFC imports are handled before the move by the Vue language service; see the technical decision above.
