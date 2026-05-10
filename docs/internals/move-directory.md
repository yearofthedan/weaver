# Internals: move-directory

User-facing reference: [docs/commands/move-directory.md](../commands/move-directory.md).

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

## Vue SFC support

When the active compiler is `VolarEngine` (Vue projects), `moveDirectory` additionally:

1. **Rewrites external `.ts`/`.tsx` and `.vue` files that import moved `.vue` components** — calls `getEditsForFileRename` with the virtual `.vue.ts` path (e.g. `Button.vue.ts`) through the Volar language service. Real `.vue` paths return no results — Volar registers Vue files as virtual `.vue.ts` entries in the TS language service host, so the virtual form is required. This approach handles both relative imports and path aliases (`@/components/*`) through the compiler's module resolution graph.
2. **Rewrites external `.vue` files that import anything from the moved directory** — scans `.vue` `<script>` blocks for `from '...'` specifiers resolving to the old path. Covers `.ts` and `.vue` files that moved.
3. **Rewrites moved `.vue` files' own relative imports** — regex rewrite of relative specifiers (`./` and `../`) in the moved files themselves. Alias imports (`@/...`) resolve from the project root and don't change when a file moves.

The LS pass (1) runs before the physical move so the Volar service can still resolve files at their old paths. The scan passes (2, 3) run after. Intra-directory relative imports are not touched — they remain valid after the move.

## Technical decisions

**Why enumerate all files, not just source files?**
Users expect "move this directory" to move everything -- config files, images, markdown. Only source files need compiler-aware import rewriting; the rest get a plain filesystem rename. This matches user intent without wasting compiler cycles on non-source files.

**Why batch `getEditsForFileRename` instead of sequential `moveFile` calls?**
Sequential per-file moves are fundamentally broken for intra-directory imports. When `main.ts` is moved first, the rewriter sees `utils.ts` still at the old path and rewrites the import to a cross-tree path. When `utils.ts` moves next, nobody goes back to fix `main.ts`. The batch approach computes all edits while files are still at their original locations, filters out intra-directory edits (those specifiers are still valid after the move), applies external edits, then does a single `fs.renameSync` for the physical move.

**Why `getEditsForFileRename` instead of ts-morph's `directory.move()`?**
ts-morph's `directory.move()` has two bugs: it strips `.js`/`.mjs`/`.cjs` extensions from import specifiers (breaking ESM/nodenext projects) and doesn't resolve extensionless specifiers to `.ts` files. The TS language service's `getEditsForFileRename` handles both correctly. See [docs/tech/ts-morph-apis.md](../tech/ts-morph-apis.md) for the full analysis.

**Why not reuse `walkFiles` from `file-walk.ts`?**
`walkFiles` filters by extension (only `.ts`, `.tsx`, `.vue` etc.) and uses `git ls-files` or `readdirSync` for discovery. `moveDirectory` needs all files regardless of extension, so it uses its own `enumerateAllFiles` recursive walk that only skips `SKIP_DIRS`.
