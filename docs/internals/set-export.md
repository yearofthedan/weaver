# Internals: set-export

User-facing reference: [docs/commands/set-export.md](../commands/set-export.md).

## How it works

ts-morph's `setIsExported` handles every declaration form uniformly, so the work is all in resolving *which* declaration the name means, and — for the remove direction — proving nothing outside the file depends on it.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary
  ▼ setExport() (src/operations/setExport.ts)
  │   assertFileExists → FILE_NOT_FOUND
  ▼ VolarEngine.setExport (src/plugins/vue/engine.ts) — Vue projects only
  │   ├─ .vue target → NOT_SUPPORTED
  │   └─ remove direction: vueScriptsReferencingSymbol() scans SFC scripts,
  │        passed down as knownReferences
  ▼ tsSetExport() (src/ts-engine/set-export.ts)
  │   ├─ getSourceFile(file) ?? addSourceFileAtPath(file)
  │   ├─ resolveTarget() — the single top-level statement declaring the name,
  │   │     plus the node references resolve from (the declarator, for a
  │   │     variable statement). Throws SYMBOL_NOT_FOUND or NOT_SUPPORTED.
  │   ├─ already in the requested state → return with filesModified: []
  │   ├─ remove direction: findReferencesAsNodes() on the declaration,
  │   │     union knownReferences, any file but this one → SYMBOL_IN_USE
  │   ├─ setIsExported(exported)
  │   ├─ scope.writeFile(file, sourceFile.getFullText())
  │   └─ invalidateProject(file)
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { status, filesModified, filesSkipped, symbolName }
```

## Technical decisions

**Why the remove direction must be guarded.**
The dispatcher's post-write type check only covers `filesModified`, and this operation writes exactly one file. An un-export that breaks ten importers would therefore report a clean type check — the breakage is invisible to the caller and to the response. The guard is what makes the operation safe to hand an agent; without it the remove direction would have to be dropped.

**Two layers of reference detection, matching moveSymbol.**
The language service covers everything in the ts-morph project graph. That graph is wider than the tsconfig `include` set, because `TsMorphEngine.addWorkspaceFiles` sweeps the whole workspace root — so a test file outside `include` is already visible without a second scan. What the language service cannot see is inside `.vue` SFC script blocks, so `VolarEngine` scans those separately and hands the result down. Both layers must agree on what counts as "in use", or the guarantee has a hole.

**Why the on-demand source-file load matters.**
`addWorkspaceFiles` walks via `walkFiles`, which delegates to `git ls-files` inside a repository. A gitignored source file is therefore absent from the project graph, and `getSourceFile` returns undefined for it — the `addSourceFileAtPath` fallback is what makes the operation work on such a file at all. This is not a defensive branch; it is the only path for gitignored sources.

**Enums are excluded deliberately.**
`resolveTarget` walks top-level statements and matches five forms. An enum name therefore reports `SYMBOL_NOT_FOUND` rather than being half-supported. This mirrors `findNonExportedDeclaration`, which `move-symbol` uses for the same set.

## Gotchas

**The SFC scan does not follow namespace imports.** `ImportRewriter.scriptReferencesSymbol` matches named imports and named re-exports — the same forms `rewriteScript` rewrites. A `.vue` script doing `import * as u from "./utils"` and calling `u.pad()` is not detected, so an un-export of `pad` will proceed and break that component. TypeScript importers are covered for namespace use because the language service resolves the property access. Closing this means teaching the scan to track namespace bindings through the script's identifiers.

**`filesSkipped` is always empty here.** It exists for parity with the other write operations. The single target is workspace-validated at the dispatch boundary, so there is no second path that could produce a skip.

**Reference order in `SYMBOL_IN_USE` is sorted, not discovery order.** The language service happens to return references in path order today, so the sort is not observable in tests — but discovery order is not a contract, and the message is deep-equal asserted by scenarios.
