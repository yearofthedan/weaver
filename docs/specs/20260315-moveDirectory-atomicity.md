# moveDirectory is not atomic — partial move on failure leaves split state

**type:** bug
**date:** 2026-03-15
**tracks:** handoff.md # moveDirectory-atomicity

---

## Symptom

`moveDirectory` moves files one at a time in a loop (`moveDirectory.ts:83-100`). When an error occurs mid-operation, files already moved stay at the destination while remaining files stay at the source. The workspace is left in an inconsistent split state requiring manual recovery (`git checkout`).

```
input:    moveDirectory("project/simple-ts", "project/fixtures/simple-ts")
actual:   { ok: false, error: "PARSE_ERROR", message: "ENOENT: ...utils.ts" }
          — src/main.ts and src/utils.ts at NEW path, tests/ and tsconfig.json at OLD path
expected: { ok: false, ... } — all files remain at original location
```

## Value / Effort

- **Value:** High. A failed `moveDirectory` silently corrupts the workspace. The user sees an error but has no idea which files moved and which didn't. The only recovery is `git checkout`, which discards all uncommitted work — not just the failed move.
- **Effort:** Low-medium. The fix is localised to `moveDirectory.ts`. The function is 109 lines and the loop is the only mutation site. The fix restructures the loop into two phases but doesn't change the external interface.

## Expected

If `moveDirectory` fails at any point, all files remain at their original paths with original content. The error propagates normally. No partial state.

## Root cause

`moveDirectory.ts:83-100` — the `for` loop physically moves files (`scope.fs.rename`) and applies compiler edits (`moveFile` for Vue files) incrementally. There is no separation between the compute phase (what needs to happen) and the commit phase (doing it). When any step throws — compiler ENOENT, filesystem error, import rewrite failure — files already processed are at the new path, files not yet processed are at the old path, and import rewrites in third-party files may already be written to disk.

The problem is structural: a single loop interleaves reads, writes, and moves with no ability to roll back the writes (import rewrites touch arbitrary files across the workspace).

## Fix

Restructure `moveDirectory` to follow design principle #6 ("compute before mutate" — see `docs/architecture.md`):

1. **Compute phase:** Enumerate files, validate destinations, and for each file that needs compiler edits (Vue files via `moveFile`, or future TS import rewriting), gather the edits without applying them. If anything fails here, no files have been touched.
2. **Commit phase:** Apply all gathered edits, then perform all physical file moves. This phase runs only after the compute phase succeeds completely.

Acceptance criteria:

- [ ] **AC1 — Two-phase structure:** `moveDirectory` separates into a compute phase (enumerate files, validate destinations, gather compiler edits) and a commit phase (apply edits, move files). If the compute phase fails, no files are modified.
- [ ] **AC2 — Regression test:** A test forces a failure during the compute phase (e.g. a compiler stub that throws on `getEditsForFileRename` for the second file) and asserts every file is still at its original path with original content.
- [ ] **AC3 — Happy path unchanged:** Successful `moveDirectory` returns the same result shape (`filesMoved`, `filesModified`, `filesSkipped`, `oldPath`, `newPath`), moves all files, and reports all modified files. Existing tests pass without changes.

## Security

- **Workspace boundary:** N/A — the fix doesn't change which files are read or written, only the order of operations. `WorkspaceScope` enforcement is unchanged.
- **Sensitive file exposure:** N/A — no change to file content reading.
- **Input injection:** N/A — no change to how user-supplied strings are handled.
- **Response leakage:** N/A — no change to error messages or response fields.

## Relevant files

| File | Why |
|------|-----|
| `src/operations/moveDirectory.ts` (109 lines) | Primary fix target — the loop that needs two-phase restructuring |
| `src/operations/moveFile.ts` (48 lines) | Called by `moveDirectory` for Vue files; its `getEditsForFileRename` → apply pattern is the model for the compute/commit split |
| `src/domain/workspace-scope.ts` (57 lines) | Tracks modified/skipped files; `writeFile` and `recordModified` are the mutation points |
| `src/ports/filesystem.ts` | `FileSystem` interface — `rename`, `writeFile`, `mkdir` are the mutation surface |
| `tests/operations/moveDirectory_tsMorphCompiler.test.ts` (293 lines) | Existing test file — near the 300-line review threshold; AC2 adds a new test here |

## Red flags

- **Test file near threshold:** `moveDirectory_tsMorphCompiler.test.ts` is 293 lines. Adding AC2's regression test will push it over 300. Assess whether any existing tests can be tightened (e.g. the two intra-directory import tests at lines 197-228 overlap significantly) before adding new ones.

## Edges

- **Vue + TS mixed directory:** The compute phase must handle both Vue files (which need `compiler.getEditsForFileRename`) and non-Vue files (which currently just do `fs.rename`). Both paths must be deferred to the commit phase.
- **Empty directory:** Still returns empty arrays, no error. No change from current behaviour.
- **Pre-validation errors (FILE_NOT_FOUND, NOT_A_DIRECTORY, MOVE_INTO_SELF, DESTINATION_EXISTS):** These already throw before the loop — no change needed. They are naturally in the "compute phase."
- **SKIP_DIRS and symlinks:** Enumeration filtering happens before the loop — no change needed.
- **Existing `moveFile` callers:** `moveFile` itself is not changed. Only `moveDirectory`'s usage of it is restructured.

## Done-when

- [ ] All fix criteria (AC1-AC3) verified by tests
- [ ] Mutation score >= threshold for `moveDirectory.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (no public surface change expected)
- [ ] Tech debt discovered during investigation added to handoff.md as `[needs design]`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
