# Feature: deleteFile

**Purpose:** Remove a file and clean up every import and re-export that references it, across the whole workspace, in one compiler-backed operation.

**MCP tool call:**

```json
{
  "name": "deleteFile",
  "arguments": {
    "file": "/path/to/project/src/old-helper.ts"
  }
}
```

The response includes tool-specific fields beyond the standard contract:

```json
{
  "ok": true,
  "deletedFile": "/path/to/project/src/old-helper.ts",
  "filesModified": ["src/api.ts", "src/barrel.ts", "tests/helper.test.ts"],
  "filesSkipped": [],
  "importRefsRemoved": 4,
  "typeErrors": [...]
}
```

- `deletedFile` — echo of the absolute path removed.
- `filesModified` — files whose import/re-export declarations were cleaned. Does not include `deletedFile` itself.
- `filesSkipped` — importers outside the workspace boundary that were found but not written.
- `importRefsRemoved` — count of individual `import`/`export` declarations removed across all modified files.

Type errors are expected after deletion: removing an import leaves any code that used those symbols broken. Pass `checkTypeErrors: false` to suppress. See [mcp-transport.md](./mcp-transport.md) for the full response contract.

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

## Security

- **Input:** `file` is validated against the workspace root by the dispatcher before the operation runs. Paths outside the workspace return `WORKSPACE_VIOLATION`.
- **Output writes:** only files inside the workspace boundary are written. Importers found outside the workspace appear in `filesSkipped` and are not modified.

See [security.md](../security.md) for the full threat model.

## Constraints

- The file must exist at call time. If already deleted, `FILE_NOT_FOUND` is returned.
- Multi-line import declarations in Vue SFCs are not cleaned (Phase 3 regex is line-based). In practice, Vue SFC imports are nearly always single-line.
- Template-level `import()` calls in Vue SFCs are not detected.
- Phase 2 covers TypeScript/JavaScript files outside `tsconfig.include`. Other file types (e.g. `.json` that import by path) are not scanned.

## Technical decisions

**Why three separate scan phases instead of one unified pass?**
Each phase accesses a different population of files through a different API. ts-morph's compiler project (Phase 1) gives semantic module resolution but only sees files in `tsconfig.include`. A per-file in-memory project (Phase 2) extends coverage to test files and scripts at the cost of a fresh project per file. Regex (Phase 3) covers Vue SFCs, which TypeScript's compiler can't parse. Unifying them would require either expanding tsconfig (fragile) or giving up semantic resolution everywhere.

**Why delete last?**
ts-morph needs the target file present to resolve module specifiers during Phase 1. If the file is deleted first, `getModuleSpecifierSourceFile()` returns `undefined` for all importers and Phase 1 finds nothing.

**Why the safe re-query loop?**
Removing a ts-morph AST node (an `ImportDeclaration`) invalidates sibling node references captured before the removal — the AST is mutated in-place. Re-querying the source file's declarations after each removal guarantees fresh references for the next iteration.
