# Feature: getTypeErrors

**Purpose:** Check for TypeScript type errors in a single file or across the whole project.

Warnings and suggestions are excluded — only errors (`DiagnosticCategory.Error`) are reported. Write operations (`rename`, `moveFile`, `moveSymbol`, `replaceText`) already return type errors for modified files automatically; `getTypeErrors` covers files that weren't just modified and project-wide baseline checks.

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

Response:

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

`line` and `col` are 1-based. `errorCount` is the true total even when results are capped at 100. When `truncated` is true, narrow the scope by providing `file`.

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   if file provided: validates against workspace boundary
  ▼ getTypeErrors() (src/operations/getTypeErrors.ts)
  │   ├─ single-file mode (file provided)
  │   │     tsProvider.getSemanticDiagnostics(file) → errors for that file only
  │   └─ project-wide mode (no file)
  │         tsProvider.getSourceFiles() → iterate all files in tsconfig project
  │         getSemanticDiagnostics() per file → collect all errors
  │   filter: DiagnosticCategory.Error only; take first 100; set truncated if more exist
  │   for each diagnostic: top-level message only (chain[0]); convert to 1-based line/col
  ▼ result { ok, diagnostics[], errorCount, truncated }
```

`.vue` files are not supported — the TS provider cannot check Vue SFC `<script>` blocks directly.

## Security

- Single-file mode: `file` is validated against the workspace root. Invalid paths return `WORKSPACE_VIOLATION`; non-existent files return `FILE_NOT_FOUND`.
- Project-wide mode: iterates files in the tsconfig project rooted at the workspace. No files outside the project graph are checked.
- Diagnostics are read-only — no files are written.

See [security.md](../security.md) for the full threat model.

## Constraints

- Vue SFC (`.vue`) diagnostics are not yet supported. See `docs/handoff.md` for the pending Volar extension.
- Post-write type checking on other operations only covers `.ts`/`.tsx` files — `.vue` or other file types in `filesModified` are silently skipped.
- `.js`/`.jsx` files are checked only when in the project graph via `allowJs`.
- The project is loaded fresh from disk on first access; subsequent calls reuse the daemon's cached project.

## Technical decisions

**Why errors only, not warnings?**
Agents act on diagnostics. Warnings are informational and rarely actionable in an automated workflow — including them would add noise and consume context window for no benefit.

**Why cap at 100?**
A project with hundreds of type errors is usually in a broken state where individual diagnostics are less useful. The cap keeps response size bounded. `errorCount` preserves the signal that more exist.

**Why top-level message only?**
For simple mismatches, the top-level message is a short, self-contained sentence. For deeply nested generic mismatches, the chain can be 4–5 levels; returning the full chain would produce hundreds of characters of concatenated context. The top node is always the most specific description of *what* is wrong.

## Implementation notes

**`getTypeErrors` uses `TsProvider` directly, not `LanguageProvider`.**
Vue SFC diagnostics via Volar are deferred (handoff P4 item 16). The operation signature takes `TsProvider` instead of the generic `LanguageProvider` interface. The dispatcher calls `registry.tsProvider()` (always returns `TsProvider`, even in Vue projects). This matches the pattern used by `moveSymbol`.

**`getTypeErrorsForFiles` must call `refreshFromFileSystemSync()` before checking diagnostics.**
When post-write diagnostics run against a file that the TsProvider project already has cached (e.g. from a previous operation in the same daemon lifetime), ts-morph will see stale content unless `refreshFromFileSystemSync()` is called first. `getTypeErrorsForFiles` always does this. For fresh TsProvider instances (new projects loaded for the first time), the file is read directly from disk and no refresh is needed — but calling `refreshFromFileSystemSync()` on a newly-added source file is a safe no-op.
