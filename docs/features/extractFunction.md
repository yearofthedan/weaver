# Feature: extractFunction

**Purpose:** Pull a block of statements out of a function body into a new named function — the compiler infers parameters, return values, type annotations, and async propagation.

## What it does

Extracts a block of statements from within a function and places them into a new named function at module scope. Same as the "Extract Function" refactoring IDEs offer, exposed as an MCP tool call.

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

## Key concepts

- **Selection must cover complete statements.** The compiler silently returns no applicable refactors when the selection ends mid-statement. In semicolon-using code, `endCol` must point at the `;`. In no-semi code, `endCol` must point at the last token (e.g. closing `)` of a call).
- **Always extracts to module scope.** The TS language service offers multiple extraction targets (innermost scope through module scope). This operation always picks the outermost `function_scope` — it produces a standalone, testable function rather than a nested closure.
- **Name replacement via rename location.** The TS `getEditsForRefactor` API doesn't accept a custom name — it generates one (e.g. `newFunction`). The implementation applies the edits, reads the generated name from `renameLocation`, and replaces it with the caller-provided `functionName`.
- **Parameter count from fresh AST.** `parameterCount` is read from a fresh parse of the written file, not inferred from the edit text — the compiler's parameter inference is the source of truth.
- **Post-write type errors.** Type errors in the modified file are returned automatically (pass `checkTypeErrors: false` to suppress).

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
