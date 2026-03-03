# Feature: moveSymbol

**Purpose:** Move a named export from one file to another and update all importers project-wide — more precise than `moveFile` (whole file), safer than manual cut-paste + `replaceText` (no missed importers).

## What it does

Moves a named export from one file to another and updates all importers project-wide. In Vue workspaces, a post-step patches `.vue` SFC imports that aren't in the TypeScript project graph. The destination file is created if it does not already exist.

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

## Key concepts

- **AST surgery, not language-service refactor.** TypeScript has no "move symbol" refactoring in its public API. This operation uses ts-morph AST manipulation: locate the declaration, snapshot importers, splice the declaration text to the destination, rewrite import paths. The tradeoff is more manual bookkeeping but full control over what moves.
- **Vue importer post-step.** After TS files are updated, `afterSymbolMove()` runs a regex scan over `.vue` SFC files to patch import paths that ts-morph doesn't track. This catches `<script setup>` imports that are outside the TypeScript project graph.
- **Post-write type errors.** Type errors in modified files are returned automatically (pass `checkTypeErrors: false` to suppress).

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` source, `.ts` dest | Yes |
| `.ts` source, `.tsx` dest | Yes |
| `.tsx` source, `.ts` dest | Yes |
| Vue workspace, `.ts`/`.tsx` source | Yes (includes `.vue` importer rewrites via post-step) |
| `.vue` source | Pending |
| `.ts` → `.vue` dest | Not applicable — TypeScript module can't move into a Vue SFC |

## Constraints & limitations

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
The TypeScript language service has no "move symbol" refactoring in its public API (unlike rename and file-move, which are both first-class operations). ts-morph's AST manipulation API is the practical path. The tradeoff: direct AST access at the cost of more manual bookkeeping (finding the declaration, splicing text, updating imports explicitly).

**Why is `.vue` source still pending?**
The shipped path moves TS exports and then patches Vue importers. Moving declarations *from* `.vue` `<script>` / `<script setup>` blocks requires SFC-aware block parsing and splicing (e.g. via `@vue/compiler-sfc` parse output) before doing importer updates.
