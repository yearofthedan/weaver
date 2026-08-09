# search-text

Find where a text pattern appears across the workspace. Returns structured matches that feed directly into [`replace-text`](./replace-text.md)'s surgical-edit mode.

Read-only. Respects `.gitignore`, skips binary files, skips sensitive files (`.env`, keys, certs), and rejects ReDoS-prone patterns.

## When to use

- Locating literal strings, comments, or other non-symbol text.
- Previewing what [`replace-text`](./replace-text.md) would change.

Pick [`find-references`](./find-references.md) for symbol-level lookups (it's scope-aware; this is plain regex). Pick [`find-importers`](./find-importers.md) for "who imports this file?".

## Synopsis

```bash
weaver search-text '{"pattern": "calculateTotal", "glob": "**/*.ts", "context": 2}'
```

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `pattern` | string | yes | ECMAScript regex. Rejected if `safe-regex2` flags catastrophic backtracking. |
| `glob` | string | no | Path glob filter. Supports `*`, `**`, `?`, and brace groups like `{ts,vue}` (e.g. `**/*.{ts,vue}`). Brace groups are a cartesian expansion — `{src,lib}/*.{ts,js}` expands to four patterns. Character classes `[abc]`, nested braces, and expansions over 256 patterns throw `INVALID_GLOB`. |
| `excludeGlob` | string | no | Path glob to exclude, applied after `glob`. Same syntax and limits as `glob`. Exclude multiple trees with a brace group: `{docs/archive/**,dist/**}`. |
| `context` | integer | no | Lines of context above and below each match. Omit or `0` for matches only. |
| `maxResults` | integer | no | Default `500`. |

## Output

```json
{
  "status": "success",
  "matches": [
    {
      "file": "/repo/src/utils.ts",
      "line": 12,
      "col": 14,
      "matchText": "calculateTotal",
      "surroundingText": "// Compute the order total\n\n  return calculateTotal(items);\n  const tax = computeTax(total);\n  return { total, tax };"
    }
  ],
  "truncated": false
}
```

| Field | Description |
| --- | --- |
| `matches` | Each entry: `file`, 1-based `line`/`col`, `matchText`. `surroundingText` is included only when `context > 0`. |
| `truncated` | `true` when more matches existed than `maxResults`. Narrow the pattern or glob. |

See [response format](../reference/response-format.md).

## Error codes

`PARSE_ERROR`, `REDOS`, `INVALID_GLOB`, `VALIDATION_ERROR`. See [error codes](../reference/error-codes.md).

`INVALID_GLOB` is returned — not an empty result — when the `glob` uses unsupported syntax. Do not interpret an empty result as "nothing matched" until you confirm the glob itself is valid.

## Examples

```bash
weaver search-text '{"pattern":"TODO\\(.*\\)","glob":"src/**/*.{ts,vue}","maxResults":50}'
```

Search everywhere except an archived directory:

```bash
weaver search-text '{"pattern":"oldName","excludeGlob":"docs/archive/**"}'
```

## Limitations

- ECMAScript regex syntax — no atomic groups or possessive quantifiers.
- Per-line matching — patterns matching across `\n` are not supported.
- Glob supports brace groups (`{a,b}`) but not character classes (`[abc]`) or nested braces. Passing unsupported syntax throws `INVALID_GLOB`.
- No fixed-string mode; literal regex metacharacters must be escaped.
- Binary files and sensitive files are skipped automatically.

→ Internals: [docs/internals/search-text.md](../internals/search-text.md)
