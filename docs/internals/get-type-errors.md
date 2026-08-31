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
  └─ VolarEngine path (Vue projects) — every file kind answered by Volar
      ├─ single non-.vue file:
      │     getService(file) → baseService.getSemanticDiagnostics(file)
      │     real positions, no source-map translation
      ├─ single .vue file:
      │     getService(file) → build/reuse Volar service
      │     baseService.getSemanticDiagnostics(file + ".ts")  ← virtual path
      │     translate virtual offset → real .vue offset (source maps)
      │     offsetToLineCol(realContent, offset) → 1-based line/col
      │     exclude diagnostics with no source map entry (Volar glue code)
      └─ project-wide:
            iterate service.scriptFileNames, skipping virtual .vue.ts entries
            and anything absent from the compiled program
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

**A `.ts` file in a Vue project is answered by Volar, not ts-morph.**
The ts-morph project has no `.vue` language support, so it cannot resolve a `.vue` specifier and reports a false TS2307 for every import of one — while the Volar service the same engine already holds resolves it. Routing every file kind through Volar removes only that false positive: a genuinely missing SFC and an ordinary type error are still reported.

**`getTypeErrorsForFiles` refreshes every file before querying any of them.**
Post-write diagnostics would otherwise see content cached from before the write. The refreshes are hoisted out of the query loop deliberately: `Engine.refreshFile` is a per-file contract, but `VolarEngine` can only satisfy it by dropping the whole cached service for the tsconfig, so interleaving refresh and query rebuilds the entire Volar project once per modified file. Eight files cost eight builds and 1163ms interleaved, against one build and 224ms hoisted.

**The workspace file set is deliberately wider than the compiled program.**
`TsMorphEngine.addWorkspaceFiles` adds every `.ts`/`.tsx`/`.js`/`.jsx` file under the workspace to the ts-morph project regardless of `allowJs`, so a `.js` file that is never type-checked still gets navigation and import rewriting — that is what lets a `moveFile` repoint a `.js` importer. Editors draw the same distinction: a `.js` file in a TS project with `allowJs` off gets language features but no diagnostics.

**Project-wide mode must therefore filter to program members before asking for diagnostics.**
`getSemanticDiagnostics` throws (`Could not find source file`) for any path the program does not contain, so `tsGetTypeErrorsForProject` skips anything `program.getSourceFile(filePath)` does not resolve. Filter on program membership, never on the file extension: a project with `allowJs: true` has its `.js` files *in* the program and their errors must still be reported.
