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
      │     getService(file) → add the file when the program lacks it
      │     baseService.getSemanticDiagnostics(file)
      │     real positions, no source-map translation
      ├─ single .vue file:
      │     getService(file) → build/reuse Volar service
      │     add the file when the virtual path is unmapped
      │     baseService.getSemanticDiagnostics(file + ".ts")  ← virtual path
      │     translate virtual offset → real .vue offset (source maps)
      │     offsetToLineCol(realContent, offset) → 1-based line/col
      │     exclude diagnostics with no source map entry (Volar glue code)
      └─ project-wide:
            typeCheckedFiles(seed, program) → the closure, which is the whole scope:
            iterated directly, skipping virtual .vue.ts entries
            and anything absent from the compiled program
            + vueGetTypeErrorsFromService(service, checked) for the .vue entries
            that same closure holds
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
Post-write diagnostics would otherwise see content cached from before the write. The refreshes are hoisted out of the query loop deliberately: `Engine.refreshFile` is a per-file contract, and an engine may satisfy it by dropping a whole cached project, so interleaving refresh and query rebuilds that project once per modified file. Eight files cost eight builds and 1163ms interleaved, against one build and 224ms hoisted. `VolarEngine` now repairs a path it holds in place, so the paths that still drop a service are the narrow set below — the hoist remains what bounds their cost.

**The check offers every path the dispatch wrote, and each engine decides what it holds.**
`getTypeErrorsForFiles` filters by extension only when choosing what to *query*. Filtering before the refresh loop as well leaves a written `.js` module stale in a Vue project: the module reaches the program its `.ts` importer is checked against, so the importer is reported against text that has changed on disk, while a cold engine reports the real error. An extension whitelist in the daemon is the wrong layer for this decision (see the constraint further down, which names the other way it fails) — the daemon offers a path and the engine answers for it.

**Parsed source files outlive the service that read them, and are evicted per file.**
`DiagnosticServiceCache` (`src/ts-engine/diagnostic-service.ts`) holds one entry per tsconfig
carrying both the `DiagnosticService` and the `Map<string, ts.SourceFile>` its compiler host
parses into. The parse map is what makes a rebuild cheap: dropping the service alone re-reads
one file, dropping the entry re-reads all of them. Measured on this repo (753 source files),
the post-write check went from ~540 ms to ~45 ms on the CLI path.

Retention is only correct while every change to a file evicts its parse, and there are three
signals, not two:

- `TsMorphEngine.invalidateProject` drops the whole entry — parses included.
- `TsMorphEngine.refreshFile` drops one parse and the service, keeping the rest. The watcher's
  `change` path uses it for external edits.
- `TsMorphEngine.evictDiagnosticParse`, called for **every source file the daemon writes**, via
  the `onMutated` observer on `RecordingFileSystem` (`src/daemon/self-write-state.ts`). This is
  the one that is easy to lose: most operations emit no invalidation of their own. `rename`
  emits none, and the importer rewrites behind every move go through `scope.writeFile` and emit
  none, so before this existed a move left every rewritten importer serving pre-move text — a
  fabricated TS2307 naming a specifier the file no longer contained.

The write path has a second signal, on the compiler side of the same observer: `dispatchRequest`'s
`finally` drains the paths that dispatch wrote — the pending set the `onMutated` hook also feeds —
into the registry's `refreshWrittenFile`, which re-reads each one into every loaded engine:
`TsMorphEngine.refreshWrittenFile` re-reads the file into the cached project, and
`VolarEngine.refreshWrittenFile` re-reads it into the cached service that serves it and leaves the
service in place. The ts-morph split is what keeps it cheap: the eviction above has already run for
these paths, and the post-write check has rebuilt the diagnostic program from the current text, so
evicting the parse again would discard a program that is already correct.

`refreshFile` and `refreshWrittenFile` are two contracts. `refreshFile` is the check's refresh, and
the engine may drop whatever it holds for the path, which is why the check refreshes every path
before querying any of them. `refreshWrittenFile` is the per-path repair the drain applies to
everything a dispatch wrote, and keeps the rest of the engine's state.

In `VolarEngine` both route through one predicate, `repairInPlace`: a path in the service's
`fileContents` (everything the host has read, resolved dependencies included) or in its
`scriptFileNames` (virtual-mapped for `.vue`) is re-read through `CachedService.rereadFile`, which
reads disk and, when the text differs from the text it holds, re-registers the script and bumps the
file's entry in `versions` so the language service takes a fresh snapshot. A read matching the text
already held returns before either step, so the drain's refresh of a path the check just repaired
leaves that path's parse in place ([why a bump costs one](../tech/volar-v3.md)). Measured on the
four-file `vue-errors` fixture, a three-file check costs 6 ms repaired in place against 123 ms
rebuilt, with identical diagnostics.

The two methods differ in what they do with a path the service holds nothing about:

- `refreshFile` rebuilds when a Volar program could hold the path — an extension in
  `VUE_EXTENSIONS`, or the tsconfig the service takes its options and file list from. A newly
  created source file is reachable no other way, since `scriptFileNames` is fixed when the service
  is built; without the rebuild the check reports it as clean.
- `refreshFile` leaves the service in place for anything else. A pattern-mode `replaceText` or a
  `moveDirectory` reports `.md`, `.json` and `.css` paths in `filesModified`, and dropping the
  service for one of those cost a warm check 494–517 ms on this tree against 8–22 ms.
- `refreshWrittenFile` rebuilds for the tsconfig alone and leaves every other unheld path as it is.

This rests on the tsconfig never appearing in a service's own `fileContents` — the config is parsed
through `ts.readConfigFile`, not the host's cached `readFile`. If Volar ever reads it through the
host, `repairInPlace` would repair it in place and both methods would skip the rebuild an edited
tsconfig needs, so the exclusion would have to come back.

The check covers `.ts`, `.tsx`, `.mts` and `.cts` — one set, `TYPECHECK_EXTENSIONS`, that both
engines report from — plus `.vue` in a Vue project, whose SFC diagnostics come back through the
source map. `.js`/`.jsx` are outside it because whether they are checkable depends on `allowJs`. A
path the Volar program does not hold — a gitignored file, or one under `SKIP_DIRS` — is added to
the service on demand before the query, the move `getDiagnosticServiceForFile` already made for
ts-morph. The `.ts` path re-checks program membership after the add and answers empty for a path
that is still absent, which is the state a path whose text cannot be read produces; the `.vue` path
re-checks its virtual-path mapping instead. Querying a path the program lacks would throw
`Could not find source file` and surface as `INTERNAL_ERROR`. Both engines therefore answer an
out-of-program file the same way.

**A project-wide check reports the closure, and registers what the compiler resolves to.**
`typeCheckedFiles`' closure over the compiled program is the whole scope: `checked` is that set,
`describeCheckedScope` counts it, and `vueGetTypeErrorsFromService` is handed the same set, so a
file counted as checked is a file that was diagnosed. `CachedService.builtFileNames` — the file set
the service was built with — is what `unchecked` derives from, so a file outside the closure but
inside the built set still reads as unchecked.

An included file's import of an SFC reaches that closure through registration: the host registers
the SFC from inside the callback the compiler calls while resolving, so a fresh service resolves the
import exactly as one a single-file query has added the file to by name. Registration is how an SFC
under `dist/` or `node_modules` — which the on-disk `.vue` scan filters out — and one outside the
tsconfig's own directory, beyond that scan's reach, join the program.

The closure is not filtered by `isOwnWorkspaceFile`, so an SFC under `node_modules/` that an
included file imports is diagnosed — what `tsGetTypeErrorsForProject` already does for a `.ts` file
in the same position, and what `tsc` does for a non-declaration file in its program. Only the
`checked.files` *count* excludes dependencies, so such an SFC is reported without being counted,
exactly as on the ts-morph side.

The drain runs at the end of the dispatch because `refreshFromFileSystemSync` replaces a node
tree the in-flight operation still holds references into (see the constraint below). A file the
operation deleted reaches it too: `refreshFromFileSystemSync` returns `Deleted` and forgets the
source file rather than throwing.

Two constraints on the write-path signal:

- **The write-time observer evicts the diagnostic parse only.** `refreshFile` additionally calls
  ts-morph's `refreshFromFileSystemSync()`, which replaces a node tree that operations hold
  references into while they are mid-write (`persistSourceFile`, `move-symbol`). Calling it from
  that observer trades this bug for a worse one — which is why the ts-morph refresh is deferred
  to the end-of-dispatch drain above, once the operation has returned.
- **It offers every mutation and lets the cache decide.** `DiagnosticServiceCache.refreshFile`
  drops the cached service only when a parse was actually evicted, so a `.md` or `.json` write
  costs a map lookup. An extension whitelist in the daemon was tried first and was wrong twice
  over: it is engine knowledge in the wrong layer, and it silently missed `.mts`/`.cts`, which
  the program parses but the importer-rewrite extension set does not name.

Because the eviction lives in the daemon's decorated filesystem, an engine driven over a bare
`NodeFileSystem` does not get it. Tests that need the real behaviour must build their scope over
`createSelfWriteState`, as the `moveFile`/`moveDirectory` cases do.

**The workspace file set is deliberately wider than the compiled program.**
`TsMorphEngine.addWorkspaceFiles` adds every `.ts`/`.tsx`/`.js`/`.jsx` file under the workspace to the ts-morph project regardless of `allowJs`, so a `.js` file that is never type-checked still gets navigation and import rewriting — that is what lets a `moveFile` repoint a `.js` importer. Editors draw the same distinction: a `.js` file in a TS project with `allowJs` off gets language features but no diagnostics.

**Project-wide mode must therefore filter to program members before asking for diagnostics.**
`getSemanticDiagnostics` throws (`Could not find source file`) for any path the program does not contain, so `tsGetTypeErrorsForProject` skips anything `program.getSourceFile(filePath)` does not resolve. Filter on program membership, never on the file extension: a project with `allowJs: true` has its `.js` files *in* the program and their errors must still be reported.
An engine's extension claim is backed by the set that seeds its program: `.mts`/`.cts` joined
`TYPECHECK_EXTENSIONS` and the walk that feeds Volar's `scriptFileNames` together, and a file outside
the tsconfig's `include` is the case that exercises both.

**Diagnostics do not follow the workspace walk — but the answer is not the tsconfig's file list either.**
`typeCheckedFiles` (`src/ts-engine/type-check-scope.ts`) closes the tsconfig's roots over the program's own module resolution and reports only what that reaches. Both halves matter. Following the walk means judging test files and scripts under compiler options meant for other files: measured on this repo, 251 reported errors against 2, with `pnpm check` green — 99% of them artefacts, and the 100-diagnostic cap entirely consumed by them. But filtering to `parseJsonConfigFileContent`'s raw `fileNames` under-reports instead: a file outside `include` that an included file imports is part of the program and `tsc` does report it. The closure is what makes both true at once.

**Both engines must call the shared rule, and it must compute rather than select.**
An earlier shape took two prepared file sets and picked one. That satisfied "both engines call the same module" while leaving each caller to get the closure right alone — and they did not: ts-morph resolves dependencies when it builds a project, so its set was already closed, while Volar seeds from raw `fileNames` and its set was not. The Vue engine silently under-reported exactly the imported-but-excluded files the rule exists to keep. If a change makes the shared module take a set instead of computing one, this defect comes back.

**The closure walks `SourceFile.imports` and `Program.getResolvedModule`, neither of which is in TypeScript's public `.d.ts`.**
Both exist at runtime and are what the compiler itself uses. The public alternative — `ts.preProcessFile` plus `ts.resolveModuleName` — reimplements module resolution and can disagree with what the program actually did, which would be a subtler wrong answer than depending on an internal. The failure mode to watch is silent: if an upgrade made `getResolvedModule` return `undefined` rather than throw, the closure would quietly shrink and project-wide would go back to under-reporting. The scenarios covering an excluded-but-imported file on *both* engines are what turn that into a red run instead.

**A `tsconfig` argument selects the engine, not just the project.**
Engine selection reads the first declared path param, which is `file`; a `tsconfig`-only call has none, so selection would otherwise fall back to the workspace root and hand a Vue config to `TsMorphEngine`. `isVueProject` takes a tsconfig path directly, so the named config decides. Declaring both `file` and `tsconfig` as path params also retired `usesFileForRegistry`, whose only user this was.
