# `rename` / `findReferences` / `getDefinition` fail with "Could not find source file" on `.ts` inputs

**type:** bug
**date:** 2026-03-14
**tracks:** handoff.md # rename-findReferences-getDefinition-source-file-not-found

---

## Symptom

When a caller-supplied file path differs from ts-morph's internally normalized path (e.g. because the workspace root passes through a symlink), `rename`, `findReferences`, and `getDefinition` fail with a TS language service error: "Could not find source file."

The operations succeed when the caller-supplied path happens to match ts-morph's internal path (no symlinks involved).

```
input:    findReferences(compiler, "/tmp/ns-simple-ts-abc123/src/utils.ts", 1, 17)
          (where /tmp is a symlink to /private/tmp on macOS)
actual:   TS language service error — "Could not find source file: /tmp/ns-simple-ts-abc123/src/utils.ts"
expected: references returned successfully
```

This does not affect `getEditsForFileRename`, which already resolves symlinks before calling the language service (lines 184-198 of `ts.ts`).

## Value / Effort

- **Value:** High. These are three of the most-used read/write operations. Any environment where the workspace path traverses a symlink (macOS `/tmp` -> `/private/tmp`, Docker volume mounts, pnpm workspaces with symlinked packages) triggers the bug. There is no workaround short of resolving the symlink before calling the tool, which agents have no reason to do.
- **Effort:** Low. The fix is a one-line change in each of three methods, plus `resolveOffset` for consistency. The pattern already exists in `getEditsForFileRename`. Test fixtures already use `os.tmpdir()` via `copyFixture()`, so the bug may be reproducible in existing CI environments where `/tmp` is symlinked. If not, a test can create an explicit symlink.

## Expected

Operations should succeed regardless of whether the caller-supplied path traverses symlinks. The caller-supplied path should be used in error messages and response payloads (so the caller recognizes it); the ts-morph-normalized path should be used only for internal language service calls.

## Root cause

In `TsMorphCompiler` (`src/compilers/ts.ts`), four methods — `resolveOffset`, `getRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` — follow this pattern:

```typescript
let sourceFile = project.getSourceFile(file);
if (!sourceFile) {
  sourceFile = project.addSourceFileAtPath(file);
}

const ls = project.getLanguageService().compilerObject;
const result = ls.someMethod(file, offset, ...);  // BUG: uses raw `file`
```

When `project.addSourceFileAtPath(file)` loads a file, ts-morph internally resolves the path (via `fs.realpathSync` in its `FileSystemWrapper`). The `SourceFile` is stored under the resolved path. The TS language service host also uses resolved paths in its `getScriptFileNames()`.

When the raw (un-resolved) `file` string is then passed to `ls.getRenameInfo(file, ...)`, `ls.findRenameLocations(file, ...)`, `ls.getReferencesAtPosition(file, ...)`, or `ls.getDefinitionAtPosition(file, ...)`, the language service cannot find the file because its internal map is keyed by the resolved path.

`resolveOffset` does not call the language service directly — it uses `sourceFile.compilerNode.getPositionOfLineAndCharacter(...)` — so it works correctly. However, it should still be hardened for consistency, because future callers might extract the file path from it.

The fix in `getEditsForFileRename` (lines 184-198) already demonstrates the correct approach: resolve symlinks before calling language service methods. For these three methods, the simplest and most correct fix is to use `sourceFile.getFilePath()` — which returns the path as ts-morph knows it — when calling into the language service, rather than the raw caller-supplied `file` string.

## Fix

- [ ] **AC1:** In `getRenameLocations`, use `sourceFile.getFilePath()` (not the raw `file` parameter) when calling `ls.getRenameInfo()` and `ls.findRenameLocations()`.
- [ ] **AC2:** In `getReferencesAtPosition`, use `sourceFile.getFilePath()` when calling `ls.getReferencesAtPosition()`.
- [ ] **AC3:** In `getDefinitionAtPosition`, use `sourceFile.getFilePath()` when calling `ls.getDefinitionAtPosition()`.
- [ ] **AC4:** Regression test: create a symlink to a fixture directory, call `findReferences` (or `rename`, or `getDefinition`) using the symlinked path. Assert it returns results successfully. This test must fail before the fix and pass after.
- [ ] **AC5:** Response payloads (`fileName` fields in returned `SpanLocation[]` / `DefinitionLocation[]`) contain the ts-morph-normalized path (this is what the language service returns, and it is correct — it points to the real file). The test should assert the returned paths are usable (file exists at that path), not that they match the symlinked input path.

**Narrowest-fix check:** A fix that only patches `getRenameLocations` but not `getReferencesAtPosition` or `getDefinitionAtPosition` would leave two of the three operations broken. AC2 and AC3 prevent this. A fix that only changes the language service call but not the test would pass CI without proving the bug was real. AC4 prevents this.

**Adjacent inputs:** The `resolveOffset` method does not pass `file` to the language service, so it is not affected. However, verify in the test that `resolveOffset` also works with symlinked paths (it should, since it uses `sourceFile.compilerNode` directly).

## Security

- **Workspace boundary:** N/A. The fix does not change how files are read or written. `isWithinWorkspace` is called upstream (in `dispatcher.ts`) before the compiler methods are reached, and it already resolves symlinks via `realpathSync`.
- **Sensitive file exposure:** N/A. The fix does not change which files are read — only which path string is passed to the language service for lookup.
- **Input injection:** N/A. The fix replaces one path string with another derived from the same file. No new user input reaches the filesystem or shell.
- **Response leakage:** The response paths will contain the realpath'd version of the file (e.g. `/private/tmp/...` instead of `/tmp/...`). This is the same behaviour as `getEditsForFileRename` today and does not leak additional information.

## Edges

- **VolarCompiler:** Does this bug also affect the Volar compiler? Check whether `VolarCompiler` has the same pattern. If so, note it but do not fix it in this spec — it has its own path translation layer (virtual/real) and should be investigated separately.
- **`getEditsForFileRename`:** Already fixed — uses `realpathSync`. Verify the test does not regress.
- **`refreshFile`:** Uses `project.getSourceFile(filePath)` but does not call the language service. Not affected, but note that `getSourceFile` may return `undefined` for a symlinked path if the project stores the resolved path. This is a separate (silent) issue — `refreshFile` already handles `undefined` with an early return.
- **Happy path:** The fix must not break non-symlinked paths. `sourceFile.getFilePath()` returns the path as stored by ts-morph — for non-symlinked paths, this should be identical to the input. The test should include both symlinked and non-symlinked cases.

## Relevant files

| File | Why |
|------|-----|
| `src/compilers/ts.ts` | Contains all four affected methods; this is where the fix goes |
| `src/operations/rename.ts` | Calls `resolveOffset` + `getRenameLocations` via the `Compiler` interface |
| `src/operations/findReferences.ts` | Calls `resolveOffset` + `getReferencesAtPosition` |
| `src/operations/getDefinition.ts` | Calls `resolveOffset` + `getDefinitionAtPosition` |
| `tests/compilers/ts.test.ts` | Existing compiler tests (222 lines — under threshold); symlink test should go here |
| `tests/helpers.ts` | `copyFixture` uses `os.tmpdir()` — symlink test will extend this pattern |
| `src/daemon/dispatcher.ts` | Upstream path handling; resolves workspace boundary before dispatch |

## Red flags

None. `ts.ts` is 365 lines (above 300 review threshold) but the fix is surgical — no new abstractions needed. The file's size is driven by the number of language service methods it wraps, which is inherent to its responsibility.

## Done-when

- [ ] All fix criteria (AC1-AC5) verified by tests
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (use `docs/specs/templates/feature.md` for new feature docs)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
