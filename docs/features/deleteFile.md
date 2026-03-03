# Feature: deleteFile

**Purpose:** Remove a file and clean up every import and re-export that references it, across the whole workspace, in one compiler-backed operation.

## What it does

Deletes the target file from disk after removing all `import` and `export … from` declarations that reference it. Covers TypeScript/JavaScript files in the compiler project, files outside `tsconfig.include` (test files, scripts), and Vue SFC `<script>` blocks.

**MCP tool call:**

```json
{
  "name": "deleteFile",
  "arguments": {
    "file": "/path/to/project/src/old-helper.ts"
  }
}
```

**Response:**

```json
{
  "ok": true,
  "deletedFile": "/path/to/project/src/old-helper.ts",
  "filesModified": [
    "/path/to/project/src/api.ts",
    "/path/to/project/src/barrel.ts",
    "/path/to/project/tests/helper.test.ts"
  ],
  "filesSkipped": [],
  "importRefsRemoved": 4,
  "typeErrors": [
    {
      "file": "/path/to/project/src/api.ts",
      "line": 12,
      "col": 3,
      "code": 2304,
      "message": "Cannot find name 'oldHelper'."
    }
  ],
  "typeErrorCount": 1,
  "typeErrorsTruncated": false
}
```

- `deletedFile` — echo of the absolute path removed. Useful to confirm the right file was targeted.
- `filesModified` — files whose import/re-export declarations were cleaned. Does not include `deletedFile` itself.
- `filesSkipped` — importers outside the workspace boundary that were found but not written. Surface these to the user.
- `importRefsRemoved` — count of individual `import`/`export` declarations removed across all modified files.
- `typeErrors` / `typeErrorCount` / `typeErrorsTruncated` — type errors in modified files after the deletion; injected automatically by the dispatcher (same as all mutating operations). Expect errors here: removing an import leaves any code that *used* those symbols broken. Pass `checkTypeErrors: false` to suppress.

## Key concepts

**Three-phase cleanup before physical deletion.** The file is only deleted from disk after all importer edits are written, because ts-morph needs the file present to resolve module specifiers during the scan.

**Phase 1 — in-project scan (ts-morph).** Iterates the compiler project and uses `getModuleSpecifierSourceFile()` to find every `import` and `export … from` declaration that resolves to the target. Handles named imports, type-only imports, namespace imports, default imports, re-exports (`export *`, `export { }`), and side-effect imports.

**Phase 2 — out-of-project TS/JS scan.** Walks workspace files not in `tsconfig.include` (test files, scripts) using an in-memory ts-morph project per file. Module specifier resolution is done manually via `path.resolve` + extension stripping — this correctly handles bare specifiers (`'./foo'`), `.ts`, `.tsx`, `.js`, and `.jsx` extensions.

**Phase 3 — Vue SFC scan (regex).** TypeScript's compiler is blind to imports inside Vue `<script>` blocks. The scanner walks `.vue` files and removes matching import/export lines with regex, consistent with how `updateVueImportsAfterMove` works. Covers `<script>` and `<script setup>` blocks; does not parse template-level `import()` expressions.

**Safe re-query loop.** Removing a ts-morph AST node invalidates sibling node references captured before the removal. The implementation re-queries a source file's declarations after each removal so stale references are never used.

**Provider cache invalidation.** After deletion, `tsProvider.invalidateProject(file)` drops the cached project so the next request rebuilds without the deleted file. The file-system watcher's `unlink` event also triggers `invalidateAll` independently.

## Supported file types

- `.ts`, `.tsx`, `.js`, `.jsx` as the deleted file — full support
- `.vue` as the deleted file — physical deletion works; TS/JS importers that reference it by path are cleaned in Phase 2
- `.vue` files as importers — cleaned in Phase 3 regardless of the deleted file's type

## Constraints & limitations

- Multi-line import declarations in Vue SFCs are not cleaned (regex is line-based). In practice, Vue SFC imports are nearly always single-line.
- Template-level `import()` calls in Vue SFCs are not detected.
- The file must exist at call time; if already deleted, `FILE_NOT_FOUND` is returned.

## Security & workspace boundary

- **Input:** `file` is validated against the workspace root by the dispatcher (`pathParams: ["file"]`). Paths outside the workspace return `WORKSPACE_VIOLATION` before the operation runs.
- **Output writes:** Only files inside the workspace boundary are written. Importers found outside the workspace appear in `filesSkipped` and are not modified.

## Error codes

| Code | When |
|------|------|
| `FILE_NOT_FOUND` | Target file does not exist on disk |
| `WORKSPACE_VIOLATION` | Target path is outside the workspace (dispatcher layer) |
| `VALIDATION_ERROR` | Schema validation failed (e.g. empty `file` string) |
