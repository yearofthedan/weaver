# Feature: rename

**Purpose:** Scope-aware symbol rename across the project — updates imports, call sites, type annotations, and Vue SFCs without touching unrelated identifiers.

Unlike `replaceText`, which does textual find-and-replace with no understanding of scope or binding, `rename` uses the compiler's reference graph to change only the references that bind to the same symbol.

**MCP tool call:**

```json
{
  "name": "rename",
  "arguments": {
    "file": "/path/to/project/src/utils.ts",
    "line": 5,
    "col": 10,
    "newName": "calculateTotal"
  }
}
```

`line` and `col` are 1-based, consistent with LSP convention. `filesModified` lists every file rewritten; `filesSkipped` lists files the language service targeted that fell outside the workspace boundary. See [mcp-transport.md](./mcp-transport.md) for the full response contract.

## How it works

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; selects TS or Vue compiler
  ▼ rename() (src/operations/rename.ts)
  │   ├─ TsMorphCompiler path
  │   │     ls.findRenameLocations(file, offset) → spans in TS/TSX files
  │   │     boundary-check each target file → write passing files
  │   └─ VolarCompiler path (Vue project)
  │         ls.findRenameLocations(virtualFile, offset) → spans in virtual .vue.ts coords
  │         translateLocations() → real .vue line/col via Volar source-map
  │         boundary-check each target file → write passing files
  ▼ result { ok, filesModified, filesSkipped }
```

The symbol under the cursor at (line, col) is renamed. If no renameable symbol is found at that position, the operation returns `SYMBOL_NOT_FOUND`.

## Security

- **Input:** `file` is validated against the workspace root at the dispatcher before the engine is called. Invalid paths return `WORKSPACE_VIOLATION`.
- **Output:** the language service may compute rewrites for files that are in the project graph but physically outside the workspace (via tsconfig `include`). These are skipped per-file and reported in `filesSkipped`.

See [security.md](../security.md) for the full threat model.

## Response

For TypeScript renames, the response includes a `nameMatches` field:

```json
{
  "nameMatches": [
    { "file": "/abs/path/src/foo.ts", "line": 12, "col": 5, "name": "tsProviderSingleton", "kind": "VariableDeclaration" }
  ]
}
```

`nameMatches` is a flat array — the complete list of identifiers in the modified files whose text contains the old symbol name as a substring, in file-then-position order. The scope is already narrow (only `filesModified`), so the list is exhaustive, not sampled.

- **`name`:** identifier text (e.g. `tsProviderSingleton`)
- **`file`/`line`/`col`:** location (1-based)
- **`kind`:** the ts-morph `SyntaxKind` name of the identifier's parent node (e.g. `VariableDeclaration`, `Parameter`, `FunctionDeclaration`)

When no derived names are found, `nameMatches` is `[]`.

## Constraints

- The symbol must be at a renameable position. Built-in identifiers, string literals, and template expressions are not renameable.
- `newName` must be a valid JavaScript/TypeScript identifier (validated at MCP input; non-identifiers are rejected before reaching the engine).
- Rename does not detect naming collisions with existing symbols in scope.
- `.js`/`.jsx` files are updated only when they are part of the project graph (tsconfig `allowJs`).
- Cross-type reference tracking (a rename in a `.ts` file updating `.vue` references) requires the Vue engine — both files must be in the same Volar project.
- `nameMatches` is present only for TypeScript renames. Vue renames (via `VolarEngine`) do not include `nameMatches` in v1.

## Technical decisions

**Why language-service rename locations instead of `target.rename()` (ts-morph)?**
`target.rename()` is an AST mutation API that applies all edits atomically and saves every dirty file. It has no per-file whitelist, so workspace boundary enforcement would require reverting writes after the fact. Language-service rename locations return text spans — boundary-check each file, then write only the ones that pass.

**Why does the Vue engine need virtual `.vue.ts` translation?**
TypeScript's program builder ignores non-`.ts`/`.tsx` filenames. Volar works around this by exposing `.vue` files as `.vue.ts` virtual files in the host. `findRenameLocations` returns positions in the virtual coordinate space; `VolarCompiler.translateLocations` maps them back to real `.vue` line/col using Volar's source-map. See [volar-v3.md](../tech/volar-v3.md) for details.

## Implementation notes

**`newName` regex must be enforced at the MCP layer too.**
`schema.ts` had the identifier regex but `mcp.ts` previously only had `z.string()`. MCP input validation and schema.ts must stay consistent — check both when changing validation rules.
