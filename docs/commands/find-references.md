# find-references

Discover every usage of a symbol — who calls this function, who reads this variable, who implements this interface — through the compiler's reference graph rather than text matching.

Read-only.

## When to use

- Before changing a function signature, type, or class — see who breaks.
- Auditing dead code or "is this still used?" questions.

Pick [`search-text`](./search-text.md) only when you need text-level matches (string literals, comments). Pick [`find-importers`](./find-importers.md) when you only care about which files import a given file.

## Synopsis

```bash
weaver find-references '{"file": "src/utils.ts", "line": 5, "col": 10}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | File containing the symbol. Inside the workspace. |
| `line` | integer | yes | 1-based line of the symbol. |
| `col` | integer | yes | 1-based column of the symbol. |

## Output

```json
{
  "status": "success",
  "references": [
    { "file": "/repo/src/utils.ts", "line": 5, "col": 10 },
    { "file": "/repo/src/App.vue", "line": 12, "col": 3 }
  ],
  "message": "Found 2 references"
}
```

The declaration site is included. Empty `references` means no symbol found at the position. See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver find-references '{"file": "/repo/src/api.ts", "line": 14, "col": 22}'
```

## Limitations

- Results may include references in files outside the workspace if those files are in the project graph (no filtering on read-only output — would silently hide cross-package uses).
- `.js`/`.jsx` references are returned only when those files are in the project graph (`tsconfig allowJs`).

→ Internals: [docs/internals/find-references.md](../internals/find-references.md)
