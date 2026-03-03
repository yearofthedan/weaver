# Feature: findReferences

**Purpose:** Discover every usage of a symbol — who calls this function, who reads this variable, who implements this interface — through the compiler's reference graph rather than text matching.

## What it does

Returns all references to a symbol at a given file position. Read-only — does not modify any files. Unlike `searchText`, which matches by name and can't distinguish scopes, `findReferences` is semantically precise: it only returns references that bind to the same symbol.

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

## Key concepts

- **Scope-aware via language service.** Uses TypeScript's `getReferencesAtPosition`, so results are semantically correct — not string matches.
- **Vue virtual-path translation.** Same mechanism as `rename`: Volar returns references in virtual `.vue.ts` coordinates, the provider translates them back to real `.vue` positions.
- **No workspace filtering on output.** Unlike mutating operations, references outside the workspace are returned as-is. Read-only results carry no security risk, and filtering them would silently hide valid cross-package references.
- **Debounce window.** Results reflect the in-memory project graph. The daemon watcher keeps it fresh, but there can be a short debounce window (~200ms) before out-of-band file changes are visible.

## Supported file types

- `.ts`, `.tsx` as source — full support
- `.vue` as source — full support (Volar handles `.vue` → virtual `.vue.ts` translation)
- References in `.vue` files are found regardless of the source file type
- `.js`, `.jsx` — supported when in the TypeScript project graph (via `allowJs`)

## Constraints & limitations

- "Find references by file path" (who imports this file?) is a separate capability not yet implemented. See `docs/handoff.md`.
- Results may include references in files outside the workspace if those files are in the project graph (via tsconfig `include`). This is intentional for read-only operations.

## Security & workspace boundary

- Input: `file` is validated against the workspace root at the dispatcher. Invalid paths return `WORKSPACE_VIOLATION`.
- Output: references in files outside the workspace are returned as-is. No filtering is applied to read-only results.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why no workspace filtering on output?**
Mutating operations filter output writes to the workspace boundary because writing outside the workspace is the threat. `findReferences` only reads and returns data — there is no write risk. Filtering results would silently hide valid references in shared/sibling packages, which is worse than showing them.

**Why the same `file, line, col` interface as `rename`?**
Consistent with the LSP convention and with how agents invoke rename. An agent that locates a symbol for rename can reuse the same position for `findReferences` without translation.
