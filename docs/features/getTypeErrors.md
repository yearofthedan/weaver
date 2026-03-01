**Purpose:** Specification for the `getTypeErrors` MCP tool.
**Audience:** Engineers implementing or extending the tool.
**Status:** Shipped (standalone tool, TS/TSX only)
**Related docs:** [Architecture](../architecture.md), [MCP transport](mcp-transport.md)

---

# `getTypeErrors`

Check a TypeScript file or whole project for type errors using the ts-morph compiler API.

## Overview

Returns TypeScript semantic errors for a single file or all project files. Warnings and suggestions are excluded — only errors (TypeScript `DiagnosticCategory.Error`) are reported.

Vue SFC (`.vue`) diagnostics are not yet supported — see handoff.md P4 item 16.

## MCP tool signature

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | `string` | no | Absolute path to a `.ts`/`.tsx` file. If omitted, checks the whole project. |

**Output:**

```json
{
  "ok": true,
  "diagnostics": [
    {
      "file": "/abs/path/to/file.ts",
      "line": 10,
      "col": 5,
      "code": 2322,
      "message": "Type 'string' is not assignable to type 'number'."
    }
  ],
  "errorCount": 3,
  "truncated": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `diagnostics` | `TypeDiagnostic[]` | Errors found, capped at 100. |
| `errorCount` | `number` | Total errors found (may exceed `diagnostics.length` when `truncated` is true). |
| `truncated` | `boolean` | True when results were capped; narrow the scope by providing `file`. |

**`TypeDiagnostic` fields:**

| Field | Type | Constraints | Example |
|-------|------|-------------|---------|
| `file` | `string` | Absolute path; empty string if the diagnostic has no associated file. | `"/project/src/auth.ts"` |
| `line` | `number` | 1-based. | `10` |
| `col` | `number` | 1-based. | `5` |
| `code` | `number` | TypeScript error number. | `2322` |
| `message` | `string` | Top-level `DiagnosticMessageChain` node only — **not** `flattenDiagnosticMessageText`. For simple mismatches this is a short, self-contained sentence. For deeply nested generic mismatches the chain can be 4–5 levels; returning the full chain would produce hundreds of characters of concatenated context. The top node is always the most specific description of *what* is wrong (e.g. `"Type '(x: number) => string' is not assignable to type '(x: string) => number'."`). Nested "why" context (`"Types of parameters 'x' and 'x' are incompatible."`) is omitted. | `"Type 'string' is not assignable to type 'number'."` |

## Behaviour

- **Single-file mode** (`file` provided): checks only that file. Throws `FILE_NOT_FOUND` if the file doesn't exist; throws `WORKSPACE_VIOLATION` if it's outside the workspace.
- **Project-wide mode** (`file` omitted): iterates all source files in the tsconfig project rooted at the workspace. Results are ordered by file iteration order (tsconfig-driven).
- **Cap**: at most 100 diagnostics are returned. `errorCount` always reflects the true total.
- **Errors only**: `DiagnosticCategory.Warning`, `Suggestion`, and `Message` are excluded.
- **No stale AST**: the project is loaded fresh from disk on first access; subsequent calls reuse the daemon's cached project.

## Implementation notes

- `src/operations/getTypeErrors.ts` — core logic; uses `TsProvider` directly (not `LanguageProvider`) because Vue diagnostics are out of scope.
- `src/providers/ts.ts` — `getProjectForFile(absPath)` for single-file mode; `getProjectForDirectory(workspace)` for project-wide mode.
- `src/daemon/dispatcher.ts` — `getTypeErrors` entry in `OPERATIONS`; `pathParams: []` (workspace boundary enforced inside the operation).
- `src/schema.ts` — `GetTypeErrorsArgsSchema` (optional `file` string).
- `src/types.ts` — `TypeDiagnostic` and `GetTypeErrorsResult` interfaces.
