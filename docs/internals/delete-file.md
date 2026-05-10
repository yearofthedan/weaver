# Internals: delete-file

User-facing reference: [docs/commands/delete-file.md](../commands/delete-file.md).

## How it works

The file must be present on disk during the scan phases — ts-morph needs it to resolve module specifiers. Physical deletion happens last.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary
  ▼ deleteFile() (src/operations/deleteFile.ts)
  │   ├─ Phase 1 — in-project scan (ts-morph)
  │   │     iterate compiler project source files
  │   │     for each ImportDeclaration / ExportDeclaration:
  │   │       getModuleSpecifierSourceFile() === target → remove the declaration
  │   │     handles: named imports, type-only imports, namespace imports, default imports,
  │   │              re-exports (export *, export { }), side-effect imports
  │   │     safe re-query loop: re-fetch declarations after each removal to avoid
  │   │     stale AST node references
  │   ├─ Phase 2 — out-of-project TS/JS scan
  │   │     walk workspace files outside tsconfig.include (test files, scripts)
  │   │     per-file in-memory ts-morph project for each file
  │   │     module specifier resolved via path.resolve + extension stripping
  │   │     (handles bare specifiers './foo', and .ts/.tsx/.js/.jsx extensions)
  │   ├─ Phase 3 — Vue SFC scan (regex)
  │   │     walk .vue files; regex removes matching import/export lines from
  │   │     <script> and <script setup> blocks
  │   │     consistent with updateVueImportsAfterMove; does not parse template import()
  │   ├─ unlinkSync(file) — physical deletion (after all importer edits written)
  │   └─ tsCompiler.invalidateProject(file) — drop cached project
  │         (watcher's unlink event also fires invalidateAll independently ~200ms later)
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { ok, deletedFile, filesModified, filesSkipped, importRefsRemoved, typeErrors }
```

## Technical decisions

**Why three separate scan phases instead of one unified pass?**
Each phase accesses a different population of files through a different API. ts-morph's compiler project (Phase 1) gives semantic module resolution but only sees files in `tsconfig.include`. A per-file in-memory project (Phase 2) extends coverage to test files and scripts at the cost of a fresh project per file. Regex (Phase 3) covers Vue SFCs, which TypeScript's compiler can't parse. Unifying them would require either expanding tsconfig (fragile) or giving up semantic resolution everywhere.

**Why delete last?**
ts-morph needs the target file present to resolve module specifiers during Phase 1. If the file is deleted first, `getModuleSpecifierSourceFile()` returns `undefined` for all importers and Phase 1 finds nothing.

**Why the safe re-query loop?**
Removing a ts-morph AST node (an `ImportDeclaration`) invalidates sibling node references captured before the removal — the AST is mutated in-place. Re-querying the source file's declarations after each removal guarantees fresh references for the next iteration.
