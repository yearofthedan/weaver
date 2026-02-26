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

`moveSymbol` uses ts-morph AST edits plus a provider post-step:

1. Locate the export declaration in `sourceFile` by name.
2. Snapshot all importers of that symbol from `sourceFile`.
3. Remove the declaration from `sourceFile`.
4. Create/load `destFile`, append the declaration text.
5. Rewrite importer declarations to reference `destFile`.
6. Save dirty TS files within workspace and return out-of-workspace importers in `filesSkipped`.
7. Run `projectProvider.afterSymbolMove(...)` to patch non-TS importers (notably `.vue` SFC imports in Vue workspaces).

This operation is AST surgery; it does not use TypeScript language-service rename/move APIs.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` source, `.ts` dest | ✓ |
| `.ts` source, `.tsx` dest | ✓ |
| `.tsx` source, `.ts` dest | ✓ |
| Vue workspace, `.ts`/`.tsx` source | ✓ (includes `.vue` importer rewrites via post-step) |
| `.vue` source | — pending |
| `.ts` → `.vue` dest | — not applicable; TypeScript module can't move into a Vue SFC |

## Constraints & limitations

**Current constraints**

- `symbolName` must be a valid JavaScript/TypeScript identifier (validated at MCP input).
- The symbol must be a direct exported declaration in `sourceFile` (`export function`, `export const`, `export class`, etc.).
- Re-exports via `export { foo }` are rejected with `NOT_SUPPORTED`.
- Class methods are not supported (top-level exports only).
- `.vue` source extraction is not implemented yet.
- `destFile` must be within the workspace boundary.

## Security & workspace boundary

- `sourceFile` and `destFile` are validated at the dispatcher before the engine is called.
- File writes (modified source file, new destination file, updated importers) are each boundary-checked before being written. Out-of-workspace files are skipped and reported in `filesSkipped`.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why AST surgery instead of language service APIs?**
The TypeScript language service has no "move symbol" refactoring in its public API (unlike rename and file-move, which are both first-class operations). ts-morph's AST manipulation API is the practical path. The tradeoff: ts-morph gives direct AST access at the cost of more manual bookkeeping (finding the declaration, splicing text, updating imports explicitly).

**Why is `.vue` source still pending?**
The shipped path moves TS exports and then patches Vue importers. Moving declarations *from* `.vue` `<script>` / `<script setup>` blocks requires SFC-aware block parsing and splicing (e.g. via `@vue/compiler-sfc` parse output) before doing importer updates.
