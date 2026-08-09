# get-type-errors

TypeScript type errors for a single file or across the whole project, including `.vue` SFCs in Vue projects. Warnings and suggestions are excluded — errors only.

Read-only.

## When to use

- Project-wide health check before a commit.
- Verifying a write operation didn't break unrelated files (write commands return errors for `filesModified` automatically — use this for everything else).

## Synopsis

Single file:

```bash
weaver get-type-errors '{"file": "src/utils.ts"}'
```

Whole project:

```bash
weaver get-type-errors '{}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | no | If provided, scope diagnostics to that file (TS or `.vue`). Omit for project-wide. |

## Output

```json
{
  "status": "success",
  "diagnostics": [
    {
      "file": "/repo/src/utils.ts",
      "line": 10,
      "col": 5,
      "code": 2322,
      "message": "Type 'string' is not assignable to type 'number'."
    }
  ],
  "errorCount": 1,
  "truncated": false
}
```

| Field | Description |
| --- | --- |
| `diagnostics` | Up to 100 entries. Each `line`/`col` is 1-based; `.vue` positions are in the real `.vue` source (not the virtual TS). |
| `errorCount` | True total even when capped — narrow the scope by passing `file`. |
| `truncated` | `true` when more than 100 errors existed. |

See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver get-type-errors '{"file":"/repo/src/App.vue"}'
weaver get-type-errors '{}'
```

## Limitations

- Errors only — warnings and suggestions are excluded.
- Capped at 100 diagnostics per call. `errorCount` preserves the true count.
- Top-level message only (no chained context for deep generic mismatches).
- Template errors in `.vue` files are reported alongside script-block errors (matches `vue-tsc` and IDEs).
- `.js`/`.jsx` files are checked only when included via `tsconfig allowJs`.

→ Internals: [docs/internals/get-type-errors.md](../internals/get-type-errors.md)
