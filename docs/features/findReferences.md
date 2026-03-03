# Feature: findReferences

**Purpose:** Discover every usage of a symbol — who calls this function, who reads this variable, who implements this interface — through the compiler's reference graph rather than text matching.

Read-only. Unlike `searchText`, which matches by name and can't distinguish scopes, `findReferences` is semantically precise: it only returns references that bind to the same symbol.

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

Response:

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

`line` and `col` are 1-based. The declaration site is included in the results. If no symbol is found at the given position, `references` is empty.

## How it works

`findReferences` is a thin wrapper around the compiler's reference API. The same virtual-path translation used by `rename` applies here for Vue files.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; selects TS or Vue provider
  ▼ findReferences() (src/operations/findReferences.ts)
  │   ├─ TsProvider path
  │   │     ls.getReferencesAtPosition(file, offset) → spans in TS/TSX files
  │   └─ VolarProvider path (Vue project)
  │         ls.getReferencesAtPosition(virtualFile, offset) → spans in virtual .vue.ts coords
  │         translateLocations() → real .vue line/col via Volar source-map
  ▼ result { ok, references[] }
```

Results reflect the in-memory project graph. The daemon watcher keeps it fresh, but there can be a short debounce window (~200ms) before out-of-band file changes are visible.

## Security

- **Input:** `file` is validated against the workspace root at the dispatcher. Invalid paths return `WORKSPACE_VIOLATION`.
- **Output:** references in files outside the workspace are returned as-is. No filtering is applied — read-only results carry no security risk, and filtering them would silently hide valid cross-package references.

See [security.md](../security.md) for the full threat model.

## Constraints

- "Find references by file path" (who imports this file?) is a separate capability not yet implemented. See `docs/handoff.md`.
- Results may include references in files outside the workspace if those files are in the project graph (via tsconfig `include`). This is intentional for read-only operations.
- `.js`/`.jsx` references are found only when those files are in the project graph (tsconfig `allowJs`).

## Technical decisions

**Why no workspace filtering on output?**
Mutating operations filter output writes to the workspace boundary because writing outside the workspace is the threat. `findReferences` only reads and returns data — there is no write risk. Filtering results would silently hide valid references in shared/sibling packages, which is worse than showing them.

**Why the same `file, line, col` interface as `rename`?**
Consistent with the LSP convention and with how agents invoke rename. An agent that locates a symbol for rename can reuse the same position for `findReferences` without translation.
