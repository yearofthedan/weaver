# Operation: rename

## What it does

Renames a symbol at a given file position and updates all references to it project-wide, including across `.ts` and `.vue` file boundaries.

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

**Response:**

```json
{
  "ok": true,
  "filesModified": ["src/utils.ts", "src/App.vue", "src/components/Summary.ts"],
  "filesSkipped": [],
  "message": "Renamed 'computeSum' to 'calculateTotal' in 3 files"
}
```

`line` and `col` are 1-based, consistent with LSP convention. The symbol under the cursor at that position is renamed. If no renameable symbol is found, the operation returns `SYMBOL_NOT_FOUND`.

## How it works

1. The MCP layer validates the request (Zod schema; `newName` must match `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`).
2. The daemon dispatcher validates that `file` is within the workspace (`isWithinWorkspace`).
3. `BaseEngine.rename` calls `LanguageProvider.findRenameLocations(file, offset)`.
   - **TsProvider:** delegates to `ts.LanguageService.findRenameLocations`.
   - **VolarProvider:** delegates to the same method on the Volar-decorated language service, then translates virtual `.vue.ts` positions back to real `.vue` positions via source-map.
4. Each edit is applied via `applyTextEdits` (`src/engines/text-utils.ts`).
5. Each file is boundary-checked before writing. Out-of-workspace files are added to `filesSkipped` and not written.

The engine selection (TS vs Vue) is determined once per workspace by `isVueProject()` in the dispatcher.

## Supported file types

- `.ts`, `.tsx` as source or reference — full support
- `.vue` as source or reference — full support (Volar provides the project graph)
- `.js`, `.jsx` — supported when in the TypeScript project graph (via tsconfig `allowJs`)
- Cross-type: a rename in a `.ts` file will update references in `.vue` files and vice versa (Vue engine only; both must be in the same Volar project)

## Constraints & limitations

- The symbol must be at a renameable position. Built-in identifiers, string literals, and template expressions are not renameable.
- `newName` must be a valid JavaScript/TypeScript identifier (validated at MCP input; non-identifiers are rejected before reaching the engine).
- Rename does not detect naming collisions with existing symbols in scope.

## Security & workspace boundary

- Input: `file` is validated against the workspace root at the dispatcher before the engine is called. Invalid paths return `WORKSPACE_VIOLATION`.
- Output: the language service may compute rewrites for files that are in the project graph (via tsconfig `include`) but physically outside the workspace. These are skipped per-file and reported in `filesSkipped`.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why `ls.findRenameLocations` instead of `target.rename()` (ts-morph)?**
`target.rename()` is an AST mutation API that applies all edits atomically and saves every dirty file. It has no per-file whitelist, so workspace boundary enforcement would require reverting writes after the fact. `ls.findRenameLocations` returns text spans — boundary-check each file, then write only the ones that pass. This is the same pattern the Vue engine uses, enabling a shared `applyTextEdits` loop in `BaseEngine`.

**Why does the Vue engine need virtual `.vue.ts` translation?**
TypeScript's program builder ignores non-`.ts`/`.tsx` filenames. Volar works around this by exposing `.vue` files as `.vue.ts` virtual files in the host. `findRenameLocations` returns positions in the virtual coordinate space; `VolarProvider.translateLocations` maps them back to real `.vue` line/col using Volar's source-map. See `docs/tech/volar-v3.md` for details.
