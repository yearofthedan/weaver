# Operation: getDefinition

## What it does

Returns the definition location(s) for a symbol at a given file position. Read-only — does not modify any files.

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

## How it works

1. The MCP layer validates the request (Zod schema).
2. The dispatcher validates that `file` is within the workspace.
3. `operations/getDefinition.ts` calls `LanguageProvider.getDefinitionAtPosition(file, offset)`.
   - **TsProvider:** delegates to `ts.LanguageService.getDefinitionAtPosition`.
   - **VolarProvider:** requires an extra step — `getDefinitionAtPosition` in Volar's proxy calls TypeScript's internal implementation directly and does NOT auto-translate `.vue` paths to their virtual `.vue.ts` equivalents (unlike `findRenameLocations` and `getReferencesAtPosition`, which do). Calling with a real `.vue` path throws `Could not find source file`. Fix: call `toVirtualLocation(absPath, pos)` first to map the path and offset into the virtual coordinate space, then call `getDefinitionAtPosition` with the translated values. Results still go through `translateLocations` for the `.vue.ts` → `.vue` reverse mapping.
4. Results are returned as an array of `{ file, line, col }` objects.

## Supported file types

- `.ts`, `.tsx` as source — full support
- `.vue` as source — full support, with the extra virtual-path translation step described above
- `.js`, `.jsx` — supported when in the TypeScript project graph (via `allowJs`)
- Definitions in any file type are returned, regardless of source file type

## Constraints & limitations

- Results reflect the in-memory project graph at the time of the call. The daemon watcher keeps it fresh for out-of-band edits, but there can be a short debounce window before changes are visible.
- Definitions in declaration files (`.d.ts`) are returned as-is; the definition points to the type declaration, not the JavaScript runtime value.
- If the symbol resolves to a built-in TypeScript type or a type in `node_modules`, the result file path will point into `node_modules`. This is correct behaviour.

## Security & workspace boundary

- Input: `file` is validated against the workspace root at the dispatcher. Invalid paths return `WORKSPACE_VIOLATION`.
- Output: definition locations may point to files outside the workspace (e.g. `node_modules`, sibling packages). No filtering is applied to read-only results.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why does VolarProvider need explicit `.vue` → `.vue.ts` translation for `getDefinition` but not for `rename` or `findReferences`?**

`findRenameLocations` and `getReferencesAtPosition` are wrapped at the Volar proxy layer and auto-translate real `.vue` paths to their virtual `.vue.ts` equivalents before calling TypeScript's internal implementation. `getDefinitionAtPosition` is not wrapped the same way — it calls TypeScript directly, which throws when it cannot find the source file by the `.vue` name. The fix (`toVirtualLocation` before the call) is applied in `VolarProvider.getDefinitionAtPosition`. Any future read-only operation that hits `Could not find source file: *.vue` needs the same treatment. See `docs/agent-memory.md` for the gotcha note.

**Why return all definitions including those in `node_modules`?**
Filtering to workspace-only definitions would silently hide the actual definition of a symbol imported from a library — which is exactly what an agent might want to inspect. The read-only nature of the operation means cross-boundary results carry no security risk.
