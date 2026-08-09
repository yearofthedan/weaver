# find-importers

Every file that imports a given file. Uses the compiler's project graph rather than text matching — sees through path aliases, barrel re-exports, extensionless imports, and Vue SFCs.

Read-only.

## When to use

- "Who imports this file?" — before moving or deleting it.
- Auditing barrel files or re-export structure.

Pick [`find-references`](./find-references.md) when you want references to a *symbol*, not the file. Pick [`search-text`](./search-text.md) only when path aliases and re-exports don't matter.

## Synopsis

```bash
weaver find-importers '{"file": "src/utils.ts"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | File whose importers you want. Inside the workspace. |

No `line`/`col` — the file itself is the target.

## Output

```json
{
  "status": "success",
  "fileName": "utils.ts",
  "references": [
    { "file": "/repo/src/main.ts", "line": 1, "col": 10, "length": 9 },
    { "file": "/repo/src/App.vue", "line": 2, "col": 9, "length": 9 }
  ]
}
```

| Field | Description |
| --- | --- |
| `fileName` | Basename of the queried file. |
| `references` | Each entry points at the import specifier string (the `"./utils"` part). |

`references` is empty when nothing imports the file — this is not an error. See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver find-importers '{"file": "/repo/src/Button.vue"}'
```

## Limitations

- Returns import-specifier positions, not symbol positions.
- Files not in the TypeScript project graph (e.g. `.json`, `.css`) return empty results.
- May include references from files outside the workspace if they're in the project graph (e.g. `node_modules`).

→ Internals: [docs/internals/find-importers.md](../internals/find-importers.md)
