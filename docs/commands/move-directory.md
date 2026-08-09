# move-directory

Move an entire directory to a new location and rewrite every import across the project. Handles nested subdirectories, non-source files, and intra-directory references in a single operation.

## When to use

- Restructuring a folder of related files (e.g. moving `src/utils` → `src/helpers`).
- You want non-source files (config, images, markdown) moved alongside the code.

Pick [`move-file`](./move-file.md) for individual files. Pick a plain `mv` only when no file outside the directory imports anything inside it.

## Synopsis

```bash
weaver move-directory '{"oldPath": "src/utils", "newPath": "src/helpers"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `oldPath` | string | yes | Current directory. Must exist and be a directory. |
| `newPath` | string | yes | Destination. Must not exist as a non-empty directory; must not be inside `oldPath`. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write type diagnostics on `filesModified`. |

## Output

```json
{
  "status": "success",
  "filesMoved": ["src/helpers/a.ts", "src/helpers/b.ts", "src/helpers/icon.svg"],
  "filesModified": ["src/main.ts", "src/components/App.vue"],
  "filesSkipped": [],
  "oldPath": "src/utils",
  "newPath": "src/helpers"
}
```

| Field | Description |
| --- | --- |
| `filesMoved` | Every file physically moved (source + non-source). |
| `filesModified` | Files outside the moved directory whose imports were rewritten. |
| `filesSkipped` | Importers outside the workspace boundary. |

See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `NOT_A_DIRECTORY`, `DESTINATION_EXISTS`, `MOVE_INTO_SELF`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver move-directory '{"oldPath": "/repo/src/utils", "newPath": "/repo/src/helpers"}'
```

## Limitations

- Both paths must be inside the workspace.
- `node_modules`, `.git`, and similar `SKIP_DIRS` nested inside the source directory are not enumerated and stay where they are.
- Symbolic links are skipped.
- Dynamic `import()` calls with computed paths are not updated.
- Sub-project boundaries (nested `tsconfig.json`) are respected — internal imports are preserved.

→ Internals: [docs/internals/move-directory.md](../internals/move-directory.md)
