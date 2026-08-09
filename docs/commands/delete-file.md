# delete-file

Remove a file and clean up every import and re-export that references it across the workspace.

## When to use

- Deleting a file that other files import or re-export.
- You want a single compiler-backed sweep instead of a `rm` followed by manual import cleanup.

Pick a plain `rm` only when nothing imports the file (verify with [`find-importers`](./find-importers.md)).

## Synopsis

```bash
weaver delete-file '{"file": "src/old-helper.ts"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | File to delete. Must exist and be inside the workspace. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write diagnostics on `filesModified`. Type errors are expected — removing an import leaves the using code broken. |

## Output

```json
{
  "status": "success",
  "deletedFile": "/repo/src/old-helper.ts",
  "filesModified": ["src/api.ts", "src/barrel.ts", "tests/helper.test.ts"],
  "filesSkipped": [],
  "importRefsRemoved": 4
}
```

| Field | Description |
| --- | --- |
| `deletedFile` | Echo of the absolute path removed. |
| `filesModified` | Files whose imports/re-exports were cleaned. Does not include `deletedFile`. |
| `filesSkipped` | Importers outside the workspace boundary. |
| `importRefsRemoved` | Total `import`/`export` declarations removed. |

See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver delete-file '{"file": "/repo/src/legacy/dead.ts"}'
```

## Limitations

- The file must exist at call time. Already deleted → `FILE_NOT_FOUND`.
- Multi-line `import` declarations in `.vue` SFCs are not cleaned (Vue scan is line-based; rare in practice).
- Template-level `import()` calls in `.vue` SFCs are not detected.
- Non-TS/JS files that reference the deleted file by path (e.g. `.json`, `.md`) are not scanned.

→ Internals: [docs/internals/delete-file.md](../internals/delete-file.md)
