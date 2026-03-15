# moveFile via VolarCompiler doesn't rewrite moved file's own imports

**type:** bug
**date:** 2026-03-15
**tracks:** handoff.md # moveFile-extraproject-imports

---

## Symptom

When `moveFile` moves a file outside `tsconfig.include` (tests, scripts, config) to a different directory depth, the moved file's own relative import specifiers are not rewritten. The import paths still reference the old relative location, which no longer resolves from the new directory.

This affects any project where the daemon routes through VolarCompiler — currently triggered by `isVueProject` returning true.

```
input:    moveFile("tests/counter.test.ts", "src/counter.test.ts")
          file contains: import { useCounter } from "../src/composables/useCounter"
actual:   import specifier unchanged: "../src/composables/useCounter"
expected: import specifier rewritten to "./composables/useCounter"
```

Additionally, `isVueProject` returns false positives for pure TS projects that contain `.vue` test fixtures (e.g. this repo), routing all operations through VolarCompiler unnecessarily.

## Value / Effort

- **Value:** High. Any Vue project user moving test files or scripts between directories gets silently broken imports. The workaround (manual `replaceText` to fix each import path) requires the agent to compute correct relative paths — exactly the kind of foresight agents lack. The tool description claims this works ("Works for non-source files (tests, scripts, config) too"), making the breakage unexpected. Additionally, the `isVueProject` false positive means pure TS projects with `.vue` fixtures (like this repo) are also affected.
- **Effort:** Low. The root cause is clear and the fix is localised to two files. TsMorphCompiler already has the correct fallback pattern in `afterFileRename` (lines 270-305 of `ts.ts`) — the VolarCompiler needs the same pass for the moved file's own imports. `isVueProject` needs to scope its search to the tsconfig's include patterns.

## Expected

When a file outside `tsconfig.include` is moved to a different directory depth via VolarCompiler, all relative import and re-export specifiers inside that file are rewritten to preserve correct resolution from the new location.

```
input:    moveFile("tests/counter.test.ts", "src/counter.test.ts")
          file contains: import { useCounter } from "../src/composables/useCounter"
expected: file now contains: import { useCounter } from "./composables/useCounter"
          src/counter.test.ts appears in filesModified
```

## Root cause

Two bugs compound:

1. **VolarCompiler.afterFileRename** (line 217 of `src/plugins/vue/compiler.ts`) only calls `updateVueImportsAfterMove` — it rewrites `.vue` files that import the moved file, but never rewrites the moved file's own import specifiers. TsMorphCompiler's `afterFileRename` (line 270 of `src/compilers/ts.ts`) has a fallback scan that walks all workspace TS files and rewrites specifiers pointing at the old path, but this also doesn't cover the moved file's own imports — that's handled by `getEditsForFileRename` which adds the file to the project first (`addSourceFileAtPath` at line 183). VolarCompiler's `getEditsForFileRename` (line 152) does no such addition — the Volar service doesn't know about out-of-project files, so it returns no edits for them.

2. **`isVueProject`** (line 52 of `src/utils/ts-project.ts`) uses `ts.sys.readDirectory(projectRoot, [".vue"], [], [], 1000)` which scans the entire workspace directory tree. This finds `.vue` files in `tests/fixtures/` and returns true for pure TS projects. The daemon then routes through VolarCompiler for all operations, hitting bug #1.

## Fix

### AC1: VolarCompiler rewrites the moved file's own relative imports

After the physical move, if the moved file was not already rewritten by `getEditsForFileRename` (checked via `scope.modified`), VolarCompiler's `afterFileRename` rewrites all relative import/re-export specifiers inside the moved file by adjusting them from the old directory to the new directory.

Implementation: in `afterFileRename`, after the existing `updateVueImportsAfterMove` call, check if `newPath` is in `scope.modified`. If not, parse the file with an in-memory ts-morph Project (same pattern as TsMorphCompiler's fallback), resolve each relative specifier against `oldDir`, recompute from `newDir`, and write back if changed. Preserve the original extension on each specifier.

The narrowest wrong implementation: only rewriting import declarations but not re-export declarations. Both must be covered.

### AC2: Bare module specifiers and `.js` extensions are preserved

- `import { describe } from "vitest"` and `import path from "node:path"` are unchanged (non-relative specifiers skipped).
- `import { x } from "../src/foo.js"` preserves the `.js` extension: `"./foo.js"`.

The narrowest wrong implementation: stripping or converting extensions during the rewrite. The fix must preserve whatever extension the original specifier has.

### AC3: `isVueProject` scopes to tsconfig include patterns

Replace `ts.sys.readDirectory(projectRoot, [".vue"], [], [], 1000)` with a tsconfig-aware check. Use `ts.parseJsonConfigFileContent` to resolve the tsconfig's `include`/`exclude` patterns, then check if any resolved file has a `.vue` extension. This ensures only `.vue` files that are part of the project graph trigger Vue detection.

The narrowest wrong implementation: only checking `include` without applying `exclude`. Both must be respected.

### AC4: Regression — existing `.vue` import rewriting still works

Moving a `.ts` file that is imported by `.vue` SFCs still updates the `.vue` import specifiers. Existing tests in `moveFile_volarCompiler.test.ts` ("moves a composable file and updates .vue imports") must continue to pass.

## Security

- **Workspace boundary:** N/A — the fix reads and writes the moved file, which is already within the workspace boundary. No new files are accessed.
- **Sensitive file exposure:** N/A — the fix rewrites import specifier strings, not file content.
- **Input injection:** N/A — specifiers go through `path.resolve`/`path.relative` computation, no shell invocation.
- **Response leakage:** N/A — no new information surfaces in the response.

## Relevant files

| File | Why it matters |
|------|----------------|
| `src/plugins/vue/compiler.ts` (line 217) | `VolarCompiler.afterFileRename` — AC1 fix goes here |
| `src/compilers/ts.ts` (lines 270-305) | TsMorphCompiler's `afterFileRename` — reference pattern for the moved-file rewrite pass |
| `src/utils/ts-project.ts` (line 52) | `isVueProject` — AC3 fix goes here |
| `src/utils/relative-path.ts` | `toRelBase` utility — may be useful for specifier rewriting |
| `tests/operations/moveFile_volarCompiler.test.ts` | Volar integration tests — AC1/AC2/AC4 tests go here |
| `tests/utils/ts-project.test.ts` | `isVueProject` unit tests — AC3 tests go here |
| `tests/fixtures/vue-project/` | Vue fixture used by existing Volar tests |

## Red flags

- **`compiler.ts` is 224 lines** — well within limits. The `afterFileRename` addition (~20 lines) keeps it under 250.
- **Duplication with TsMorphCompiler's fallback** — both compilers will have a "rewrite moved file's own imports" pass. Consider extracting a shared helper if the logic is identical, but only if the implementations truly converge (the VolarCompiler version may differ in edge handling).

## Edges

- **Dynamic imports:** `import("../src/foo")` — not covered by `getImportDeclarations`/`getExportDeclarations`. Pre-existing limitation, out of scope.
- **`require()` calls:** Not returned by the AST query. Pre-existing limitation, out of scope.
- **Moving into vs. within vs. out of tsconfig include:** AC1 handles all three — the rewrite is based on directory change, not project membership.
- **Same-directory rename:** Moving `tests/a.test.ts` to `tests/b.test.ts` should be a no-op (specifiers resolve identically).
- **Type-only imports:** `import type { X } from "../src/foo"` — covered by `getImportDeclarations()`.
- **Side-effect imports:** `import "../src/setup"` — has a module specifier, must be rewritten.

## Open decisions

### Should the moved-file rewrite logic be shared between TsMorphCompiler and VolarCompiler?

TsMorphCompiler's `afterFileRename` already has an existing fallback pass that rewrites OTHER files' imports pointing at the moved file. The new pass rewrites the MOVED file's own imports — a different concern. Both compilers need this second pass.

**Approach A:** Extract a shared function (e.g. `rewriteMovedFileOwnImports(oldPath, newPath, scope)`) in a utility module. Both compilers call it from `afterFileRename`.

**Approach B:** Inline the logic in each compiler's `afterFileRename`. Accept the duplication since the surrounding context differs (VolarCompiler also calls `updateVueImportsAfterMove`; TsMorphCompiler also does the "other files" fallback scan).

**Recommendation:** Approach A. The logic is identical — parse with in-memory ts-morph, iterate declarations, recompute relative specifiers, write back. ~15 lines. Duplication here would be a maintenance hazard since a bug fix in one compiler would need to be replicated in the other.

## Done-when

- [ ] All fix criteria (AC1-AC4) verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed — update `docs/features/moveFile.md` if it references Vue-specific limitations
- [ ] Tech debt discovered during investigation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
