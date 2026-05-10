# get-definition

Jump from a usage to its declaration — resolves through re-exports, barrel files, and declaration files to the actual definition site. Same as "go to definition" in an IDE.

Read-only.

## When to use

- "Where is this function/type defined?"
- Resolving an unfamiliar import to its declaration without text-searching by name.

Pick [`search-text`](./search-text.md) only when path-aware resolution doesn't matter.

## Synopsis

```bash
weaver get-definition '{"file": "src/App.vue", "line": 12, "col": 8}'
```

MCP tool name: `getDefinition`.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | File containing the usage. Inside the workspace. |
| `line` | integer | yes | 1-based line of the symbol. |
| `col` | integer | yes | 1-based column of the symbol. |

## Output

```json
{
  "status": "success",
  "definitions": [
    { "file": "/repo/src/utils.ts", "line": 5, "col": 10 }
  ],
  "message": "Found 1 definition"
}
```

Most symbols resolve to a single definition; overloaded functions may return multiple. Empty `definitions` means no symbol at that position. See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver get-definition '{"file": "/repo/src/App.vue", "line": 12, "col": 8}'
```

## Limitations

- Definitions in `.d.ts` files point to the type declaration, not the JavaScript runtime value.
- Symbols resolving to a built-in or `node_modules` type return paths inside `node_modules` — this is correct and not filtered.
- Reflects the in-memory project graph; file-watcher debounce (~200ms) applies after out-of-band changes.

→ Internals: [docs/internals/get-definition.md](../internals/get-definition.md)
