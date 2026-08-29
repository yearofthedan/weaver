# Internals: get-type-errors

User-facing reference: [docs/commands/get-type-errors.md](../commands/get-type-errors.md).

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

**Project-wide mode filters the workspace file list down to the compiled program.**
`TsMorphEngine.addWorkspaceFiles` adds every `.ts`/`.tsx`/`.js`/`.jsx` file under the workspace to the ts-morph project, regardless of `allowJs` — this is deliberate, so a `.js` file with no type checking still gets navigation and import-rewrite support (e.g. a `moveFile` that repoints a `.js` importer). The compiled `Program` behind the language service excludes `.js`/`.jsx` files when `allowJs` is unset, so `tsGetTypeErrorsForProject` skips any path from `getProjectSourceFilePaths` that `program.getSourceFile(filePath)` doesn't resolve — asking the language service about a file outside the program throws. Filtering on program membership, not on extension, matters: a project with `allowJs: true` still needs its `.js` files' diagnostics reported.
