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

Under a specific tsconfig:

```bash
weaver get-type-errors '{"tsconfig": "tsconfig.test.json"}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | string | no | If provided, scope diagnostics to that file (TS or `.vue`). Absolute, or relative to the workspace root. Omit for project-wide. |
| `tsconfig` | string | no | Answer for this tsconfig instead of the one discovered at the workspace root. Absolute, or relative to the workspace root. Mutually exclusive with `file`. |

## What project-wide covers

A project-wide check answers the same question `tsc -p <tsconfig>` answers: the tsconfig's own files plus everything they import. A file the tsconfig excludes is not reported — unless an included file imports it, which is exactly what `tsc` does.

That is narrower than the file set weaver builds for `rename` and `find-references`, which deliberately reaches every file in the workspace so a refactor can repoint imports in files the tsconfig never compiles.

So a workspace with sibling configs — `tsconfig.json` for `src/`, `tsconfig.test.json` for tests — needs one call per config. weaver cannot discover the siblings on its own (tsconfig lookup only ever matches the literal name `tsconfig.json`), so the response names the ones it can see in `unchecked.otherConfigs` and you pass the one you want as `tsconfig`.

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
| `checked` | Project-wide only. `{ files, tsconfig }` — how many of your own files were covered, and the absolute path of the tsconfig that answered (`null` when the workspace has none). |
| `unchecked` | Project-wide only. `{ files, reason, otherConfigs }` — how many of your workspace's TS/JS files fell outside that scope, why, and up to 10 other `tsconfig*.json` files at the workspace root you could pass as `tsconfig`. |

`checked.files` and `unchecked.files` count *your* files: both exclude `node_modules`. Diagnostics are not so limited — a dependency's own `.d.ts` errors are reported when `skipLibCheck` is off, because `tsc` reports them.

**Read `unchecked.files` before trusting `errorCount: 0`.** A clean result means the checked scope is clean, not that the workspace is. When `unchecked.files` is non-zero, the files it counts were never examined.

See [response format](../reference/response-format.md).

## Error codes

`FILE_NOT_FOUND`, `WORKSPACE_VIOLATION`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

```bash
weaver get-type-errors '{"file":"/repo/src/App.vue"}'
weaver get-type-errors '{}'
weaver get-type-errors '{"tsconfig":"tsconfig.eval.json"}'
```

## Limitations

- Errors only — warnings and suggestions are excluded.
- Capped at 100 diagnostics per call. `errorCount` preserves the true count.
- Project-wide covers one tsconfig at a time. A workspace with sibling configs needs one call each; `unchecked.otherConfigs` names them.
- `unchecked.otherConfigs` scans the workspace root only, so a monorepo's `packages/*/tsconfig.json` is not listed.
- Passing `file` for a file the tsconfig excludes still answers, but judges it under that tsconfig's options — which may not be the ones that file is really built with.
- Top-level message only (no chained context for deep generic mismatches).
- Template errors in `.vue` files are reported alongside script-block errors (matches `vue-tsc` and IDEs).
- `.js`/`.jsx` files are checked only when included via `tsconfig allowJs`.

→ Internals: [docs/internals/get-type-errors.md](../internals/get-type-errors.md)
