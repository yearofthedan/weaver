# Feature: getTypeErrors

**Purpose:** Check for TypeScript type errors in a single file or across the whole project, including `.vue` SFC files in Vue projects.

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

`.vue` files are accepted:

```json
{
  "name": "getTypeErrors",
  "arguments": {
    "file": "/path/to/project/src/App.vue"
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

`line` and `col` are 1-based. For `.vue` files they are positions in the real `.vue` source (not the virtual TypeScript). `errorCount` is the true total even when results are capped at 100. When `truncated` is true, narrow the scope by providing `file`.

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   registry.projectEngine() → TsMorphEngine (TS-only project) or VolarEngine (Vue project)
  │   if file provided: validates existence + workspace boundary
  ▼ getTypeErrors() (src/operations/getTypeErrors.ts)
  │   delegates to engine.getTypeErrors(file, scope)
  │
  ├─ TsMorphEngine path (TS-only projects)
  │   ├─ single-file: tsLS.getSemanticDiagnostics(file)
  │   └─ project-wide: iterate tsconfig source files, getSemanticDiagnostics per file
  │
  └─ VolarEngine path (Vue projects)
      ├─ single .ts file: delegate to TsMorphEngine
      ├─ single .vue file:
      │     getService(file) → build/reuse Volar service
      │     baseService.getSemanticDiagnostics(file + ".ts")  ← virtual path
      │     translate virtual offset → real .vue offset (source maps)
      │     offsetToLineCol(realContent, offset) → 1-based line/col
      │     exclude diagnostics with no source map entry (Volar glue code)
      └─ project-wide:
            TsMorphEngine errors for .ts files
            + vueGetTypeErrorsFromService() for all .vue files in the Volar service
            merged under a single 100-error cap

  filter: DiagnosticCategory.Error only; take first 100; set truncated if more exist
  for each diagnostic: top-level message only (chain[0]); convert to 1-based line/col
  ▼ result { ok, diagnostics[], errorCount, truncated }
```

## Security

- Single-file mode: `file` is validated against the workspace root. Invalid paths return `WORKSPACE_VIOLATION`; non-existent files return `FILE_NOT_FOUND`.
- Project-wide mode: iterates files in the tsconfig project (TS engine) and files registered in the Volar service (Vue engine). No files outside the project graph are checked.
- Diagnostics are read-only — no files are written.

See [security.md](../security.md) for the full threat model.

## Constraints

- Template errors in `.vue` files are included alongside script-block errors — this matches `vue-tsc` and IDE behavior. Volar compiles the entire SFC to virtual TypeScript; all resulting errors are reported.
- Post-write type checking on other operations (`rename`, `moveFile`, etc.) only covers `.ts`/`.tsx` files — `.vue` files in `filesModified` are silently skipped. See `docs/handoff.md` for the pending extension.
- `.js`/`.jsx` files are checked only when in the project graph via `allowJs`.
- The project is loaded fresh from disk on first access; subsequent calls reuse the daemon's cached project.

## Technical decisions

**Why errors only, not warnings?**
Agents act on diagnostics. Warnings are informational and rarely actionable in an automated workflow — including them would add noise and consume context window for no benefit.

**Why cap at 100?**
A project with hundreds of type errors is usually in a broken state where individual diagnostics are less useful. The cap keeps response size bounded. `errorCount` preserves the signal that more exist.

**Why top-level message only?**
For simple mismatches, the top-level message is a short, self-contained sentence. For deeply nested generic mismatches, the chain can be 4–5 levels; returning the full chain would produce hundreds of characters of concatenated context. The top node is always the most specific description of *what* is wrong.

**Why include template errors, not just `<script>` errors?**
Filtering to script-block-only would produce false negatives: renaming a variable in `<script setup>` while the template still references the old name would show "no errors" when the template binding is broken. Including everything matches what `vue-tsc` and IDEs report.

## Implementation notes

**`getTypeErrors` routes through `Engine`, not `TsMorphEngine` directly.**
The dispatcher calls `registry.projectEngine()`, which returns `VolarEngine` for Vue projects and `TsMorphEngine` for TS-only projects. Both implement `getTypeErrors(file, scope)` on the `Engine` interface. The operation is a thin wrapper that validates inputs and delegates.

**Vue position translation uses source maps, not TS line APIs.**
`baseService.getSemanticDiagnostics(virtualPath)` returns positions in the virtual `.vue.ts` content. `translateVirtualOffset` maps each position back to the real `.vue` source offset via `mapper.toSourceLocation()` (the same source-map machinery as `translateSingleLocation`), then `offsetToLineCol()` converts to 1-based line/col. Diagnostics with no source map entry (Volar glue code) are excluded.

**`getTypeErrorsForFiles` must call `refreshFromFileSystemSync()` before checking diagnostics.**
When post-write diagnostics run against a file that the TsMorphEngine project already has cached, ts-morph will see stale content unless `refreshFromFileSystemSync()` is called first. `getTypeErrorsForFiles` always does this.
