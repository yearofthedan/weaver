# replace-text

Edit text across workspace files. Two modes:

- **Pattern mode** — regex replace-all across the workspace, best-effort per file.
- **Surgical mode** — exact position-verified edits fed from [`search-text`](./search-text.md), atomic.

Works on arbitrary text — not just identifiers. For symbol-level renames use [`rename`](./rename.md) (compiler-aware, scope-safe).

## When to use

- **Pattern mode:** sweeping textual changes (string literals, comment markers, version bumps).
- **Surgical mode:** precise edits where you already know the exact byte positions and the existing text — typically the output of `search-text`.

## Synopsis

Pattern mode:

```bash
weaver replace-text '{"pattern":"oldImportPath","replacement":"newImportPath","glob":"**/*.ts"}'
```

Surgical mode:

```bash
weaver replace-text '{"edits":[{"file":"src/utils.ts","line":5,"col":10,"oldText":"calculateTotal","newText":"computeTotal"}]}'
```

MCP tool name: `replaceText`.

Exactly one mode must be provided — `pattern` + `replacement` *or* `edits`, not both.

## Inputs

### Pattern mode

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `pattern` | string | yes | ECMAScript regex. Same constraints as [`search-text`](./search-text.md). |
| `replacement` | string | yes | Replacement string. `$1`, `$2`, … reference capture groups. |
| `glob` | string | no | Same as `search-text` — supports brace groups like `{ts,js}`. |
| `checkTypeErrors` | boolean | no | Default `true`. |

### Surgical mode

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `edits` | object[] | yes | Each edit: `file`, 1-based `line`, `col`, `oldText`, `newText`. |
| `checkTypeErrors` | boolean | no | Default `true`. |

`oldText` is verified at `(line, col)` before the write. Mismatch → fail atomically.

## Output

```json
{
  "status": "success",
  "filesModified": ["src/utils.ts", "src/main.ts"],
  "filesSkipped": [],
  "replacementCount": 7
}
```

`replacementCount` is the total number of replacements across all files. See [response format](../reference/response-format.md).

## Error codes

`PARSE_ERROR`, `REDOS`, `INVALID_GLOB`, `TEXT_MISMATCH`, `WORKSPACE_VIOLATION`, `SENSITIVE_FILE`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

## Examples

Bump a version string:

```bash
weaver replace-text '{"pattern":"\"version\":\"1\\.0\\.0\"","replacement":"\"version\":\"1.1.0\""}'
```

Apply surgical edits from a `search-text` result:

```bash
weaver replace-text '{"edits":[{"file":"/repo/src/api.ts","line":42,"col":1,"oldText":"old","newText":"new"}]}'
```

## Limitations

- Pattern mode replaces all matches with no per-file or per-match confirmation. Use `search-text` first to preview.
- Pattern mode silently skips files outside the workspace boundary or flagged sensitive.
- Surgical mode validates every edit up front — any failure means no file is modified.
- Surgical edits within the same file must not overlap.
- Post-write type checking covers `.ts`/`.tsx` only — `.vue` and other types in `filesModified` are silently skipped for type checking.

→ Internals: [docs/internals/replace-text.md](../internals/replace-text.md)
