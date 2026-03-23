# Expand project graph to full workspace scope

**type:** change
**date:** 2026-03-22
**tracks:** handoff.md # rename-misses-out-of-project → docs/features/rename.md

---

## Context

Both engines (`TsMorphEngine` and `VolarEngine`) use `tsconfig.include` as their file scope. But `tsconfig.json` is a build config — it controls what goes into `dist/`, not what a refactoring tool should see. Test files, scripts, and other files excluded from `tsconfig.include` are invisible to the compiler, so operations like `rename` and `findReferences` silently miss them. Several operations (`moveSymbol`, `removeImportersOf`, `afterFileRename`) already bolt on per-operation fallback workspace walks to compensate, creating duplicated logic that's easy to forget when adding new operations.

## User intent

*As an agent using rename or findReferences, I want all workspace files to be covered, so that I don't silently get partial results and have to discover and fix missed references manually.*

## Relevant files

- `src/ts-engine/engine.ts` — `TsMorphEngine.getProject()` (lines 32-48): creates `Project` from tsconfig; main target for expansion
- `src/plugins/vue/service.ts` — `buildVolarService()` (lines 129-245): creates Volar project; already walks disk for `.vue` files (lines 168-175); generalize to TS/JS
- `src/ts-engine/rename.ts` — `tsRename()`: operation that surfaces the bug; no changes needed if bootstrap is fixed
- `src/plugins/vue/engine.ts` — `VolarEngine.rename()`: same gap; fixed by bootstrap change
- `src/utils/file-walk.ts` — `walkFiles()`: existing workspace walker using `git ls-files`
- `src/utils/extensions.ts` — `TS_EXTENSIONS`, `VUE_EXTENSIONS`: extension sets for walking
- `src/__testHelpers__/fixtures/simple-ts/` — existing fixture with `tests/utils.test.ts` outside tsconfig.include; ready for regression test
- `src/ts-engine/rename.test.ts` (193 lines) — existing rename tests; regression test adds here

### Red flags

- **Per-operation fallback walks are duplicated boilerplate.** `moveSymbol` (engine.ts:210-211), `removeImportersOf`, `afterFileRename` each walk the workspace independently. Once the project graph is expanded, these become dead code. Track removal as follow-up — not in scope here.

## Value / Effort

- **Value:** `rename` updated 5 of ~76 locations in a real case, with no indication the rest were missed. The agent had to discover and fix 71 references manually. This is the tool's core promise — compiler-aware refactoring — failing silently. Every reference-graph operation (`rename`, `findReferences`, and indirectly `moveFile` via `getEditsForFileRename`) has the same blind spot. Fixing the bootstrap fixes all of them at once.
- **Effort:** Two files touched for the core fix (`engine.ts`, `service.ts`). The pattern already exists in `service.ts` for `.vue` files — this generalizes it. The open decision is where the workspace root comes from, since `TsMorphEngine.getProject()` currently only knows about file paths. Low-medium effort; no new abstractions needed.

## Behaviour

Prerequisite: write failing tests for AC1 and AC2 before implementing either fix. Confirm they fail against the current code, then make them pass.

- [ ] **AC1: TsMorphEngine includes all workspace TS/JS files in the project graph.** Given a workspace with `tsconfig.json` including `src/**/*.ts` and a `tests/` directory outside that include, `getProject()` adds files from `tests/` to the project. Verified by: rename of `greetUser` in the `simple-ts` fixture updates `tests/utils.test.ts`; `findReferences` on `greetUser` returns a location in `tests/utils.test.ts`.

- [ ] **AC2: VolarEngine includes all workspace TS/JS files in the Volar project.** `buildVolarService()` generalizes the existing `.vue` disk-walk to also include `.ts`/`.tsx`/`.js`/`.jsx` files from the workspace. Verified by: rename and findReferences in a Vue project cover `.ts` files outside `tsconfig.include`.

## Interface

No public interface changes. `RenameResult`, `FindReferencesResult`, and tool descriptions remain the same. The change is internal — the project graph is wider, so existing operations return more complete results.

The one internal interface change: `TsMorphEngine` needs access to the workspace root. See open decision below.

## Resolved decisions

### Where does TsMorphEngine get the workspace root?

**Chosen: (a) Constructor parameter.** `new TsMorphEngine(workspaceRoot)`.

**Reasoning:** The `TsMorphEngine` singleton is created once per daemon lifetime in `language-plugin-registry.ts` via `getTsMorphEngine()`. The daemon already knows the workspace root and passes it through `dispatchRequest` → `makeRegistry`. Threading it one level deeper to `getTsMorphEngine(workspaceRoot)` → `new TsMorphEngine(workspaceRoot)` is minimal and explicit.

**Implementation detail:** In `getProject()`, after creating the `Project` from tsconfig, call `walkFiles(this.workspaceRoot, [...TS_EXTENSIONS])` and `addSourceFileAtPath` for each file not already in the project. The walk root is `this.workspaceRoot` (not `path.dirname(tsConfigPath)`) because the workspace root is the correct boundary — it includes `tests/`, `scripts/`, etc. that live alongside `src/`. For monorepo subprojects that already have their own tsconfig, `getProject` already caches per-tsconfig, so each subproject gets its own expansion.

**Changes needed:**
1. `TsMorphEngine` constructor: accept `workspaceRoot: string`, store as field
2. `getProject()` / `getProjectForDirectory()`: after creating a new project, walk `this.workspaceRoot` for TS/JS files and add any not already in the project
3. `language-plugin-registry.ts`: `getTsMorphEngine(workspaceRoot)` passes to constructor; `makeRegistry(filePath, workspaceRoot)` passes to `getTsMorphEngine`
4. `dispatcher.ts`: `makeRegistry(filePath, workspace)` passes workspace root

## Security

- **Workspace boundary:** No change. `scope.contains()` still gates all writes. The expansion only affects what the compiler *sees* for analysis, not what gets written.
- **Sensitive file exposure:** N/A. Only source files (`.ts`, `.js`, `.vue`) are added; sensitive files (`.env`, credentials) have different extensions and are not walked.
- **Input injection:** N/A. No new user-supplied strings introduced.
- **Response leakage:** N/A. Response shape unchanged.

## Edges

- **Performance:** `walkFiles` uses `git ls-files` (fast) and runs once per project creation (cached for daemon lifetime). Measure latency before/after; document in commit message if >100ms.
- **Files with syntax errors:** Out-of-tsconfig files may have syntax errors. `addSourceFileAtPath` handles this — the compiler parses what it can. Rename locations in parseable regions still work.
- **`getTypeErrors` sees more files:** Project-wide `getTypeErrors` will report errors in test files (e.g. missing vitest globals). This is correct — those errors exist. If noise becomes a problem, address with filtering in a future spec.
- **Monorepo nested tsconfigs:** A subdirectory with its own tsconfig already gets a separate cached project. The walk root for each project should be the tsconfig's directory, not a global workspace root. Verify this works with the `move-dir-subproject` fixture.

## Done-when

- [ ] Failing tests written and confirmed failing before fix is applied
- [ ] All ACs (AC1–AC2) verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Performance measured and documented
- [ ] `docs/features/rename.md` constraint "Files outside tsconfig.include are not updated" removed
- [ ] Follow-up `[needs design]` entry added to handoff.md for removing per-operation fallback walks
- [ ] handoff.md entry updated from `[needs design]` to spec link
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

**Tests added:** 5 (2 in `rename.test.ts` for AC1, 3 in `engine.test.ts` for AC2)

**Performance:** walkFiles + addSourceFileAtPath adds ~700ms on first project creation (cold cache, 3-file fixture). In production this runs once per daemon lifetime — negligible. `git ls-files` is the walker, so it scales well.

**Files changed:**
- `src/ts-engine/engine.ts` — constructor accepts `workspaceRoot`, `addWorkspaceFiles()` helper
- `src/plugins/vue/engine.ts` — constructor accepts `workspaceRoot`, passes to `buildVolarService`
- `src/plugins/vue/service.ts` — `buildVolarService` accepts `workspaceRoot`, walks TS/JS files
- `src/plugins/vue/plugin.ts` — `createEngine` forwards `workspaceRoot`
- `src/ts-engine/types.ts` — `LanguagePlugin.createEngine` signature updated
- `src/daemon/language-plugin-registry.ts` — `makeRegistry` and `getTsMorphEngine` accept `workspaceRoot`
- `src/daemon/dispatcher.ts` — passes `workspace` to `makeRegistry`

**Reflection:**
- What went well: The existing `walkFiles` and fixture infrastructure made this straightforward. The `simple-ts` and `vue-project` fixtures already had test files outside tsconfig.include, so no fixture changes were needed.
- What didn't go well: The AC2 rename test initially failed because the assertion `not.toContain("useCounter")` matched the module specifier path (`../../src/composables/useCounter`), not just the binding. Changed to `not.toContain("import { useCounter }")` to be precise.
- Recommendation for follow-up: The P3 entry "Remove per-operation fallback workspace walks" is now unblocked — `moveSymbol`, `removeImportersOf`, and `afterFileRename` each have their own `walkFiles` call that should now be redundant. Verify with tests before removing.
