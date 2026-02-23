# Operation: findReferences

## What it does

Returns all references to a symbol at a given file position. Read-only — does not modify any files.

**MCP tool call:**

```json
{
  "name": "findReferences",
  "arguments": {
    "file": "/path/to/project/src/utils.ts",
    "line": 5,
    "col": 10
  }
}
```

**Response:**

```json
{
  "ok": true,
  "references": [
    { "file": "/path/to/project/src/utils.ts", "line": 5, "col": 10 },
    { "file": "/path/to/project/src/App.vue", "line": 12, "col": 3 },
    { "file": "/path/to/project/src/components/Summary.ts", "line": 8, "col": 15 }
  ],
  "message": "Found 3 references"
}
```

`line` and `col` are 1-based. The declaration site itself is included in the results. If no symbol is found at the given position, `references` is empty.

## How it works

1. The MCP layer validates the request (Zod schema).
2. The dispatcher validates that `file` is within the workspace.
3. `BaseEngine.findReferences` calls `LanguageProvider.getReferencesAtPosition(file, offset)`.
   - **TsProvider:** delegates to `ts.LanguageService.getReferencesAtPosition`.
   - **VolarProvider:** delegates to the same method on the Volar-decorated language service, then translates virtual `.vue.ts` positions back to real `.vue` positions via source-map.
4. Results are returned as an array of `{ file, line, col }` objects.

Note: unlike mutating operations, `findReferences` does not take a `workspace` parameter at the engine interface level. The engine returns all references including those outside the workspace. Input validation (the `file` parameter) still happens at the dispatcher.

## Supported file types

- `.ts`, `.tsx` as source — full support
- `.vue` as source — full support (Volar handles `.vue` → virtual `.vue.ts` translation)
- References in `.vue` files are found regardless of the source file type
- `.js`, `.jsx` — supported when in the TypeScript project graph (via `allowJs`)

## Constraints & limitations

- Results reflect the in-memory project graph at the time of the call. If files were edited outside light-bridge after the daemon started, results may be stale (no filesystem watcher yet — see `docs/handoff.md`).
- "Find references by file path" (who imports this file?) is a separate capability not yet implemented. See `docs/handoff.md` for design notes.
- Results may include references in files outside the workspace if those files are in the project graph (via tsconfig `include`). This is intentional — `findReferences` is read-only and cross-boundary reads are not a security concern in the same way writes are.

## Security & workspace boundary

- Input: `file` is validated against the workspace root at the dispatcher. Invalid paths return `WORKSPACE_VIOLATION`.
- Output: references in files outside the workspace are returned as-is. No filtering is applied to read-only results.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why no workspace filtering on output?**
Mutating operations filter output writes to the workspace boundary because writing outside the workspace is the threat. `findReferences` only reads and returns data — there is no write risk. Filtering results would silently hide valid references in shared/sibling packages, which is worse than showing them.

**Why the same `file, line, col` interface as `rename`?**
Consistent with the LSP convention and with how agents invoke rename. An agent that locates a symbol for rename can reuse the same position for `findReferences` without translation.
