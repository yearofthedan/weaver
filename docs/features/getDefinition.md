# Feature: getDefinition

**Purpose:** Jump from a usage to its declaration — resolves through re-exports, barrel files, and declaration files to the actual definition site.

## What it does

Returns the definition location(s) for a symbol at a given file position. Read-only — does not modify any files. Same as "go to definition" in an IDE: answers "where is this function defined?" and "which file declares this type?" without text-searching by name.

**MCP tool call:**

```json
{
  "name": "getDefinition",
  "arguments": {
    "file": "/path/to/project/src/App.vue",
    "line": 12,
    "col": 8
  }
}
```

**Response:**

```json
{
  "ok": true,
  "definitions": [
    { "file": "/path/to/project/src/utils.ts", "line": 5, "col": 10 }
  ],
  "message": "Found 1 definition"
}
```

`line` and `col` are 1-based. If no symbol is found at the given position, `definitions` is empty. Most symbols resolve to a single definition; overloaded functions may return multiple.

## Key concepts

- **Scope-aware via language service.** Uses TypeScript's `getDefinitionAtPosition` — results are semantically correct.
- **Vue requires explicit virtual-path pre-translation.** Unlike `rename` and `findReferences`, Volar's proxy does *not* auto-translate `.vue` paths for `getDefinitionAtPosition`. The provider calls `toVirtualLocation()` first to map the real `.vue` path and offset into virtual coordinates, then calls the language service. Results still go through `translateLocations` for the reverse mapping. Any future read-only operation that hits `Could not find source file: *.vue` likely needs the same treatment.
- **Cross-boundary results included.** Definitions may point into `node_modules` or sibling packages — this is correct for a read-only operation.

## Supported file types

- `.ts`, `.tsx` as source — full support
- `.vue` as source — full support, with the extra virtual-path translation step
- `.js`, `.jsx` — supported when in the TypeScript project graph (via `allowJs`)
- Definitions in any file type are returned, regardless of source file type

## Constraints & limitations

- Definitions in declaration files (`.d.ts`) point to the type declaration, not the JavaScript runtime value.
- If the symbol resolves to a built-in TypeScript type or a type in `node_modules`, the result file path will point into `node_modules`. This is correct behaviour.
- Results reflect the in-memory project graph; daemon watcher debounce (~200ms) applies.

## Security & workspace boundary

- Input: `file` is validated against the workspace root at the dispatcher. Invalid paths return `WORKSPACE_VIOLATION`.
- Output: definition locations may point to files outside the workspace (e.g. `node_modules`, sibling packages). No filtering is applied to read-only results.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why does VolarProvider need explicit `.vue` → `.vue.ts` translation for `getDefinition` but not for `rename` or `findReferences`?**
`findRenameLocations` and `getReferencesAtPosition` are wrapped at the Volar proxy layer and auto-translate real `.vue` paths to their virtual `.vue.ts` equivalents before calling TypeScript's internal implementation. `getDefinitionAtPosition` is not wrapped the same way — it calls TypeScript directly, which throws when it cannot find the source file by the `.vue` name. The fix (`toVirtualLocation` before the call) is applied in `VolarProvider.getDefinitionAtPosition`.

**Why return all definitions including those in `node_modules`?**
Filtering to workspace-only definitions would silently hide the actual definition of a symbol imported from a library — which is exactly what an agent might want to inspect. The read-only nature of the operation means cross-boundary results carry no security risk.
