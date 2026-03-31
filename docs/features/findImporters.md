# Feature: findImporters

**Purpose:** Discover every file that imports a given file — "who imports this file?" — using the compiler's project graph rather than text matching.

Read-only. Unlike `searchText` with an import-path pattern, `findImporters` sees through path aliases, barrel re-exports, extensionless imports, and Vue SFCs. Provide just a file path; no line/col needed.

**MCP tool call:**

```json
{
  "name": "findImporters",
  "arguments": {
    "file": "/path/to/project/src/utils.ts"
  }
}
```

Response:

```json
{
  "status": "success",
  "fileName": "utils.ts",
  "references": [
    { "file": "/path/to/project/src/main.ts", "line": 1, "col": 10, "length": 9 },
    { "file": "/path/to/project/src/App.vue", "line": 2, "col": 9, "length": 9 }
  ]
}
```

`line` and `col` are 1-based, pointing at the start of the import specifier string (the `"./utils"` part). `references` is empty when nothing imports the file — this is not an error.

**CLI:**

```bash
weaver find-importers '{"file": "/path/to/project/src/utils.ts"}'
```

## How it works

`findImporters` wraps the TypeScript language service's `getFileReferences(fileName)` API, which returns all import/re-export statements that reference the file. For Vue projects, the Volar engine queries the virtual `.vue.ts` path and translates results back to real `.vue` file coordinates.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; selects TS or Vue engine
  ▼ findImporters() (src/operations/findImporters.ts)
  │   ├─ TsMorphEngine path
  │   │     ls.getFileReferences(file) → spans in TS/TSX files
  │   └─ VolarEngine path (Vue project)
  │         baseService.getFileReferences(file or file.ts) → spans including virtual .vue.ts refs
  │         translateLocations() → real .vue line/col via Volar source-map
  ▼ result { status, fileName, references[] }
```

## Security

- **Input:** `file` is validated against the workspace root at the dispatcher. Invalid paths return `WORKSPACE_VIOLATION`.
- **Output:** references in files outside the workspace are returned as-is. Read-only — no write risk.

See [security.md](../security.md) for the full threat model.

## Constraints

- Returns import specifier positions, not symbol positions. Each reference points at the string literal `"./utils"` in the import statement.
- If the file exists on disk but is not in the TypeScript project graph (e.g. a `.json` or `.css` file), `getFileReferences` returns empty results. This is correct — the TS compiler only tracks TS/JS imports.
- Results may include references from files outside the workspace (e.g. node_modules if in the project graph). This is consistent with `findReferences` behavior.

## Technical decisions

**Why a separate tool instead of overloading `findReferences`?**
A new `findImporters` tool with just `{ file }` is self-describing. Overloading `findReferences` with optional `line`/`col` creates a hidden mode — the name suggests symbol-level work and "omit line and col" is easy to miss. The cost of a dedicated tool is ~2 lines of tool description.

**Why `baseService.getFileReferences` in VolarEngine instead of the proxy?**
Volar's proxy language service (`createProxyLanguageService`) does not expose `getFileReferences`. The base TypeScript language service (pre-proxy) does. `CachedService` now exposes `baseService` for callers that need APIs not forwarded by the Volar proxy.
