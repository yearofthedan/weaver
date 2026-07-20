# Internals: move-symbol

User-facing reference: [docs/commands/move-symbol.md](../commands/move-symbol.md).

## How it works

TypeScript has no "move symbol" refactoring in its public API. This operation uses ts-morph AST manipulation to locate the declaration, snapshot importers, splice the declaration text to the destination, and rewrite import paths.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates sourceFile and destFile against workspace boundary
  ▼ moveSymbol() (src/operations/moveSymbol.ts)
  │   ├─ find declaration
  │   │     srcSF.getExportedDeclarations().get(symbolName) → locate the AST node
  │   │     resolve to the containing statement (VariableDeclaration → VariableStatement)
  │   │     reject re-exports via export { } with NOT_SUPPORTED
  │   ├─ snapshot importers
  │   │     scan all project source files for ImportDeclarations whose
  │   │     getModuleSpecifierSourceFile() resolves to sourceFile and import symbolName
  │   ├─ AST surgery
  │   │     stmt.remove() — removes declaration from sourceFile
  │   │     dstSF.replaceWithText(...) — appends declaration text to destFile
  │   │     (destFile is created as an empty SourceFile if it doesn't exist on disk)
  │   ├─ rewrite importers
  │   │     for each importer: update specifier to point to destFile
  │   │     if importer already imports from destFile: merge named imports
  │   │     if import declaration only contained symbolName: redirect it; else remove specifier
  │   ├─ save dirty files within workspace boundary; add out-of-workspace to filesSkipped
  │   ├─ invalidateProject(sourceFile) — drop compiler cache
  │   └─ afterSymbolMove() — compiler post-step
  │         VolarCompiler: regex scan patches .vue SFC <script> imports
  │         TsMorphCompiler: workspace-wide fallback scan rewrites imports in
  │         files outside tsconfig.include (tests, scripts, config)
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { ok, filesModified, filesSkipped, typeErrors }
```

### .vue source branch

When `sourceFile` is a `.vue` file, `VolarEngine.moveSymbol` delegates to
`vueMoveSymbol` (`src/plugins/vue/move-symbol.ts`) instead of routing through
`TsMorphEngine`. The flow:

```
VolarEngine.moveSymbol (sourceFile ends with .vue)
  │
  ▼ @vue/language-core parse() to get <script setup> offsets and content
  │   no <script setup> → NOT_SUPPORTED
  ▼ throwaway ts-morph SourceFile from script content
  │   detect re-export via export { } from → NOT_SUPPORTED
  │   SymbolRef.fromExport() → declaration text + remove
  ▼ self-import check: hasRefsOutsideDeclaration on the throwaway SF
  │   if true, prepend `import { name } from "<rel>";` to the new script content
  ▼ splice modified script content back into the .vue source
  ▼ compose destination
  │   .ts dest → append declaration (creating the file if absent)
  │   .vue dest with existing <script setup> → append inside it
  │   .vue dest without <script setup> → insert new block before <template>
  │   .vue dest that doesn't exist → write a single <script setup> file
  ▼ importer rewrite
  │   walkFiles(searchRoot, [.ts, .tsx, .vue]) — filesystem scan, not project graph
  │   ImportRewriter.rewriteScript() per file (extracts script block first for .vue)
  ▼ done (returns to dispatcher for post-write type errors)
```

The `.vue` source path does NOT use the ts-morph project graph — `.vue` files
cannot resolve as module specifiers there. The filesystem walk picks up
`.ts` and `.vue` importers regardless of `tsconfig.include`.

Transitive imports used by the moved symbol (e.g. `import { ref } from "vue"`
inside `<script setup>`) are not carried to the destination — the throwaway
ts-morph project can't resolve modules, so type errors in the destination are
the signal to add them manually.

## Technical decisions

**Why AST surgery instead of language-service APIs?**
The TypeScript language service has no "move symbol" refactoring in its public API (unlike rename and file-move, which are both first-class operations). ts-morph's AST manipulation API is the practical path. The tradeoff: direct AST access at the cost of more manual bookkeeping (finding the declaration, splicing text, updating imports explicitly).

**Why snapshot importers before mutating the AST?**
Once `stmt.remove()` runs, ts-morph's in-memory project state changes. Re-querying importers after removal risks stale references or changed resolution. Snapshotting first guarantees the full importer list is captured against a clean project state.

**Why a post-step for Vue files?**
ts-morph's project graph is driven by `tsconfig.json`. Vue `<script setup>` blocks are compiled to virtual `.vue.ts` files by Volar; the underlying `.vue` files are not first-class nodes in the ts-morph project. The post-step (`afterSymbolMove`) runs a regex scan over `.vue` files to patch import paths that ts-morph doesn't track.

## Gotchas

- **The declaration is appended to the destination file.** If the destination already declares a symbol of the same name, `moveSymbol` produces a duplicate declaration — it does not detect the collision. A caller writing the destination ahead of time must read it back afterwards and drop the duplicate.
- **Importers outside the ts-morph project graph are still rewritten.** The `afterSymbolMove` fallback scan walks all workspace TS files, so test files and other importers outside `tsconfig` `include` have their imports updated without manual fixup — the same regex-scan mechanism as the `.vue` post-step above.
