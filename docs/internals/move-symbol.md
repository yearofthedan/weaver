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

## Technical decisions

**Why AST surgery instead of language-service APIs?**
The TypeScript language service has no "move symbol" refactoring in its public API (unlike rename and file-move, which are both first-class operations). ts-morph's AST manipulation API is the practical path. The tradeoff: direct AST access at the cost of more manual bookkeeping (finding the declaration, splicing text, updating imports explicitly).

**Why snapshot importers before mutating the AST?**
Once `stmt.remove()` runs, ts-morph's in-memory project state changes. Re-querying importers after removal risks stale references or changed resolution. Snapshotting first guarantees the full importer list is captured against a clean project state.

**Why a post-step for Vue files?**
ts-morph's project graph is driven by `tsconfig.json`. Vue `<script setup>` blocks are compiled to virtual `.vue.ts` files by Volar; the underlying `.vue` files are not first-class nodes in the ts-morph project. The post-step (`afterSymbolMove`) runs a regex scan over `.vue` files to patch import paths that ts-morph doesn't track.
