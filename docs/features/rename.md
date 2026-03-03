# Feature: rename

**Purpose:** Scope-aware symbol rename across the project — updates imports, call sites, type annotations, and Vue SFCs without touching unrelated identifiers.

## What it does

Renames a symbol at a given file position and updates all references to it project-wide, including across `.ts` and `.vue` file boundaries. Unlike `replaceText`, which does textual find-and-replace with no understanding of scope or binding, `rename` uses the compiler's reference graph to change only the references that bind to the same symbol.

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
  "filesSkipped": []
}
```

`line` and `col` are 1-based, consistent with LSP convention. The symbol under the cursor at that position is renamed. If no renameable symbol is found, the operation returns `SYMBOL_NOT_FOUND`.

## Key concepts

- **Scope-aware via language service.** Uses TypeScript's `findRenameLocations` (not text search), so it only touches references that bind to the same symbol.
- **Vue virtual-path translation.** In Vue workspaces, Volar exposes `.vue` files as virtual `.vue.ts` files. Rename locations come back in virtual coordinates; the provider translates them back to real `.vue` positions via Volar's source-map.
- **Per-file boundary check.** Each edit is checked against the workspace boundary before writing. Out-of-workspace files land in `filesSkipped`, not written.
- **Post-write type errors.** Type errors in modified files are returned automatically (pass `checkTypeErrors: false` to suppress).

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

**Why language-service rename locations instead of `target.rename()` (ts-morph)?**
`target.rename()` is an AST mutation API that applies all edits atomically and saves every dirty file. It has no per-file whitelist, so workspace boundary enforcement would require reverting writes after the fact. Language-service rename locations return text spans — boundary-check each file, then write only the ones that pass.

**Why does the Vue engine need virtual `.vue.ts` translation?**
TypeScript's program builder ignores non-`.ts`/`.tsx` filenames. Volar works around this by exposing `.vue` files as `.vue.ts` virtual files in the host. `findRenameLocations` returns positions in the virtual coordinate space; `VolarProvider.translateLocations` maps them back to real `.vue` line/col using Volar's source-map. See `docs/tech/volar-v3.md` for details.
