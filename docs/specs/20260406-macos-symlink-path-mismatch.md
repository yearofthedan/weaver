# macOS symlink path mismatch

**type:** bug
**date:** 2026-04-06
**tracks:** handoff.md # (new — discovered during local test run)

---

## Symptom

Four tests fail on macOS but pass on Linux (dev container / CI):

```
src/domain/security.test.ts
  > rejects a symlink that resolves to a restricted path
  actual:   result.ok === true
  expected: result.ok === false

src/ts-engine/move-file.test.ts
  > does not throw ENOENT when git ls-files returns a file deleted by a prior move
  actual:   content contains original import, not rewritten './helpers/mock'
  expected: content contains './helpers/mock'

src/operations/workspace-boundary.test.ts
  > moveFile: skips out-of-workspace import rewrites, performs the physical move
  actual:   result.filesSkipped does not contain 'consumer'
  expected: result.filesSkipped contains 'consumer'

src/cli-workspace-default.integration.test.ts
  > uses cwd workspace to stop a running daemon
  actual:   {"stopped":false,"message":"No daemon running for this workspace"}
  expected: {"stopped":true}
```

Root cause: on macOS, `/var` is a symlink to `/private/var` and `/etc` is a symlink to `/private/etc`. `process.cwd()` in a child process resolves these symlinks; `fs.realpathSync` does too. Linux has no such indirection so these tests pass there.

## Value / Effort

- **Value:** High — these failures block local development on macOS and erode trust in the test suite. No workaround short of running in a container.
- **Effort:** Low — root cause is clear, fixes are localised to 3 files. No new infrastructure needed.

## Expected

All four tests pass on macOS without modification to the tests themselves.

## Root cause

Three distinct manifestations of the same underlying issue:

**1. `security.test.ts`**
`RESTRICTED_WORKSPACE_ROOTS` contains `/etc`. The test creates a symlink pointing to `/etc` and calls `validateWorkspace`. `realpathSync` resolves the symlink all the way to `/private/etc` (macOS dereferences `/etc` → `/private/etc`). `/private/etc` is not in the set → check passes → `result.ok === true` instead of `false`.

**2. `move-file.test.ts` + `workspace-boundary.test.ts`**
`getEditsForFileRename` (engine.ts:347) calls `fs.realpathSync(oldPath)` before the TS language service call, producing `/private/var/folders/...`. But the project was loaded with `addSourceFileAtPath` using the unresolved path `/var/folders/...`. The TS language service can't find the source file under the real path → returns no edits → imports are not rewritten → `filesSkipped` is empty.

This is a half-fix from commit `4cb655a` ("fix(operations): reliably rewrite imports after moveFile"): `realpathSync` was applied to the LS call but not to the project load, so paths are still inconsistent on macOS.

**3. `cli-workspace-default.integration.test.ts`**
Daemon started with `--workspace /var/folders/.../dir` → socket keyed by hash of `/var/folders/.../dir`. `stop` run with `cwd: dir` → child's `process.cwd()` returns `/private/var/folders/.../dir` → socket keyed by hash of `/private/var/folders/.../dir` → different hash → "No daemon running".

## Fix

**Prep:** `src/ts-engine/move-file.test.ts` is at 509 lines (hard flag per `docs/code-standards.md`). Decompose before adding the regression test — extract shared git-repo scaffolding into a named helper function in the test file, then apply `it.each` where cases share structure.

**1. `src/domain/security.ts` — resolve restricted paths at construction**

Wrap each entry in `RESTRICTED_WORKSPACE_ROOTS` with `realpathSync` (try/catch fallback to original) at set construction time. This ensures `/etc` and `/private/etc` both appear in the set and the check works regardless of which form `realpathSync` produces on a given OS.

Adjacent inputs to cover: a symlink pointing to `/private/etc` directly (no `/etc` hop); a symlink to a non-restricted path (must still pass).

**2. `src/ts-engine/engine.ts` — consistent realpath in `getEditsForFileRename`**

Extract a small utility `resolveToRealPath(p: string): string` — calls `fs.realpathSync(p)`, returns original on error. Use it consistently for both the `addSourceFileAtPath` call and the LS call so the project and the language service always agree on the canonical path.

Replace the scattered inline comments in `getEditsForFileRename` with a JSDoc block on the method that explains the realpath invariant. The method body should not need inline comments after the extraction.

Adjacent inputs: a file whose path contains no symlinks (must still work); a file in a symlinked workspace root; `newPath` directory that doesn't exist yet (existing try/catch already handles this).

**3. `src/daemon/paths.ts` — canonicalise workspace key**

In `workspaceHash`, resolve the workspace root via `realpathSync` (try/catch fallback to original) before hashing. This ensures daemon and stop command always agree on the key regardless of whether `process.cwd()` or `--workspace` produce symlinked or real paths.

## Security

- **Workspace boundary:** Fix 1 strengthens the restricted-path check — it closes a real bypass on macOS where a symlink to `/private/etc` would pass validation. Fix 3 changes path normalisation for workspace keys only, not boundary enforcement. No weakening.
- **Sensitive file exposure:** N/A — no change to file-read paths.
- **Input injection:** N/A — no change to how user-supplied strings reach the filesystem or shell.
- **Response leakage:** N/A — no change to error messages or response fields.

## Edges

- A workspace path with no symlinks must continue to work — `realpathSync` is a no-op in that case.
- A symlink workspace root that points *inside* the workspace (not to a restricted path) must remain valid.
- The `isCoexistingJsFileEdit` guard in `getEditsForFileRename` must continue to suppress `.js` specifier edits correctly after the realpath extraction.
- The daemon stop command must work whether the user passes `--workspace` explicitly or relies on `cwd`.

## Done-when

- [ ] All four previously-failing tests pass on macOS
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `move-file.test.ts` decomposed below 500 lines before new test added
- [ ] Regression test added for the macOS symlink case in `getEditsForFileRename` (project loaded with symlinked path, LS call uses real path — verify edits are still returned)
- [ ] No inline comments remain in `getEditsForFileRename` body; JSDoc added to the method
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
