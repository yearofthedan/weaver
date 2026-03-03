# Feature: extractFunction

**Purpose:** Pull a block of statements out of a function body into a new named function — the compiler infers parameters, return values, type annotations, and async propagation.

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

`startLine`, `startCol`, `endLine`, `endCol` are all 1-based. `endCol` is inclusive — it must point at the last character of the last statement in the selection. The response includes tool-specific fields beyond the standard contract:

```json
{
  "ok": true,
  "filesModified": ["src/handler.ts"],
  "functionName": "buildResponse",
  "parameterCount": 2,
  "typeErrors": [],
  "typeErrorCount": 0,
  "typeErrorsTruncated": false
}
```

See [mcp-transport.md](./mcp-transport.md) for the full response contract.

## How it works

The TS language service's "Extract Symbol" refactor does the heavy lifting — it infers parameters, return type, and async propagation. The implementation delegates to it, then substitutes the auto-generated name with the caller-supplied one.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; rejects .vue with NOT_SUPPORTED
  ▼ extractFunction() (src/operations/extractFunction.ts)
  │   ├─ lineColToOffset() — convert 1-based startLine/Col and endLine/Col to byte offsets
  │   │     range.end = endOffset + 1 (TS uses exclusive end)
  │   ├─ ls.getApplicableRefactors(file, range) — confirm "Extract Symbol" is available
  │   │     if absent: selection does not cover complete statements → NOT_SUPPORTED
  │   ├─ select outermost function_scope_N action
  │   │     function_scope_0 = innermost, function_scope_N = module scope (outermost)
  │   │     always picks highest N (produces standalone, testable function)
  │   ├─ ls.getEditsForRefactor('Extract Symbol', function_scope_N)
  │   │     language service generates edits with an auto-generated name (e.g. "newFunction")
  │   │     infers parameters, return type, async/await propagation
  │   ├─ extract generated name from renameLocation
  │   │     apply edits to in-memory content → slice identifier starting at renameLocation
  │   ├─ replace generated name → functionName throughout all edits (string replaceAll)
  │   ├─ write edits to disk (boundary-checked per file)
  │   ├─ invalidateProject(file) — drop cached project to force fresh parse
  │   └─ countParameters() — re-read file via fresh AST; getFunction(functionName).getParameters()
  ▼ dispatcher appends type errors for filesModified (unless checkTypeErrors: false)
  ▼ result { ok, filesModified, functionName, parameterCount, typeErrors }
```

The extracted function is placed at module scope and is **not exported**. Use `moveSymbol` to relocate it to another file if needed.

## Security

- `file` is validated against the workspace root at the dispatcher before the engine is called.
- Each file edit is boundary-checked before writing to disk. Out-of-workspace files are skipped and reported in `filesSkipped`.

See [security.md](../security.md) for the full threat model.

## Constraints

- The selection must be inside a function body — module-level statements cannot be extracted.
- The selection must cover complete statements. The compiler silently returns no applicable refactors when the selection ends mid-statement. In semicolon-using code, `endCol` must point at the `;`. In no-semi code, `endCol` must point at the last token (e.g. the closing `)` of a call).
- The extracted function is always placed at module scope (outermost `function_scope`).
- The extracted function is not exported.
- `.vue` files are not supported — returns `NOT_SUPPORTED`. Extract from the corresponding `.ts`/`.tsx` file.
- `functionName` must be a valid JS/TS identifier (validated at MCP input).
- The operation does not detect naming collisions with existing symbols in scope.

## Technical decisions

**Why the outermost function scope?**
The TS language service offers multiple extraction targets (innermost scope through module scope). Extracting to module scope is the most useful default for an AI agent — it produces a standalone, testable function. Extracting to a nested scope rarely provides value since the goal is usually to reduce function length.

**Why replace the generated name instead of passing it to the refactor API?**
The TS language service's `getEditsForRefactor` does not accept a custom name — it auto-generates one (e.g. `newFunction`). The implementation applies the edits in memory, reads back the generated name from `renameLocation`, and does a string replacement across all edit text. This is the same approach an IDE uses internally, followed by a rename.

**Why count parameters after the fact?**
`parameterCount` is read from a fresh AST parse of the written file rather than inferred from the edit text. This is more reliable because the compiler's parameter inference is the source of truth. Using the edit text would require parsing the new function signature out of a text diff, which is fragile.
