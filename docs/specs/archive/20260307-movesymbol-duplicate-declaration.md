# moveSymbol: error on duplicate declaration, force flag

**type:** change
**date:** 2026-03-07
**tracks:** handoff.md # moveSymbol-duplicate-declaration -> docs/features/moveSymbol.md

---

## Context

When `moveSymbol` is called and the destination file already contains an exported declaration with the same name, the operation blindly appends a second copy. This produces a `Cannot redeclare block-scoped variable` type error. Observed during `extensions.ts` extraction, where the symbol had been pre-written in the destination file.

The fix is not a simple deduplication. The caller's intent is ambiguous: they may have pre-written the symbol intentionally or may not know the dest already has it (the tool should tell them). This spec adds a `SYMBOL_EXISTS` error by default and a `force` flag to opt in to the "source replaces dest" workflow -- like `mv -f`, the thing being moved wins.

## User intent

*As an agent, I want to move a symbol from one file to another, so that I can reorganize code without manually fixing imports.*

## Relevant files

- `src/operations/moveSymbol.ts` -- contains the bug; the append logic at lines 110-113 runs unconditionally. Fix goes here.
- `src/schema.ts` -- `MoveSymbolArgsSchema`; add `force` parameter.
- `src/mcp.ts` -- MCP tool definition for `moveSymbol`; add `force` to inputSchema and update description.
- `src/daemon/dispatcher.ts` -- `OPERATIONS.moveSymbol.invoke`; thread `force` through to `moveSymbol()`.
- `src/types.ts` -- `MoveSymbolResult`; no changes needed to return shape.
- `src/utils/errors.ts` -- `ErrorCode` union; add `SYMBOL_EXISTS`.
- `docs/features/moveSymbol.md` -- feature reference doc; update Constraints section with new behaviour.

### Red flags

- `src/operations/moveSymbol.ts` is 196 lines. Within the review-at-300 threshold. The fix adds a small conditional check and one new function parameter; no extraction needed.
- `src/mcp.ts` is 346 lines. Above the review-at-300 threshold, approaching the 500 hard flag. This spec only adds one parameter to one tool entry. Not actionable here, but worth noting for future specs that touch mcp.ts.

## Value / Effort

- **Value:** High. Without this fix, `moveSymbol` silently produces broken code when the destination already has the symbol. The agent then has to diagnose a `Cannot redeclare` type error -- a wasted round-trip. With a `SYMBOL_EXISTS` error, the agent knows exactly what happened and can decide whether to pass `force: true`. This follows the agent-users principle: "fail with a structured error that tells the agent exactly what to provide differently."
- **Effort:** Low. The implementation touches one operation file (small conditional check), one schema file (one field), the MCP tool definition (one parameter + description tweak), and the dispatcher (one parameter threaded through). All changes follow established patterns visible in the existing `checkTypeErrors` parameter.

## Behaviour

- [x] **AC1: Error when destination already exports the symbol (no `force`).**
  Input: `src/a.ts` exports `export const FOO = 1;`. `src/b.ts` contains `export const FOO = 42;`. Call `moveSymbol({ sourceFile: "src/a.ts", symbolName: "FOO", destFile: "src/b.ts" })`.
  Expected: Returns `EngineError` with code `SYMBOL_EXISTS` and a message naming both the symbol and the destination file. Neither file is modified. No importers are changed.

  _Laziest wrong impl:_ Throw the error but still remove from source first. The source file loses the declaration even though the move was rejected.
  _Narrowest broken sibling:_ Only check `const` declarations; miss `export function FOO` or `export class FOO` in the destination.

- [x] **AC2: With `force: true`, source declaration replaces dest declaration, importers rewritten.**
  Input: Same setup as AC1. Call `moveSymbol({ sourceFile: "src/a.ts", symbolName: "FOO", destFile: "src/b.ts", force: true })`.
  `src/c.ts` contains `import { FOO } from "./a";`.
  Expected: The existing `FOO` declaration in `src/b.ts` is removed and the source `FOO` declaration is appended. `FOO` is removed from `src/a.ts`. `src/c.ts` import is rewritten to point to `src/b.ts`. `filesModified` includes `src/a.ts`, `src/b.ts`, and `src/c.ts`.

  _Laziest wrong impl:_ Append the source declaration without removing the existing dest declaration -- produces the same `Cannot redeclare` error this spec is meant to fix.
  _Narrowest broken sibling:_ Only handle the case where `force` is explicitly `true`; crash or ignore when `force` is `false` (should behave same as omitted).

- [x] **AC3: Normal move (dest does not have the symbol) is unaffected by the `force` flag.**
  Input: `src/a.ts` exports `BAR`. `src/b.ts` exists but does not export `BAR`. Call `moveSymbol({ sourceFile: "src/a.ts", symbolName: "BAR", destFile: "src/b.ts" })` (no `force`).
  Expected: `BAR` is removed from `src/a.ts`, appended to `src/b.ts`, importers rewritten. Same behaviour as before this change.

  _Why needed:_ The duplicate-detection guard must not accidentally block normal moves. Also verifies that `force: true` on a non-conflicting move is a no-op (accepted but ignored).

- [x] **AC4: Non-exported same-name declaration in dest is not treated as a conflict.**
  Input: `src/a.ts` exports `export const FOO = 1;`. `src/b.ts` contains `const FOO = 42;` (not exported). Call `moveSymbol({ sourceFile: "src/a.ts", symbolName: "FOO", destFile: "src/b.ts" })`.
  Expected: The operation proceeds with the append (no `SYMBOL_EXISTS` error). The `SYMBOL_EXISTS` check only considers exported declarations, matching the same `getExportedDeclarations()` API used to find the symbol in the source file. The resulting `Cannot redeclare` type error surfaces via the `typeErrors` response field -- that is a conflict in the user's code, not something `moveSymbol` should intercept.

  _Why needed:_ Prevents over-broad conflict detection. A private helper named `FOO` in the dest file is not the same symbol as an exported `FOO` being moved in.

## Interface

### New parameter: `force`

Added to `MoveSymbolArgsSchema` and the MCP tool definition.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `force` | `boolean` | No | `false` (omitted = `false`) | When true and the destination file already exports a declaration with the same name, the source declaration replaces the existing destination declaration. The source is removed, and importers are rewritten. When false or omitted, the operation returns `SYMBOL_EXISTS` error if the destination already exports the symbol. |

- **What does it contain?** A boolean intent signal: "I know the dest has this symbol; replace it with the one I'm moving."
- **Realistic bounds:** `true` or `false`. Only meaningful when the dest file exports a same-named symbol; otherwise ignored.
- **Zero/empty case:** Omitted means `false`. There is no distinction between `force: false` and absent -- both produce the error.
- **Adversarial case:** `force: true` when dest does not have the symbol -- no-op, normal move proceeds.

### New error code: `SYMBOL_EXISTS`

Added to `ErrorCode` union in `src/utils/errors.ts`.

| Code | When | Retriable? | Agent action |
|------|------|-----------|--------------|
| `SYMBOL_EXISTS` | Destination file already exports a declaration with the same name as `symbolName`, and `force` is not `true`. | Not retriable as-is. Retriable with `force: true` to replace the dest declaration with the source version. | Read the error message. Decide whether to pass `force: true` (source replaces dest) or resolve the conflict manually. |

Error message format: `Symbol '${symbolName}' already exists as an export in ${destFile}. Pass force: true to replace the existing declaration with the source version.`

This message tells the agent exactly what to do, following the agent-users principle of structured, actionable errors.

### MCP tool description update

The `moveSymbol` tool description in `src/mcp.ts` should add a sentence about the conflict behaviour. Suggested addition after "Creates the destination file if it does not exist.":

`"If the destination already exports a symbol with the same name, returns SYMBOL_EXISTS -- pass force: true to replace the destination declaration with the source version and rewrite importers."`

### Return shape

No changes to `MoveSymbolResult`. When `force: true` is used, the return shape is the same as a normal move. The `SYMBOL_EXISTS` case is an error, not a result variant.

## Security

- **Workspace boundary:** N/A -- this change does not introduce new file read or write paths. The existing `isWithinWorkspace` checks on `sourceFile`, `destFile`, and all importer writes remain unchanged. The new `force` flag is a boolean that controls a conditional branch; it does not affect which files are accessed.
- **Sensitive file exposure:** N/A -- `moveSymbol` operates on AST declarations via ts-morph, not raw file content. It does not read or expose file content to the response. No interaction with `isSensitiveFile`.
- **Input injection:** The `force` parameter is a boolean validated by Zod (`z.boolean().optional()`). It cannot carry a string payload. The `symbolName` parameter already passes through identifier validation (`/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`) before reaching this code. No new string inputs are introduced.
- **Response leakage:** The new `SYMBOL_EXISTS` error message interpolates `symbolName` and `destFile`. Both are already validated: `symbolName` is an identifier (regex-constrained), and `destFile` is a workspace-validated absolute path. Neither can contain arbitrary file content. The existing prompt-injection caveat in `docs/security.md` (symbol names appearing in responses) applies but is not worsened by this change.

## Edges

**What must NOT change:**
- When no conflict exists, behaviour is identical to current code regardless of `force` value.
- The source declaration is always removed on a successful move (including `force: true`). The intent is "this symbol now lives in the dest file."
- Importer rewriting always runs on a successful move. With `force: true`, the dest file IS modified (existing declaration removed, source declaration appended), and `filesModified` includes the dest file.
- The `afterSymbolMove` post-step (Vue import patching) still runs.
- The `checkTypeErrors` parameter is orthogonal; it works the same way with or without `force`.

**Assumptions:**
- "Already exists" is defined by `dstSF.getExportedDeclarations().get(symbolName)` returning a non-empty array. This mirrors the same API used to find the symbol in the source file (line 38 of `moveSymbol.ts`).
- We do not compare declaration shapes (type, value, function signature). With `force: true`, the source declaration replaces the dest declaration regardless of whether the shapes match.
- If the dest file has a non-exported declaration with the same name, the `SYMBOL_EXISTS` check does not trigger. See AC4.
- The `SYMBOL_EXISTS` error is thrown before any mutations. Neither the source file nor any importers are modified when the error fires.

**Interactions:**
- `moveSymbol` followed by `getTypeErrors` should show no errors when `force: true` is used and the source declaration is well-typed in the dest context.
- The `force` parameter follows the same optional-boolean pattern as `checkTypeErrors` across other operations.

## Done-when

- [x] All ACs (1-4) verified by tests
- [x] Mutation score >= threshold for `src/operations/moveSymbol.ts`
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated:
      - `docs/features/moveSymbol.md` updated with `force` parameter and `SYMBOL_EXISTS` behaviour
      - `docs/handoff.md` current-state section updated if needed
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Shipped:** 2026-03-07

- **Tests:** 480 total passing (added ~10 new tests for this feature)
- **Mutation score:** 83.19% for `src/operations/moveSymbol.ts` (above threshold)
- **Key decision:** `force` uses "source replaces dest" semantics, reversed from the initial spec draft which had "keep dest" semantics. The User intent statement ("I want to move a symbol") made the correct semantics obvious -- if the user says "move X to Y", the moved symbol should be the one that survives. This led to adding a "User intent" section to the change spec template as a standard practice.
