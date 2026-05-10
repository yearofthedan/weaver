# Internals: extract-function

User-facing reference: [docs/commands/extract-function.md](../commands/extract-function.md).

## How it works

The TS language service's "Extract Symbol" refactor does the heavy lifting — it infers parameters, return type, and async propagation. The implementation delegates to it, then substitutes the auto-generated name with the caller-supplied one.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary
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

## Technical decisions

**Why the outermost function scope?**
The TS language service offers multiple extraction targets (innermost scope through module scope). Extracting to module scope is the most useful default for an AI agent — it produces a standalone, testable function. Extracting to a nested scope rarely provides value since the goal is usually to reduce function length.

**Why replace the generated name instead of passing it to the refactor API?**
The TS language service's `getEditsForRefactor` does not accept a custom name — it auto-generates one (e.g. `newFunction`). The implementation applies the edits in memory, reads back the generated name from `renameLocation`, and does a string replacement across all edit text. This is the same approach an IDE uses internally, followed by a rename.

**Why count parameters after the fact?**
`parameterCount` is read from a fresh AST parse of the written file rather than inferred from the edit text. This is more reliable because the compiler's parameter inference is the source of truth. Using the edit text would require parsing the new function signature out of a text diff, which is fragile.
