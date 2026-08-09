# rename

Scope-aware symbol rename across the project. Updates imports, call sites, type annotations, and Vue SFC bindings using the compiler's reference graph — only references that bind to the same symbol are touched.

## When to use

- Renaming a function, variable, type, class, or interface used in more than one file.
- The new name is a single fixed identifier; no disambiguation needed.

Pick [`replace-text`](./replace-text.md) instead when the text isn't an identifier (string literal, comment) or isn't bound by the compiler. Pick [`move-symbol`](./move-symbol.md) when you also need to relocate the declaration.

## Synopsis

CLI:

```bash
weaver rename '{"file": "src/utils.ts", "line": 5, "col": 10, "newName": "calculateTotal"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | Path to the file containing the symbol. Resolved against `--workspace` if relative. |
| `line` | integer | yes | 1-based line of the symbol (LSP convention). |
| `col` | integer | yes | 1-based column of the symbol. |
| `newName` | string | yes | Valid JS/TS identifier. Validated against `/^[A-Za-z_$][\w$]*$/`. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write type diagnostics on `filesModified`. |

## Output

```json
{
  "status": "success",
  "filesModified": ["src/utils.ts", "src/main.ts"],
  "filesSkipped": [],
  "nameMatches": [
    { "file": "src/foo.ts", "line": 12, "col": 5, "name": "tsProviderSingleton", "kind": "VariableDeclaration" }
  ]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `filesModified` | string[] | Files rewritten. |
| `filesSkipped` | string[] | Targets the language service identified outside the workspace boundary. |
| `nameMatches` | object[] | Identifiers in `filesModified` whose text contains the old name as a substring. Exhaustive (not sampled). Useful for catching derived names like `tsProviderSingleton` after renaming `TsProvider`. |
| `typeErrors` | object[] | Diagnostics on `filesModified` after the rename (present when `status` is `warn`). |

See [response format](../reference/response-format.md) for `status`, `typeErrors`, and the common shape.

## Error codes

`FILE_NOT_FOUND`, `SYMBOL_NOT_FOUND`, `RENAME_NOT_ALLOWED`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

Rename a function across `.ts` and `.vue` files:

```bash
weaver rename '{"file": "/repo/src/math.ts", "line": 8, "col": 17, "newName": "add"}'
```

## Limitations

- The symbol must be at a renameable position. Built-in identifiers, string literals, and template expressions are not renameable.
- Does not detect naming collisions with existing symbols in scope.
- `.js`/`.jsx` files are updated only when included in the project graph (`tsconfig allowJs`).
- Cross-type tracking (a `.ts` rename updating `.vue` references) requires the Vue engine — both files must be in the same Volar project.

→ Internals: [docs/internals/rename.md](../internals/rename.md)
