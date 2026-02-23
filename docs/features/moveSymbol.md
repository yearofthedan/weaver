# Operation: moveSymbol

## What it does

Moves a named export from one file to another and updates all importers project-wide.

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

**Response:**

```json
{
  "ok": true,
  "filesModified": ["src/utils.ts", "src/math/totals.ts", "src/App.vue"],
  "filesSkipped": [],
  "message": "Moved 'calculateTotal' from src/utils.ts to src/math/totals.ts, updated 3 files"
}
```

The declaration is removed from `sourceFile` and added to `destFile`. All files that imported `calculateTotal` from the old path are updated to import from the new path. If `destFile` does not exist, it is created.

## How it works

`TsEngine.moveSymbol` uses the ts-morph AST directly:

1. Locate the export declaration in `sourceFile` by name.
2. Extract its text (including leading JSDoc/comments).
3. Determine what imports the declaration itself needs and add them to `destFile`.
4. Remove the declaration from `sourceFile`; add a re-export or update the barrel if needed.
5. Write the new declaration into `destFile`.
6. Walk all files in the project that import `symbolName` from `sourceFile` and rewrite the import path to `destFile`.

This is pure AST surgery — it does not call the TypeScript language service's rename or move APIs.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` source, `.ts` dest | ✓ |
| `.ts` source, `.tsx` dest | ✓ |
| `.tsx` source, `.ts` dest | ✓ |
| Vue project, `.ts`→`.ts` files | — `NOT_SUPPORTED` (see below) |
| `.vue` source | — `NOT_SUPPORTED` |
| `.ts` → `.vue` dest | — not applicable; TypeScript module can't move into a Vue SFC |

## Constraints & limitations

**`NOT_SUPPORTED` in Vue projects**

The dispatcher routes all files in a Vue project (any project with `.vue` files) to `VueEngine`. `VueEngine.moveSymbol` throws `NOT_SUPPORTED` because Volar has no "extract declaration" API.

This is a router constraint, not a Volar limitation. `moveSymbol` is pure AST surgery and does not need Volar at all. The fix is either per-operation engine selection in the dispatcher, or a delegation path inside `VueEngine.moveSymbol` that falls through to `TsEngine`. Until that is implemented, `moveSymbol` returns `NOT_SUPPORTED` for any workspace that contains `.vue` files — even if both source and destination files are `.ts`.

Tracked in `docs/tech/tech-debt.md`.

**Other constraints**

- `symbolName` must be a valid JavaScript/TypeScript identifier (validated at MCP input).
- The symbol must be an exported declaration in `sourceFile`. Non-exported bindings, default exports (unnamed), and type-only exports are not supported.
- `destFile` must be within the workspace boundary.

## Security & workspace boundary

- `sourceFile` and `destFile` are validated at the dispatcher before the engine is called.
- File writes (modified source file, new destination file, updated importers) are each boundary-checked before being written. Out-of-workspace files are skipped and reported in `filesSkipped`.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why AST surgery instead of language service APIs?**
The TypeScript language service has no "move symbol" refactoring in its public API (unlike rename and file-move, which are both first-class operations). ts-morph's AST manipulation API is the practical path. The tradeoff: ts-morph gives direct AST access at the cost of more manual bookkeeping (finding the declaration, splicing text, updating imports explicitly).

**Why does Vue support require a separate path?**
For `.ts`→`.ts` moves in a Vue project, delegating to `TsEngine` then running `updateVueImportsAfterMove` would cover `.vue` importers. For `.vue` source files, `@vue/compiler-sfc`'s `parse()` can locate and splice the `<script>` block — `@vue/compiler-sfc` is already a transitive dep, no new dependency needed. Moving *into* a `.vue` destination is not worth supporting. See `docs/tech/volar-v3.md` § "Package ecosystem" for the `parse()` API.
