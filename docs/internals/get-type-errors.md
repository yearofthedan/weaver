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
  │   └─ project-wide: typeCheckedFiles(seed, program) → closure; getSemanticDiagnostics per member
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
            typeCheckedFiles(seed, program) → the same closure the ts path uses,
            iterated directly, skipping virtual .vue.ts entries
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

**Diagnostics do not follow the workspace walk — but the answer is not the tsconfig's file list either.**
`typeCheckedFiles` (`src/ts-engine/type-check-scope.ts`) closes the tsconfig's roots over the program's own module resolution and reports only what that reaches. Both halves matter. Following the walk means judging test files and scripts under compiler options meant for other files: measured on this repo, 251 reported errors against 2, with `pnpm check` green — 99% of them artefacts, and the 100-diagnostic cap entirely consumed by them. But filtering to `parseJsonConfigFileContent`'s raw `fileNames` under-reports instead: a file outside `include` that an included file imports is part of the program and `tsc` does report it. The closure is what makes both true at once.

**Both engines must call the shared rule, and it must compute rather than select.**
An earlier shape took two prepared file sets and picked one. That satisfied "both engines call the same module" while leaving each caller to get the closure right alone — and they did not: ts-morph resolves dependencies when it builds a project, so its set was already closed, while Volar seeds from raw `fileNames` and its set was not. The Vue engine silently under-reported exactly the imported-but-excluded files the rule exists to keep. If a change makes the shared module take a set instead of computing one, this defect comes back.

**The closure walks `SourceFile.imports` and `Program.getResolvedModule`, neither of which is in TypeScript's public `.d.ts`.**
Both exist at runtime and are what the compiler itself uses. The public alternative — `ts.preProcessFile` plus `ts.resolveModuleName` — reimplements module resolution and can disagree with what the program actually did, which would be a subtler wrong answer than depending on an internal. The failure mode to watch is silent: if an upgrade made `getResolvedModule` return `undefined` rather than throw, the closure would quietly shrink and project-wide would go back to under-reporting. The scenarios covering an excluded-but-imported file on *both* engines are what turn that into a red run instead.

**A `tsconfig` argument selects the engine, not just the project.**
Engine selection reads the first declared path param, which is `file`; a `tsconfig`-only call has none, so selection would otherwise fall back to the workspace root and hand a Vue config to `TsMorphEngine`. `isVueProject` takes a tsconfig path directly, so the named config decides. Declaring both `file` and `tsconfig` as path params also retired `usesFileForRegistry`, whose only user this was.
