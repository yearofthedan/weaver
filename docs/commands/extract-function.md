# extract-function

Pull a block of statements out of a function body into a new module-scope function. The compiler infers parameters, return values, type annotations, and async propagation.

## When to use

- A function is too long and a contiguous block of statements deserves its own name.
- You want compiler-inferred parameters and return type rather than writing them by hand.

The extracted function is placed at module scope and is not exported. Use [`move-symbol`](./move-symbol.md) to relocate it afterwards.

## Synopsis

```bash
weaver extract-function '{"file":"src/handler.ts","startLine":12,"startCol":3,"endLine":18,"endCol":42,"functionName":"buildResponse"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | yes | File containing the selection. Inside the workspace. |
| `startLine` | integer | yes | 1-based line of the first selected character. |
| `startCol` | integer | yes | 1-based column of the first selected character. |
| `endLine` | integer | yes | 1-based line of the last selected character. |
| `endCol` | integer | yes | 1-based column of the **last selected character (inclusive)**. Must point at the last token of the last statement. |
| `functionName` | string | yes | Valid JS/TS identifier. |
| `checkTypeErrors` | boolean | no | Default `true`. Run post-write type diagnostics. |

## Output

```json
{
  "status": "success",
  "filesModified": ["src/handler.ts"],
  "functionName": "buildResponse",
  "parameterCount": 2
}
```

| Field | Description |
| --- | --- |
| `functionName` | Echo of the new function's name. |
| `parameterCount` | Parameters the compiler inferred. |

See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `NOT_SUPPORTED`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

`NOT_SUPPORTED` covers: selection outside any function body, selection that doesn't cover complete statements, and `.vue` files without `<script setup>`.

## Examples

Extract a block from inside an async handler:

```bash
weaver extract-function '{"file":"/repo/src/handler.ts","startLine":12,"startCol":3,"endLine":18,"endCol":42,"functionName":"buildResponse"}'
```

## Limitations

- Selection must be inside a function body — module-level statements cannot be extracted.
- Selection must cover **complete statements**. The compiler silently returns no applicable refactors when the selection ends mid-statement. In semicolon-using code, `endCol` must point at the `;`. In no-semi code, point at the last token (e.g. the closing `)` of a call).
- The extracted function is always placed at module scope.
- The extracted function is not exported.
- `.vue` files require a `<script setup>` block. Options API `<script>` returns `NOT_SUPPORTED`.
- Does not detect naming collisions with existing symbols in scope.

→ Internals: [docs/internals/extract-function.md](../internals/extract-function.md)
