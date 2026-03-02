# Operation: extractFunction

## What it does

Extracts a block of statements from within a function and places them into a new named function at module scope. The compiler infers parameters, return values, type annotations, and async propagation automatically.

**MCP tool call:**

```json
{
  "name": "extractFunction",
  "arguments": {
    "file": "/path/to/project/src/handler.ts",
    "startLine": 12,
    "startCol": 3,
    "endLine": 18,
    "endCol": 42,
    "functionName": "buildResponse"
  }
}
```

**Response:**

```json
{
  "ok": true,
  "filesModified": ["src/handler.ts"],
  "filesSkipped": [],
  "functionName": "buildResponse",
  "parameterCount": 2,
  "typeErrors": [],
  "typeErrorCount": 0,
  "typeErrorsTruncated": false
}
```

`startLine`, `startCol`, `endLine`, `endCol` are all 1-based. `endCol` is inclusive — it must point at the last character of the last statement in the selection.

The extracted function is placed at module scope and is **not exported**. Use `moveSymbol` to relocate it to another file if needed.

## Selection rules

The selection must cover **complete statements**. The compiler silently returns no applicable refactors when the selection ends mid-statement.

- In semicolon-using code: `endCol` must point at the `;`, not the `)` before it.
- In no-semi code: `endCol` must point at the last token of the statement (e.g. the closing `)` of a call expression).
- For single-statement selections the compiler is more lenient, but following the same rule avoids surprises.

## How it works

1. The MCP layer validates the request (Zod schema; `functionName` must be a valid identifier).
2. The daemon dispatcher validates that `file` is within the workspace.
3. `operations/extractFunction.ts` converts line/col to byte offsets, then calls TypeScript's `getApplicableRefactors` on the selection range.
4. The "Extract Symbol" refactor is selected, targeting the outermost applicable function scope (`function_scope_N`) to place the new function at module level.
5. `getEditsForRefactor` produces text edits including the new function definition and a call-site replacement.
6. The auto-generated function name (from `renameLocation`) is replaced with the caller-provided `functionName` throughout all edits.
7. Edits are applied to disk; each file is boundary-checked before writing.
8. The project is invalidated and the new function's parameter count is read from the fresh AST.

## Supported file types

| Scenario | Supported |
|----------|-----------|
| `.ts` source | Yes |
| `.tsx` source | Yes |
| `.vue` source | No — returns `NOT_SUPPORTED` |

## Constraints & limitations

- The selection must be inside a function body. Module-level statements cannot be extracted.
- The extracted function is always placed at module scope (the outermost `function_scope`).
- The extracted function is not exported. Use `moveSymbol` to relocate it afterwards.
- `.vue` files are not supported — extract from the corresponding `.ts`/`.tsx` file.
- `functionName` must be a valid JS/TS identifier (validated at MCP input).
- The operation does not detect naming collisions with existing symbols in scope.

## Security & workspace boundary

- `file` is validated against the workspace root at the dispatcher before the engine is called.
- Each file edit is boundary-checked before writing to disk. Out-of-workspace files are skipped and reported in `filesSkipped`.

See `docs/security.md` for the full threat model.

## Technical decisions

**Why the outermost function scope?**
The TS language service offers multiple extraction targets (innermost scope through module scope). Extracting to module scope is the most useful default for an AI agent — it produces a standalone, testable function. Extracting to a nested scope rarely provides value since the goal is usually to reduce function length.

**Why replace the generated name instead of passing it to the refactor API?**
The TS language service's `getEditsForRefactor` does not accept a custom name — it auto-generates one (e.g. `newFunction`). The implementation applies the edits, reads back the generated name from `renameLocation`, and does a string replacement. This is the same approach an IDE uses, followed by a rename.

**Why count parameters after the fact?**
`parameterCount` is read from a fresh AST parse of the written file rather than inferred from the edit text. This is more reliable because the compiler's parameter inference is the source of truth.
