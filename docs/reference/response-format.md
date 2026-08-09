# Response format

Every weaver command returns a JSON object on stdout. This page documents the fields that every command shares; per-command extras (e.g. `replacementCount`, `nameMatches`) are in the matching [command page](../commands/).

## status field

Every response contains `status`:

| Value | Meaning | When |
| --- | --- | --- |
| `"success"` | Operation completed cleanly | No errors, or `checkTypeErrors: false`, or zero files modified. |
| `"warn"` | Operation completed but left type errors | `typeErrorCount > 0` after post-write diagnostics. |
| `"error"` | Operation failed | Validation, boundary, engine, or internal error. See [error codes](./error-codes.md). |

Exit codes from CLI invocations: `0` for `success` or `warn`, `1` for `error` or any CLI-level failure.

## Mutating operations

Successful write:

```json
{
  "status": "success",
  "filesModified": ["src/components/Button.vue", "src/App.vue"],
  "filesSkipped": []
}
```

With type errors after the write:

```json
{
  "status": "warn",
  "filesModified": ["src/a.ts"],
  "filesSkipped": [],
  "typeErrors": [
    { "file": "src/a.ts", "line": 3, "col": 7, "code": 2322, "message": "Type 'string' is not assignable to type 'number'." }
  ],
  "typeErrorCount": 1,
  "typeErrorsTruncated": false
}
```

| Field | Description |
| --- | --- |
| `filesModified` | Absolute paths of files written. |
| `filesSkipped` | Files the operation would have written but skipped because they fell outside the workspace boundary. Agents should surface this to the user. |
| `typeErrors` | Diagnostics for `filesModified`. Up to 100 entries. Capped to TS/TSX files; `.vue` files in `filesModified` are not type-checked here. |
| `typeErrorCount` | True total even when capped. |
| `typeErrorsTruncated` | `true` when the cap was hit. |

`checkTypeErrors: false` on the input suppresses post-write diagnostics — `typeErrors` and friends are omitted, and `status` stays `success`.

## Read-only operations

```json
{
  "status": "success",
  "references": [
    { "file": "/repo/src/App.vue", "line": 5, "col": 3, "length": 6 }
  ],
  "message": "Found 1 references"
}
```

Read-only commands (`find-references`, `find-importers`, `get-definition`, `get-type-errors`, `search-text`) carry their result under a command-specific field — see the relevant [command page](../commands/) for the exact shape.

Read-only results are never filtered to the workspace boundary. Hiding cross-package references would be worse than showing them.

## Failure

```json
{
  "status": "error",
  "error": "SYMBOL_NOT_FOUND",
  "message": "Could not find symbol at line 5, column 10"
}
```

| Field | Description |
| --- | --- |
| `error` | Stable machine-readable code. Branch on this — see [error codes](./error-codes.md) for the full list. |
| `message` | Human-readable description. May change between versions; do not parse. |

## Common conventions

- All paths in responses are absolute.
- All `line`/`col` positions are 1-based (LSP convention).
- For `.vue` files, positions refer to the real `.vue` source, not the virtual `.vue.ts` representation.
- Lists in responses are returned in deterministic order (file path, then position).
