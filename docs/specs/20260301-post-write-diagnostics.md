# Post-write type diagnostics

**type:** change
**date:** 2026-03-01
**tracks:** handoff.md # getTypeErrors post-write diagnostics → docs/features/getTypeErrors.md

---

## Context

Write operations (rename, moveFile, moveSymbol, replaceText) currently return what they changed but not whether those changes are type-safe. Agents must remember to follow up with a separate `getTypeErrors` call — and in practice they often don't, discovering breakage several steps later. Surfacing type errors in the write response itself closes the feedback loop at the point of change.

## Value / Effort

- **Value:** High. Agents catch type errors at the moment they're introduced, not three steps later. Eliminates a class of "forgot to type-check" bugs. Every write tool user benefits — no extra round-trip, no extra prompt engineering to remind the agent.
- **Effort:** Low-medium. No new algorithms or provider logic. The implementation is plumbing: add a parameter to 4 schemas, a shared helper that calls existing `getTypeErrors` scoped to `filesModified`, thread results through the dispatcher, extend 4 result types. All patterns already exist in the codebase.

## Behaviour

- [ ] **AC1 — Errors detected:** Given `rename({ file, line, col, newName, checkTypeErrors: true })` where the rename introduces a type error in a modified file, the result includes `typeErrors` containing a `TypeDiagnostic` with correct `file`, `line`, `col`, `code`, `message`, and `typeErrorCount ≥ 1`, `typeErrorsTruncated: false`.
- [ ] **AC2 — Clean result:** Given `rename({ ..., checkTypeErrors: true })` where modified files have no type errors, the result includes `typeErrors: []`, `typeErrorCount: 0`, `typeErrorsTruncated: false`.
- [ ] **AC3 — Opt-out:** Given any write operation called without `checkTypeErrors` (or with `checkTypeErrors: false`), the result does NOT contain `typeErrors`, `typeErrorCount`, or `typeErrorsTruncated` fields.
- [ ] **AC4 — Scoped to modified files:** Given `replaceText({ ..., checkTypeErrors: true })` where an unmodified project file has pre-existing type errors, those errors are NOT included in `typeErrors` — only errors in `filesModified` appear.

## Interface

### New input parameter (all 4 write operations)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `checkTypeErrors` | `boolean` | no | `false` | When `true`, run type diagnostics on `filesModified` after the write completes. |

- **What does it contain?** A flag to opt in to post-write diagnostics.
- **Realistic bounds:** Boolean — only two values. No parsing concern.
- **Zero/empty case:** Omitted or `false` → no diagnostics fields in the response (not even empty arrays). The distinction between absent and `false` is not meaningful — both mean "don't check".
- **Adversarial case:** `true` on a write that modifies 200 files — diagnostics are still capped at 100 total.

### New output fields (present only when `checkTypeErrors: true`)

| Field | Type | Description |
|-------|------|-------------|
| `typeErrors` | `TypeDiagnostic[]` | Type errors found in `filesModified`, capped at 100. Same shape as standalone `getTypeErrors` diagnostics. |
| `typeErrorCount` | `number` | True total error count across `filesModified` (may exceed `typeErrors.length` when truncated). |
| `typeErrorsTruncated` | `boolean` | `true` when results were capped at 100. |

- **`typeErrors` zero case:** `[]` when all modified files are type-clean. Length 0–100.
- **`typeErrors` 10× case:** A write touching 50 files each with 10 errors = 500 total. `typeErrors` returns the first 100, `typeErrorCount` is 500, `typeErrorsTruncated` is `true`.
- **`TypeDiagnostic` shape:** Identical to standalone `getTypeErrors` — `{ file, line, col, code, message }`. No new fields.

### Implementation sketch

- `src/schema.ts`: Add `checkTypeErrors: z.boolean().optional()` to `RenameArgsSchema`, `MoveArgsSchema`, `MoveSymbolArgsSchema`, `ReplaceTextBaseSchema`.
- `src/types.ts`: Add `PostWriteDiagnostics` type (`{ typeErrors, typeErrorCount, typeErrorsTruncated }`). Extend write result types with `& Partial<PostWriteDiagnostics>`.
- `src/operations/getTypeErrors.ts`: Export a `getTypeErrorsForFiles(provider, files)` helper that checks only the given files (reuses existing `toDiagnostic` and `MAX_DIAGNOSTICS`).
- `src/daemon/dispatcher.ts`: After `invoke()`, if `checkTypeErrors` is truthy and result has `filesModified`, call helper and merge fields into the result.
- `src/mcp.ts`: Add `checkTypeErrors` to the 4 write tool `inputSchema` entries and mention it in descriptions.

## Edges

- **TS-only:** Post-write diagnostics use `TsProvider` only (same limitation as standalone `getTypeErrors`). `.vue` file diagnostics are out of scope — tracked separately in handoff.md P4.
- **Non-TS files in `filesModified`:** If `filesModified` contains `.vue` or `.json` files, they are silently skipped (no error, just no diagnostics for those files).
- **Truncation cap:** Same 100-diagnostic cap as standalone `getTypeErrors`. `typeErrorCount` reflects the true total.
- **Cache freshness:** Write operations already call `provider.notifyFileWritten()` during execution, so the type checker sees post-write file state. No additional cache refresh is needed.
- **Existing `getTypeErrors` tool is unchanged:** This feature does not modify standalone `getTypeErrors` behaviour or interface.
- **`filesSkipped` files are not checked:** Only `filesModified` (files actually written within the workspace) are scanned.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - README.md tool table (mention `checkTypeErrors` param on write tools)
      - `docs/features/getTypeErrors.md` updated with post-write diagnostics section
      - `docs/features/mcp-transport.md` tool table if tool signatures changed
      - handoff.md current-state section
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
