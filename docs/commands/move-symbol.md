# move-symbol

Move a named export from one file to another and update every importer project-wide. More precise than [`move-file`](./move-file.md) (whole file), safer than manual cut-paste plus [`replace-text`](./replace-text.md) (no missed importers).

## When to use

- Relocating one declaration (function, class, type, const) to a different module.
- The symbol is a top-level `export` in the source file.

Pick [`move-file`](./move-file.md) when the whole file should move. Pick a manual cut-paste only when nothing imports the symbol.

## Synopsis

```bash
weaver move-symbol '{"sourceFile": "src/utils.ts", "symbolName": "calculateTotal", "destFile": "src/math/totals.ts"}'
```

MCP tool name: `moveSymbol`.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `sourceFile` | string | yes | File currently containing the export. |
| `symbolName` | string | yes | Valid JS/TS identifier. The exported symbol to move. |
| `destFile` | string | yes | Target file. Created if it doesn't exist. |
| `force` | boolean | no | Default `false`. If `true`, replaces a same-named declaration in `destFile`. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write type diagnostics on `filesModified`. |

## Output

```json
{
  "status": "success",
  "filesModified": ["src/utils.ts", "src/math/totals.ts", "src/main.ts"],
  "filesSkipped": []
}
```

`filesModified` lists the source, destination, and every importer rewritten. See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `SYMBOL_NOT_FOUND`, `SYMBOL_EXISTS`, `NOT_SUPPORTED`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

`SYMBOL_EXISTS` is returned when `destFile` already declares a symbol with the same name and `force` is not set; no files are modified.

## Examples

Move and overwrite an existing same-named declaration:

```bash
weaver move-symbol '{"sourceFile":"src/a.ts","symbolName":"foo","destFile":"src/b.ts","force":true}'
```

## Limitations

- The symbol must be a direct exported declaration (`export function`, `export const`, `export class`, …). Re-exports via `export { foo }` return `NOT_SUPPORTED`.
- Class methods are not supported — top-level exports only.
- `destFile` must be inside the workspace.
- Moving symbols *from* a `.vue` source file is not yet supported (only `.ts`/`.tsx` sources).

→ Internals: [docs/internals/move-symbol.md](../internals/move-symbol.md)
