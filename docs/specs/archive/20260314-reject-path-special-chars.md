# Reject control characters and URI fragments in file paths

**type:** change
**date:** 2026-03-14
**tracks:** handoff.md # reject-control-chars-uri-fragments → docs/features/security.md (N/A — no dedicated security feature doc yet)

---

## Context

`isWithinWorkspace()` guards against `..` traversal and symlink escapes, but calls `path.resolve()` before performing any validation. Control characters (`\x00`–`\x1f`) in path strings can corrupt logs and confuse downstream tools; `?` and `#` fragments indicate the caller passed a URI instead of a plain filesystem path. Both cases should be rejected before `path.resolve()` is ever called.

## User intent

*As an agent or developer calling a light-bridge operation, I want malformed path strings (containing control characters or URI-style fragments) to produce an explicit `INVALID_PATH` error, so that I know immediately when I've passed a URI instead of a plain path or accidentally embedded a control character.*

## Relevant files

- `src/security.ts` — where `isWithinWorkspace` and `validateWorkspace` live; this is where the new `validateFilePath` function belongs
- `src/daemon/dispatcher.ts:226–235` — the dispatcher path-param loop that calls `isWithinWorkspace`; new check slots in here before the workspace boundary check
- `src/utils/errors.ts` — `ErrorCode` union; `INVALID_PATH` must be added here
- `tests/mcp/security.test.ts` — existing integration tests for workspace boundary checks; new tests for invalid paths go here

### Red flags

- `src/security.ts` is 149 lines — right at the ideal threshold. Adding ~20 lines (~169 total) stays below the 300 review threshold; no decomposition needed.
- `tests/mcp/security.test.ts` is 130 lines. Adding 4 test cases (~40 lines) brings it to ~170 — below the 300 review threshold. No test refactoring needed before this change.

## Value / Effort

- **Value:** Prevents control characters from reaching `path.resolve()` and the OS, where `\x00` is a string terminator on many platforms (silent truncation). Prevents URI fragments from silently resolving to unexpected paths. Gives agents an actionable `INVALID_PATH` error code rather than a confusing `WORKSPACE_VIOLATION` or a runtime crash.
- **Effort:** Small. Two new items: one exported function in `security.ts`, one call site in the dispatcher path-param loop. One new error code in `errors.ts`. Four new integration test cases in the existing security test file.

## Behaviour

- [x] Given a file path containing any byte in `\x00`–`\x1f` (e.g. `"/workspace/src/foo\x00bar.ts"`), the dispatcher returns `{ ok: false, error: "INVALID_PATH", message: "path contains control characters: <paramKey>" }` and the operation is not invoked.
- [x] Given a file path containing `?` (e.g. `"file:///workspace/src/foo.ts?v=1"`), the dispatcher returns `{ ok: false, error: "INVALID_PATH", message: "path contains URI fragment or query character: <paramKey>" }`.
- [x] Given a file path containing `#` (e.g. `"/workspace/src/foo.ts#anchor"`), the dispatcher returns `{ ok: false, error: "INVALID_PATH", message: "path contains URI fragment or query character: <paramKey>" }`.
- [x] A valid absolute path (no control chars, no `?` or `#`) passes validation and reaches `isWithinWorkspace` unchanged — no false positives for paths with spaces, hyphens, parentheses, or unicode in filenames.
- [x] `validateFilePath` is called before `path.resolve()` — verified by unit test that passes a null-byte path and confirms the function returns `{ ok: false }` without throwing or calling resolve.

> Note: The check applies only to the `pathParams` loop in `dispatchRequest`. It does not apply to the `workspace` argument (which is validated separately by `validateWorkspace` at daemon startup).

## Interface

### New function: `validateFilePath`

```ts
export function validateFilePath(
  filePath: string,
): { ok: true } | { ok: false; reason: "CONTROL_CHARS" | "URI_FRAGMENT" }
```

- **`filePath`:** Any string the caller passes as a file path parameter. Realistically an absolute OS path like `/workspace/src/foo.ts`. May be adversarial.
- **Returns `{ ok: true }`** when the string contains no control characters and no `?` or `#`.
- **Returns `{ ok: false, reason: "CONTROL_CHARS" }`** when any byte `\x00`–`\x1f` is present.
- **Returns `{ ok: false, reason: "URI_FRAGMENT" }`** when `?` or `#` is present (checked after control chars — control chars take priority).
- **Empty string:** returns `{ ok: false, reason: "CONTROL_CHARS" }` — an empty path is not a valid file path, but this edge case is already covered by the `isWithinWorkspace` boundary check. If it reaches `validateFilePath`, it will fail with the `isWithinWorkspace` check regardless; returning `ok: true` is also acceptable here since downstream checks will reject it anyway. **Decision:** return `{ ok: true }` to keep this function's responsibility narrow (only detect the new threat classes). The workspace boundary check rejects empty strings naturally.

### Dispatcher change

In `dispatchRequest` path-param loop, before the `isWithinWorkspace` check:

```ts
const pathResult = validateFilePath(value);
if (!pathResult.ok) {
  return {
    ok: false,
    error: "INVALID_PATH",
    message: pathResult.reason === "CONTROL_CHARS"
      ? `path contains control characters: ${paramKey}`
      : `path contains URI fragment or query character: ${paramKey}`,
  };
}
```

### New error code

Add `"INVALID_PATH"` to the `ErrorCode` union in `src/utils/errors.ts`.

## Open decisions

(none)

## Security

- **Workspace boundary:** This change strengthens the path validation layer — no existing checks are weakened. The new check runs before `isWithinWorkspace`, so the workspace boundary check is unaffected.
- **Sensitive file exposure:** N/A — no file content is read by this change.
- **Input injection:** This change directly addresses input injection via control characters. `\x00` is the most dangerous: it terminates strings on POSIX, meaning `/workspace/src/foo.ts\x00.pem` would pass the `.pem` sensitive-file check but resolve to `/workspace/src/foo.ts` on the filesystem. Rejecting it before `isSensitiveFile` and `path.resolve()` closes this gap.
- **Response leakage:** The raw `paramKey` name is included in error messages, not the path value. The path value must NOT appear in the message verbatim — it may contain null bytes or other characters that corrupt log output. The message identifies which parameter was invalid, not its value.

## Edges

- Only the `pathParams` loop in `dispatchRequest` calls `validateFilePath`. The `workspace` argument is validated separately at daemon startup and is not a user-supplied per-call value.
- `validateFilePath` must not call `path.resolve()` or `path.normalize()` — those are exactly the calls we're protecting against for adversarial input.
- The check must apply to all path parameters uniformly — `file`, `oldPath`, `newPath`, `sourceFile`, `destFile`. It must not require per-operation customisation.
- Existing tests must not be broken: `WORKSPACE_VIOLATION` is still returned for out-of-workspace paths that pass the new check.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score >= threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed:
      - README.md — no error codes table exists; no change needed
      - handoff.md current-state section — updated security.ts description
      - docs/features/mcp-transport.md — added `INVALID_PATH` to error codes list
- [x] Tech debt discovered during implementation added to handoff.md as [needs design] — none discovered
- [x] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting — none discovered
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Reflection:** Clean implementation matching the spec exactly. The `validateFilePath` function is a pure string check with no filesystem interaction, slotted into the dispatcher path-param loop before `path.resolve()`. The null-byte bypass of `isSensitiveFile` (where `foo.ts\x00.pem` would pass the `.pem` check but resolve to `foo.ts`) is now closed. Stryker generated mutations only in `errors.ts` (the new `INVALID_PATH` literal); `security.ts` and `dispatcher.ts` had no mutants generated, which is expected for simple conditional guards where the regex and branch structure don't produce viable mutations.

- **Tests added:** 5
- **Mutation score:** 100% on touched files (all generated mutants killed)
- **Discoveries:** None -- implementation was straightforward with no surprises.
