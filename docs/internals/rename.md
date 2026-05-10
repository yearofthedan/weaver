# Internals: rename

User-facing reference: [docs/commands/rename.md](../commands/rename.md).

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

## Technical decisions

**Why language-service rename locations instead of `target.rename()` (ts-morph)?**
`target.rename()` is an AST mutation API that applies all edits atomically and saves every dirty file. It has no per-file whitelist, so workspace boundary enforcement would require reverting writes after the fact. Language-service rename locations return text spans — boundary-check each file, then write only the ones that pass.

**Why does the Vue engine need virtual `.vue.ts` translation?**
TypeScript's program builder ignores non-`.ts`/`.tsx` filenames. Volar works around this by exposing `.vue` files as `.vue.ts` virtual files in the host. `findRenameLocations` returns positions in the virtual coordinate space; `VolarCompiler.translateLocations` maps them back to real `.vue` line/col using Volar's source-map. See [volar-v3](../tech/volar-v3.md).

## Implementation notes

**`newName` regex must be enforced at the MCP layer too.**
`schema.ts` has the identifier regex but `mcp.ts` previously only had `z.string()`. MCP input validation and `schema.ts` must stay consistent — check both when changing validation rules.
