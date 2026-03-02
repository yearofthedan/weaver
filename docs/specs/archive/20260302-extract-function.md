# Extract function

**type:** change
**date:** 2026-03-02
**tracks:** handoff.md # extractFunction → docs/features/ (new feature doc on ship)

---

## Context

Agents frequently need to pull a block of code into a named function — during refactoring, after copy-paste deduplication, or to make a long function readable. Today the only option is manual text editing (read the code, figure out which locals are referenced, write the function signature, replace the call site). This is slow, token-expensive, and error-prone. TypeScript's language service already has a built-in "Extract Function" refactor (`getApplicableRefactors` / `getEditsForRefactor`) that handles parameter inference, return values, type annotations, and async propagation. `extractFunction` wraps this compiler capability behind the same MCP interface as `rename` and `moveSymbol`.

## Value / Effort

- **Value:** Saves the agent from reading the surrounding scope, manually identifying referenced locals, inferring return values, writing a correct function signature with types, and replacing the call site — a multi-step process that is the most common source of introduced type errors during refactoring. The compiler does all of this correctly in one shot.
- **Effort:** Low-medium. Single new operation file + dispatcher entry + MCP tool entry. The heavy lifting (parameter inference, return value detection, type annotation, async propagation) is delegated to the TypeScript language service. The main implementation work is: (1) calling `getApplicableRefactors` to find the right refactor action, (2) selecting the module-scope extraction action, (3) replacing the auto-generated function name with the caller-provided name in the edit text, (4) applying the edits via ts-morph. Follows existing patterns from `rename` and `moveSymbol`. TS-only for v1 — no new Vue provider work.

## Behaviour

- [ ] **AC1 — Extracts statements to a module-scope function.** Given `file` (a `.ts` or `.tsx` file), `startLine`, `startCol`, `endLine`, `endCol` (1-based positions delimiting a selection of complete statements inside a function body), and `functionName` (a valid identifier), creates a new function at module scope containing the selected statements, replaces the selection with a call to the new function, and returns `{ filesModified: [file], filesSkipped: [], functionName, parameterCount }`.

- [ ] **AC2 — Infers parameters and return values correctly.** Variables from the enclosing scope that are referenced in the selection become parameters of the extracted function. Variables assigned in the selection and used after the selection become the return value. The file has no new type errors after extraction (verified by `checkTypeErrors` running automatically).

- [ ] **AC3 — Applies the caller-provided function name.** The extracted function is named according to `functionName`, not the compiler's auto-generated default (e.g., `newFunction`). The call site also uses the provided name.

- [ ] **AC4 — Rejects un-extractable selections with NOT_SUPPORTED.** When the TypeScript compiler reports no applicable "Extract Function" refactor for the given range (incomplete statements, control flow crossing the selection boundary, empty range, or module-level code that can't be wrapped), returns `{ ok: false, error: "NOT_SUPPORTED", message: "<descriptive reason>" }`.

## Interface

### Parameters

| Param | Type | Description | Bounds | Zero/empty | Adversarial |
|-------|------|-------------|--------|------------|-------------|
| `file` | `string` | Absolute path to the `.ts`/`.tsx` file | Must exist, must be within workspace | Empty string → `VALIDATION_ERROR` | Path with spaces: works (path.resolve handles it). Symlinks: `isWithinWorkspace` resolves them. `.vue` files: `NOT_SUPPORTED`. |
| `startLine` | `number` | Start line of selection (1-based) | Positive integer, ≤ file line count | 0 or negative → `VALIDATION_ERROR` | Line beyond EOF → `NOT_SUPPORTED` (no extractable code) |
| `startCol` | `number` | Start column of selection (1-based) | Positive integer | 0 or negative → `VALIDATION_ERROR` | Column beyond line length → snapped by compiler |
| `endLine` | `number` | End line of selection (1-based) | ≥ `startLine` | Same as startLine (single-line selection — valid if it selects a complete expression) | Line beyond EOF → `NOT_SUPPORTED` |
| `endCol` | `number` | End column of selection (1-based) | Positive integer | 0 or negative → `VALIDATION_ERROR` | Column beyond line length → snapped by compiler |
| `functionName` | `string` | Name for the extracted function | Valid JS identifier (`/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`) | Empty → `VALIDATION_ERROR` | Name collision with existing function → compiler handles (may shadow or error — tested in Edges) |
| `checkTypeErrors` | `boolean?` | Skip post-write type check when `false` | — | Absent → defaults to `true` (same as all other mutating ops) | — |

### Return shape (success)

```typescript
{
  ok: true,
  filesModified: string[],   // always [file] — single-file operation
  filesSkipped: string[],    // always [] — no cross-file writes
  functionName: string,      // the name the caller provided
  parameterCount: number,    // number of parameters on the extracted function
  // + typeErrors, typeErrorCount, typeErrorsTruncated (from dispatcher post-write check)
}
```

### Return shape (error)

```typescript
{
  ok: false,
  error: "NOT_SUPPORTED" | "VALIDATION_ERROR" | "FILE_NOT_FOUND",
  message: string
}
```

### New error codes

None — uses existing `NOT_SUPPORTED`, `VALIDATION_ERROR`, `FILE_NOT_FOUND`.

### Dispatcher entry

```typescript
extractFunction: {
  pathParams: ["file"],
  schema: ExtractFunctionArgsSchema,
  async invoke(registry, params, workspace) {
    const { file, startLine, startCol, endLine, endCol, functionName } = params;
    const tsProvider = await registry.tsProvider();
    return extractFunction(tsProvider, file, startLine, startCol, endLine, endCol, functionName, workspace);
  },
}
```

Uses `tsProvider` directly (like `moveSymbol`) — this is a ts-morph AST operation, not a provider-polymorphic one.

## Edges

These are constraints that become regression tests, not features:

- **TS/TSX files only.** `.vue` file paths return `NOT_SUPPORTED`. Vue extract support is a separate `[needs design]` entry if needed.
- **Workspace boundary enforced.** The dispatcher validates `file` against `isWithinWorkspace` via `pathParams: ["file"]` — no extra code needed.
- **Async propagation.** If the selection contains `await`, the extracted function must be `async` and the call site must `await` it. (The TS language service handles this automatically.)
- **Single-file operation.** `extractFunction` never modifies other files. `filesModified` is always `[file]`, `filesSkipped` is always `[]`.
- **No export keyword.** The extracted function is not exported. The agent can use `moveSymbol` separately if it wants to export/relocate it.
- **Existing identifier with same name.** If `functionName` collides with an existing identifier in scope, the operation should still succeed if the compiler allows it (shadowing), or return `NOT_SUPPORTED` if the compiler rejects it. Do not add custom collision detection — defer to the compiler.
- **Expression extraction.** If the selection is a single expression (not a statement), the compiler may extract it as `return <expr>` in the new function and replace the original with the function call. This is valid — don't block it.
- **Selection spanning multiple statements.** Valid — the compiler groups them into the function body.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed:
      - README.md (tool table, CLI commands, error codes, project structure)
      - Feature doc created or updated
      - handoff.md current-state section
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Agent insights captured in docs/agent-memory.md
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Shipped:** 2026-03-02

**Implementation:** `src/operations/extractFunction.ts` — delegates to TypeScript's built-in `getApplicableRefactors`/`getEditsForRefactor` with the "Extract Symbol" refactor. Selects the outermost (`function_scope_N`) action, replaces the compiler's auto-generated name with the caller-provided name across all edits before writing to disk, then counts parameters by reloading the file via a fresh project.

**Tests added:** 8 tests in `tests/operations/extractFunction.test.ts` covering all four ACs plus error paths (FILE_NOT_FOUND, NOT_SUPPORTED for empty range and .vue files).

**Gotcha — endCol must include the semicolon:** For multi-statement selections, TypeScript's `getApplicableRefactors` returns no refactors if the `end` offset falls before the `;` that terminates the last statement. `endCol` must point at the `;` or past it; pointing at the last expression character (e.g., `)` in `console.log(msg)`) silently returns nothing. This is a quirk of the TS compiler's refactor API, not of our offset encoding. Document in agent-memory.md.

**Architectural decisions:**
- Uses `tsProvider.getProjectForFile` directly (same pattern as `moveSymbol`) — no provider polymorphism needed since Vue is explicitly not supported in v1.
- Outermost scope action (`function_scope_N`) is selected by sorting on the numeric suffix descending — this consistently extracts to module scope rather than an inner function scope.
- Name replacement uses `String.replaceAll(generatedName, functionName)` on the raw edit text — this is safe because the generated name (from `renameLocation`) is a compiler-generated identifier that does not appear in user code.
