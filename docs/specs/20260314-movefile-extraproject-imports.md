# moveFile does not rewrite imports inside a moved out-of-project file

**type:** bug
**date:** 2026-03-14
**tracks:** handoff.md # moveFile-extraproject-imports

---

## Symptom

When `moveFile` moves a file that is outside `tsconfig.include` (tests, scripts, config files) to a different directory depth, the moved file's own relative import specifiers are not updated. They still point at the old relative paths, which no longer resolve from the new location.

```
input:    moveFile("tests/utils.test.ts", "tests/unit/utils.test.ts")
          file contains: import { greetUser } from "../src/utils"
actual:   import specifier is unchanged: "../src/utils" (now resolves to nothing)
expected: import specifier rewritten to "../../src/utils"
```

The tool description claims "Works for non-source files (tests, scripts, config) too" but this case silently produces broken imports.

Note: the *other* direction -- where a source file is moved and test files that import it need updating -- already works. `afterFileRename` walks all workspace files and rewrites imports pointing to the moved file's old path, including in out-of-project files. The existing integration test at line 69 of `moveFile_tsMorphCompiler.test.ts` confirms this.

## Value / Effort

- **Value:** High. Any agent moving test files or scripts between directories gets silently broken imports. The workaround (manual `replaceText` to fix each import path) requires the agent to know which imports broke and compute correct relative paths -- exactly the kind of foresight agents lack (see `docs/agent-users.md`). The tool description actively claims this works, making the breakage unexpected.
- **Effort:** Low-moderate. The root cause is a single missing rewrite pass. The existing `afterFileRename` fallback already uses throwaway in-memory ts-morph projects for AST-based specifier rewriting -- the fix adds one more pass using the same technique, applied to the moved file's own declarations instead of other files' declarations pointing at the moved file.

## Expected

When a file outside `tsconfig.include` is moved to a different directory depth, all relative import and re-export specifiers inside that file are rewritten to preserve correct resolution from the new location.

```
input:    moveFile("tests/utils.test.ts", "tests/unit/utils.test.ts")
          file contains: import { greetUser } from "../src/utils"
expected: file now contains: import { greetUser } from "../../src/utils"
          tests/unit/utils.test.ts appears in filesModified
```

## Root cause

`TsMorphCompiler.afterFileRename` (line 270 of `src/compilers/ts.ts`) walks all workspace files and rewrites imports that point to the moved file's old path. But it never rewrites the moved file's *own* imports to other files.

The moved file's own imports are normally handled by `getEditsForFileRename` (the TS language service), but only for files in the project graph (`tsconfig.include`). Files outside the include get neither pass:

1. `getEditsForFileRename` does not know the file exists, so it produces no edits for it.
2. `afterFileRename` only rewrites specifiers matching the moved file's old path. For the moved file itself, this check asks "does any import in `tests/unit/utils.test.ts` point to `tests/utils.test.ts`?" -- no, its imports point to `../src/utils`, a completely different file.

What is needed: for the moved file specifically, rewrite all its relative import/re-export specifiers by adjusting them from the old directory to the new directory using `path.relative`.

## Fix

The fix adds a pass inside `afterFileRename` that handles the moved file (`newPath`) when it was not already rewritten by `getEditsForFileRename` (checked via the `alreadyModified` set). The pass uses the same in-memory ts-morph technique as the existing fallback: parse the file, iterate import/export declarations, recompute each relative specifier from the new directory, and write back.

Acceptance criteria:

- [ ] **AC1: moved out-of-project file has its own relative imports rewritten.** Moving `tests/a.test.ts` to `tests/unit/a.test.ts` where the file contains `import { x } from "../src/foo"` rewrites it to `import { x } from "../../src/foo"`. The file appears in `filesModified`.

- [ ] **AC2: moved out-of-project file has its own relative re-exports rewritten.** Moving a test helper that contains `export { x } from "../src/foo"` to a deeper directory rewrites the re-export specifier the same way as imports.

- [ ] **AC3: non-relative (bare) specifiers are not touched.** `import { describe } from "vitest"` and `import path from "node:path"` are unchanged.

- [ ] **AC4: .js extension imports are preserved correctly.** If the moved file contains `import { x } from "../src/foo.js"`, the rewritten specifier keeps the `.js` extension: `"../../src/foo.js"`.

- [ ] **AC5: in-project files are not double-rewritten.** If the moved file IS in `tsconfig.include`, `getEditsForFileRename` already rewrites its imports. The fix must not rewrite them again. Guard: skip `newPath` when it is in `alreadyModified`.

- [ ] **AC6: regression -- existing behaviour preserved.** Moving `src/utils.ts` to `lib/utils.ts` still rewrites imports in `tests/utils.test.ts` that point to the moved file. Existing test coverage confirms this; the fix must not regress it.

## Security

- **Workspace boundary:** The fix reads and writes the moved file, which is already within the workspace (validated by the dispatcher). No new boundary surface.
- **Sensitive file exposure:** N/A -- the fix rewrites import specifiers (path strings), not file content. It does not read files that were not already being read.
- **Input injection:** The fix processes import specifier strings from the moved file. These go through `path.relative` computation -- no shell invocation or new filesystem traversal.
- **Response leakage:** N/A -- the fix adds the moved file to `filesModified`, which already contains file paths. No new information surface.

## Edges

- **Dynamic imports:** `import("../src/foo")` with a string literal. `getImportDeclarations()` and `getExportDeclarations()` do not cover dynamic `import()` calls. Pre-existing limitation documented in `moveFile.md`. Out of scope.
- **Type-only imports:** `import type { X } from "../src/foo"` -- covered by `getImportDeclarations()`, no special handling needed.
- **Side-effect imports:** `import "../src/setup"` (no bindings) -- has a module specifier and is returned by `getImportDeclarations()`. Must be rewritten.
- **Moving to the same directory:** If `tests/a.test.ts` moves to `tests/b.test.ts`, relative specifiers resolve identically. The fix should be a no-op (recomputed specifiers match originals; no write).
- **`require()` calls:** Not returned by `getImportDeclarations`. Pre-existing limitation; out of scope.

## Relevant files

| File | Why it matters |
|------|----------------|
| `src/compilers/ts.ts` (lines 270-305) | `afterFileRename` -- the fix goes here. Contains the existing fallback scan and the in-memory ts-morph rewriting pattern to follow. |
| `src/utils/relative-path.ts` | `toRelBase` and `computeRelativeImportPath` -- path computation utilities for specifier adjustment. |
| `src/operations/moveFile.ts` | The operation function. Fix is in the compiler layer, not here, but this is the call chain. |
| `tests/operations/moveFile_tsMorphCompiler.test.ts` | Integration tests. New tests for AC1-AC5 go here. |
| `tests/fixtures/simple-ts/` | Test fixture with `tsconfig.include: ["src/**/*.ts"]` and an out-of-project test file. |

## Red flags

- **`ts.ts` is 356 lines** -- past the 300-line review threshold. `afterFileRename` is currently 35 lines. The new pass is a distinct concern (rewriting the moved file's own imports vs rewriting other files' imports to the moved file). If the result reads as two interleaved concerns in one method, extract the new pass into a private helper for clarity -- not because of line count, but because the reader should be able to see "this block handles the moved file's own specifiers" as a named unit.

- **`moveFile_tsMorphCompiler.test.ts` is 308 lines.** The existing tests are well-structured. The new tests are a natural `describe` block. No prep refactoring needed.

## Open decisions

### How to compute the rewritten specifier for the moved file's own imports?

The existing fallback uses `rewriteSpecifier` which matches a specifier against the moved file's old base path. That function does not apply here -- we need to adjust *arbitrary* relative specifiers from one directory to another.

**Approach:** For each relative specifier in the moved file:
1. Resolve it against `oldDir` (the moved file's original directory) to get the absolute target path.
2. Recompute the relative path from `newDir` (the moved file's new directory) to that absolute target.
3. If the recomputed specifier differs from the original, replace it.

This is straightforward `path.resolve` + `path.relative` with extension preservation. `computeRelativeImportPath` in `relative-path.ts` handles the relative path computation and extension mapping, but it converts TS extensions to JS extensions (`.ts` -> `.js`), which would be wrong for specifiers that already use `.ts` extensions. The executor needs to either: (a) use `computeRelativeImportPath` only when appropriate and preserve original extensions otherwise, or (b) do raw `path.relative` and preserve the original extension directly. Option (b) is simpler and more correct -- preserve whatever extension the specifier already has.

**Resolution:** Use `path.resolve(oldDir, specifier)` to get the absolute target, then `path.relative(newDir, absoluteTarget)` to get the new specifier, preserving the original extension. Ensure the result starts with `./` or `../`.

## Done-when

- [ ] All fix criteria (AC1-AC6) verified by tests
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (use `docs/specs/templates/feature.md` for new feature docs)
- [ ] Update `docs/features/moveFile.md` Constraints section to remove or qualify the "files outside tsconfig.include" caveat if it exists
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
