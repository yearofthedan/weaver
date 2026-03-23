# Replace `ok` with three-value `status` field

**type:** change
**date:** 2026-03-23
**tracks:** handoff.md # `getTypeErrors` / write operations: add `warn` status level → docs/features/mcp-transport.md

---

## Context

Every response in the wire protocol uses `ok: true` or `ok: false`. Write operations that succeed but leave type errors return `ok: true` with `typeErrorCount > 0` — there is no structured signal that the operation needs follow-up. Agents must know to compare `typeErrorCount > 0` to detect this, a convention that is invisible in tool descriptions and easy to miss. Replacing `ok` with a three-value `status` field gives agents a single field to branch on.

## User intent

*As an agent user, I want every response to tell me its outcome in one field, so that I can branch on `status` without combining `ok` with `typeErrorCount`.*

## Relevant files

- `src/daemon/dispatcher.ts` — builds `{ ok: true, ...result }` responses, runs post-write diagnostics (lines 273–289)
- `src/daemon/daemon.ts` — socket handler produces `ok: true/false` for ping, parse errors, internal errors, stop command (lines 242–285); logger derivation uses `res.ok === true`
- `src/daemon/logger.ts` — `LogEntry.ok: boolean` field
- `src/adapters/mcp/mcp.ts` — MCP error handler produces `{ ok: false, error, message }` (line 83)
- `src/__testHelpers__/fake-daemon.ts` — returns `{ ok: true, version }` for protocol tests
- `src/daemon/post-write-diagnostics.ts` — returns `PostWriteDiagnostics` (no `ok` field — not affected)
- `src/operations/types.ts` — result type definitions (no `ok` field — not affected)
- `docs/features/mcp-transport.md` — documents the response contract

### Out of scope

`src/security.ts` and `src/adapters/cli/cli.ts` use `{ ok: true/false }` as internal TypeScript discriminated unions for `validateFilePath` and `validateWorkspace`. These are not wire protocol — they stay as-is.

### Red flags

- `src/daemon/dispatcher.test.ts` is 403 lines — at the review threshold. The post-write diagnostics section (lines 98–255) is the densest area and will need updates. No decomposition needed for this change, but avoid growing it further.

## Value / Effort

- **Value:** Agents get a single field to branch on: `"success"` means done, `"warn"` means the operation succeeded but left type errors to fix, `"error"` means it failed. No need to combine fields or know conventions. Tool descriptions can say "if status is warn, follow up with replaceText to fix type errors."
- **Effort:** Small surface. The `ok` field is set in three production files (`dispatcher.ts`, `daemon.ts`, `mcp.ts`) plus one test helper (`fake-daemon.ts`). Logger needs a minor type change. ~101 test assertions reference `ok` across ~21 files, but the security.ts references (~14) are out of scope, leaving ~87 mechanical assertion updates. No new infrastructure or abstractions.

## Behaviour

- [ ] **AC1: Successful operations return `status: "success"`.** Given any operation (read or write) that completes without error and without post-write type errors, the response contains `status: "success"` and no `ok` field.

- [ ] **AC2: Write operations with type errors return `status: "warn"`.** Given a write operation that completes and post-write diagnostics find `typeErrorCount > 0`, the response contains `status: "warn"` (not `"success"`). The `typeErrors`, `typeErrorCount`, and `typeErrorsTruncated` fields are present as before.

- [ ] **AC3: Suppressed type checking returns `status: "success"`.** Given a write operation with `checkTypeErrors: false`, the response contains `status: "success"` — the operation itself succeeded and no diagnostics were requested.

- [ ] **AC4: Failed operations return `status: "error"`.** Given any operation that fails (validation error, workspace violation, unknown method, parse error, internal error, engine error), the response contains `status: "error"` with `error` code and `message` fields as before. No `ok` field.

## Interface

### Response shape — success (read-only or write with no type errors)

```json
{
  "status": "success",
  "filesModified": ["src/a.ts"],
  "typeErrors": [],
  "typeErrorCount": 0,
  "typeErrorsTruncated": false
}
```

### Response shape — warn (write with type errors)

```json
{
  "status": "warn",
  "filesModified": ["src/a.ts"],
  "typeErrors": [{ "file": "src/a.ts", "line": 3, "col": 7, "code": 2322, "message": "..." }],
  "typeErrorCount": 1,
  "typeErrorsTruncated": false
}
```

### Response shape — error

```json
{
  "status": "error",
  "error": "SYMBOL_NOT_FOUND",
  "message": "Could not find exported symbol 'Foo' in src/bar.ts"
}
```

### `status` field

| Value | Meaning | When |
|-------|---------|------|
| `"success"` | Operation completed cleanly | No errors, or `checkTypeErrors: false`, or zero files modified |
| `"warn"` | Operation completed but left type errors | `typeErrorCount > 0` after post-write diagnostics |
| `"error"` | Operation failed | Validation, boundary, engine, or internal error |

The `ok` field is removed from all responses. No response contains both `status` and `ok`.

### Logger

`LogEntry.ok: boolean` becomes `LogEntry.status: "success" | "warn" | "error"`. The daemon handler derives it from `res.status` instead of `res.ok === true`.

### Ping response

The daemon ping response changes from `{ ok: true, version: N }` to `{ status: "success", version: N }`. `ensure-daemon.ts` only reads `ping.version` — no code change needed there.

## Security

- **Workspace boundary:** N/A — no new file reads/writes; boundary checks are unchanged.
- **Sensitive file exposure:** N/A — no new content reading.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — the `status` field is a fixed string literal, not user-controlled.

## Edges

- Internal discriminated unions (`security.ts` `validateFilePath`/`validateWorkspace`) are NOT changed — they are not wire protocol.
- The `eval/` fixture responses should be updated to use `status` instead of `ok` so eval tests pass.
- `ensure-daemon.ts` reads `ping.version` but never checks `ping.ok` — no code change needed.
- `callDaemon` return type is `Record<string, unknown>` — no type narrowing on `ok` exists there.

## Done-when

- [ ] All ACs verified by tests
- [ ] No remaining `ok: true` or `ok: false` in wire protocol responses (dispatcher, daemon handler, MCP error handler, fake daemon)
- [ ] `LogEntry.status` replaces `LogEntry.ok`
- [ ] Eval fixture responses updated
- [ ] Mutation score >= threshold for `dispatcher.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/features/mcp-transport.md` response contract section
      - Tool descriptions in `src/adapters/mcp/tools.ts` updated to reference `status` instead of implying `ok`
      - `docs/handoff.md` current-state section if needed
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
