# Operation: getTypeErrors

## Why use this

Use `getTypeErrors` to check whether your changes introduced type errors — either in a single file or across the whole project. Write operations (`rename`, `moveFile`, `moveSymbol`, `replaceText`) already return type errors for modified files automatically, but `getTypeErrors` is useful when you want to check a file you didn't just modify, or scan the entire project for pre-existing issues before starting work.

## What it does

Returns TypeScript semantic errors for a single file or all project files. Warnings and suggestions are excluded — only errors (`DiagnosticCategory.Error`) are reported.

**MCP tool call (single file):**

```json
{
  "name": "getTypeErrors",
  "arguments": {
    "file": "/path/to/project/src/utils.ts"
  }
}
```

**MCP tool call (whole project):**

```json
{
  "name": "getTypeErrors",
  "arguments": {}
}
```

**Response:**

```json
{
  "ok": true,
  "diagnostics": [
    {
      "file": "/path/to/project/src/utils.ts",
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

`line` and `col` are 1-based. `errorCount` is the true total; when `truncated` is true, narrow the scope by providing `file`.

## Key concepts

- **Errors only.** `DiagnosticCategory.Warning`, `Suggestion`, and `Message` are excluded.
- **Cap at 100 diagnostics.** `errorCount` always reflects the true total even when results are capped. `truncated` tells you when this happens.
- **Top-level message only.** For deeply nested generic mismatches, TypeScript produces a diagnostic chain 4–5 levels deep. Only the top node is returned — it's always the most specific description of *what* is wrong. Nested "why" context is omitted to keep responses concise.
- **Single-file vs project-wide.** With `file`, checks only that file. Without `file`, iterates all source files in the tsconfig project rooted at the workspace.
- **Post-write diagnostics on other operations.** Write operations (`rename`, `moveFile`, `moveSymbol`, `replaceText`) run type diagnostics against `filesModified` after every write and append `typeErrors`, `typeErrorCount`, `typeErrorsTruncated` to the response. Pass `checkTypeErrors: false` to suppress.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` / `.tsx` | Yes |
| `.vue` | No — pending Volar support (see handoff.md) |
| `.js` / `.jsx` | Yes when in project graph via `allowJs` |

## Constraints & limitations

- Vue SFC (`.vue`) diagnostics are not yet supported.
- Post-write diagnostics only cover `.ts`/`.tsx` files — `.vue` or other file types in `filesModified` are silently skipped.
- The project is loaded fresh from disk on first access; subsequent calls reuse the daemon's cached project.

## Security & workspace boundary

- Single-file mode: `file` is validated against the workspace root. Invalid paths return `WORKSPACE_VIOLATION`; non-existent files return `FILE_NOT_FOUND`.
- Project-wide mode: iterates files in the tsconfig project rooted at the workspace. No files outside the project graph are checked.
- Diagnostics are read-only — no files are written.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why errors only, not warnings?**
Agents act on diagnostics. Warnings are informational and rarely actionable in an automated workflow — including them would add noise and consume context window for no benefit.

**Why cap at 100?**
A project with hundreds of type errors is usually in a broken state where individual diagnostics are less useful. The cap keeps response size bounded. `errorCount` preserves the signal that more exist.

**Why top-level message only?**
For simple mismatches, the top-level message is a short, self-contained sentence. For deeply nested generic mismatches, the chain can be 4–5 levels; returning the full chain would produce hundreds of characters of concatenated context. The top node is always the most specific description of *what* is wrong.
