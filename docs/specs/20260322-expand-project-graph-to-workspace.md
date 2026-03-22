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

## Open decisions

### Where does TsMorphEngine get the workspace root?

`getProject(filePath)` currently derives the project from the tsconfig path alone. To walk workspace files, it needs a root directory.

- **(a) Constructor parameter.** `new TsMorphEngine(workspaceRoot)`. Clean, explicit, set once at daemon startup. Matches VolarEngine's pattern where `buildVolarService` already derives a `projectRoot`.
- **(b) Derive from tsconfig location.** Use `path.dirname(tsConfigPath)` as the walk root. No interface change, but assumes tsconfig is at the workspace root — wrong for monorepos where tsconfig lives in a subdirectory.
- **(c) Thread `scope.root` into `getProject()`.** Pass the workspace root per-call from the operation layer. More explicit but adds a parameter to every call chain.

**Recommendation: (a).** The daemon already knows the workspace root. The engine is created once per daemon lifetime. Making it a constructor parameter is honest about the dependency and requires no per-call threading.

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
