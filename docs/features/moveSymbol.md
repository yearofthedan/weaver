# Feature: moveSymbol

**Purpose:** Move a named export from one file to another and update all importers project-wide — more precise than `moveFile` (whole file), safer than manual cut-paste + `replaceText` (no missed importers).

**MCP tool call:**

```json
{
  "name": "moveSymbol",
  "arguments": {
    "sourceFile": "/path/to/project/src/utils.ts",
    "symbolName": "calculateTotal",
    "destFile": "/path/to/project/src/math/totals.ts"
  }
}
```

If the destination already exports a symbol with the same name, the operation returns a `SYMBOL_EXISTS` error. Pass `force: true` to replace the destination declaration with the source version:

```json
{
  "name": "moveSymbol",
  "arguments": {
    "sourceFile": "/path/to/project/src/utils.ts",
    "symbolName": "calculateTotal",
    "destFile": "/path/to/project/src/math/totals.ts",
    "force": true
  }
}
```

`filesModified` lists every file written (sourceFile, destFile, and all importers updated). See [mcp-transport.md](./mcp-transport.md) for the full response contract.

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

## Security

- `sourceFile` and `destFile` are validated at the dispatcher before the engine is called.
- File writes (modified sourceFile, new or updated destFile, updated importers) are each boundary-checked before being written. Out-of-workspace files are skipped and reported in `filesSkipped`.

See [security.md](../security.md) for the full threat model.

## Constraints

- `symbolName` must be a valid JavaScript/TypeScript identifier (validated at MCP input).
- The symbol must be a direct exported declaration in `sourceFile` (`export function`, `export const`, `export class`, etc.).
- Re-exports via `export { foo }` are rejected with `NOT_SUPPORTED`.
- Class methods are not supported — top-level exports only.
- `destFile` must be within the workspace boundary.
- If the destination file already has a declaration (exported or non-exported) with the same name as `symbolName`, the operation returns a `SYMBOL_EXISTS` error and makes no changes to any file. Pass `force: true` to replace the existing declaration with the source version ("source wins", like `mv -f`).
- Moving symbols *from* a `.vue` source file is not yet supported. The shipped path moves TS exports and then patches Vue importers; moving declarations from `<script setup>` blocks requires SFC-aware block parsing (e.g. via `@vue/compiler-sfc`).

## Technical decisions

**Why AST surgery instead of language-service APIs?**
The TypeScript language service has no "move symbol" refactoring in its public API (unlike rename and file-move, which are both first-class operations). ts-morph's AST manipulation API is the practical path. The tradeoff: direct AST access at the cost of more manual bookkeeping (finding the declaration, splicing text, updating imports explicitly).

**Why snapshot importers before mutating the AST?**
Once `stmt.remove()` runs, ts-morph's in-memory project state changes. Re-querying importers after removal risks stale references or changed resolution. Snapshotting first guarantees the full importer list is captured against a clean project state.

**Why a post-step for Vue files?**
ts-morph's project graph is driven by `tsconfig.json`. Vue `<script setup>` blocks are compiled to virtual `.vue.ts` files by Volar; the underlying `.vue` files are not first-class nodes in the ts-morph project. The post-step (`afterSymbolMove`) runs a regex scan over `.vue` files to patch import paths that ts-morph doesn't track.
