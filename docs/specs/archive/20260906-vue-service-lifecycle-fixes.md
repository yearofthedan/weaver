# Vue service lifecycle fixes

**type:** change
**date:** 2026-09-06
**tracks:** handoff.md — "VolarEngine.invalidateService misses the project-wide service", "Post-write diagnostics skip .vue files entirely", "A solution-style root tsconfig.json disables the Vue plugin"

---

## Context

Three bugs converge on one path: the daemon holding and refreshing the Volar service. Each independently produces wrong answers for `.vue` users; together they decide whether a refactor that touches an SFC is observable.

## User intent

*As a developer using weaver on a Vue project, I want every operation that modifies a `.vue` file (or a file a `.vue` file imports) to report the resulting type errors, so that I never ship a broken component through a silent success.*

## Relevant files

- `src/plugins/vue/engine.ts` — VolarEngine service cache (cacheKey at `:51-57`, getService at `:71-86`, invalidateService at `:88-91`)
- `src/daemon/post-write-diagnostics.ts` — extension filter at `:7` skips `.vue`, body at `:18-52` delegates per-file checking to `engine.getTypeErrors`
- `src/utils/ts-project.ts` — `isVueProject` at `:68-87` gates Vue plugin registration on `parsed.fileNames.some(.endsWith(".vue"))`; `resetDiscoveryCaches` at `:94-97` clears `vueProjectCache` per dispatch
- `src/plugins/vue/plugin.ts` — `supportsProject` at `:9-11` delegates to `isVueProject`
- `src/daemon/language-plugin-registry.ts` — `makeRegistry` at `:56-76` selects engine; `:66-73` skips all plugins when `tsConfigPath` is null, so VolarEngine is never created in no-tsconfig workspaces via the dispatcher
- `src/plugins/vue/service.ts` — `buildVolarService` at `:132-274`
- `src/ts-engine/get-type-errors.ts` — `tsGetTypeErrors` at `:97` → `tsGetTypeErrorsForFile` at `:58` throws when a file is not in the ts-morph program (probed: `Could not find source file` for `.vue` paths)
- `src/daemon/dispatcher.ts` — post-write diagnostics call site at `:411-418`; `resetDiscoveryCaches` at `:338` per dispatch
- `src/plugins/vue/engine.test.ts` — 641 lines, under threshold
- `src/daemon/post-write-diagnostics.test.ts` — `:25-37` ("silently skips non-.ts files") and `:129-147` ("skips a non-TS file that exists") both assert `.vue` files are excluded from `typeErrors`; these tests land in `82564e1` (2026-08-31) and carry the comment "must never be checked"
- `src/daemon/dispatcher-vue-routing.test.ts` — existing Vue-engine routing tests (has `vue-errors` fixture coverage)

### Red flags

- `post-write-diagnostics.test.ts:25-37` and `:129-147` deliberately pin the `.vue` skip as intended behaviour — they assert `typeErrors: []` for `.vue` files and carry comments stating `.vue` "must never be checked." AC2 removes that guard, so these tests must be replaced. Their replacement tests a `.vue` file that arrives through a VolarEngine and asserts diagnostics *are* returned.
- **Test hotspot:** `src/plugins/vue/engine.test.ts` is 641 lines — well under threshold. Add new tests beside existing ones.
- **Layer-fit:**
  - AC1 (invalidateService key): latent defect (unreachable through dispatcher) — unit test driving VolarEngine directly.
  - AC2 (.vue post-write): wiring integration — `dispatcher-post-write-diagnostics.test.ts` with a Vue fixture exercising the full dispatcher → `getTypeErrorsForFiles` → VolarEngine path.
  - AC3 (tsconfig gate): integration — `dispatcher-vue-routing.test.ts` with an inline fixture matching the solution-style layout.

## Value / Effort

- **Value:** Every weaver operation on a Vue project that currently returns `status: success` while a `.vue` component is broken will instead report the error.
- **Effort:** Three fixes, each touching one function. No new public surface. Total source files touched: 3 (`engine.ts` cache key, `post-write-diagnostics.ts` filter, `get-type-errors.ts` empty-result guard). 2–3 test files.

## Behaviour

### AC1 — invalidateService drops the project-wide service in no-tsconfig workspaces (latent)

`cacheKey` produces `__no_tsconfig__:<root>` for project-wide `getService(undefined, root)` calls, and `__no_tsconfig__:<dirname(filePath)>` for `invalidateService(filePath)`. The two never agree. **Probed 2026-09-07:** this is latent — `makeRegistry` (`language-plugin-registry.ts:66-73`) skips plugins when `tsConfigPath` is null, so VolarEngine is never created in a no-tsconfig workspace through the dispatcher. The project-wide `__no_tsconfig__` entry is only reachable via direct engine calls (tests). The fix closes a latent mismatch so the two paths cannot diverge if VolarEngine is ever selected for a no-tsconfig workspace in the future.

- [ ] Given a VolarEngine constructed directly, call `getService(undefined, root)` to populate the cache with a project-wide entry, then call `invalidateService(filePath)` — the project-wide entry is removed.

### AC2 — post-write diagnostics check .vue files

`getTypeErrorsForFiles` filters `filesModified` to `.ts`/`.tsx` only, dropping `.vue` entries. The dispatcher already routes post-write diagnostics through the project engine, which in a Vue project is VolarEngine.

Widen `TS_FILE_EXTENSIONS` to `[".ts", ".tsx", ".vue"]`. **Probed 2026-09-07:** TsMorphEngine throws `Could not find source file` when handed a `.vue` path via `getTypeErrors` — `tsGetTypeErrorsForFile` (`get-type-errors.ts:58`) reaches `getSourceFile()` which throws because `.vue` is not in the ts-morph program. The fix: `tsGetTypeErrors` returns empty diagnostics for files not in the program, instead of throwing. This makes widening safe — TsMorphEngine returns empty (file type it cannot check), VolarEngine returns real diagnostics. No-tsconfig Vue projects (where the dispatcher currently selects TsMorphEngine) return empty `.vue` results rather than throwing.

- [ ] Given a Vue project fixture where a `.vue` file has a type error, a mutating operation that modifies that `.vue` file (resulting in `filesModified` containing it) returns `status: warn` with that `.vue` file's diagnostic in `typeErrors`.
- [ ] Given a non-Vue (TS-only) project, a non-TS `.vue` file listed in `filesModified` does not cause a throw — `tsGetTypeErrors` returns empty diagnostics for it.

### AC3 — solution-style root tsconfig with references does not disable Vue

`isVueProject` returns `false` when `parsed.fileNames` is empty (the `{"files":[], "references":[...]}` case), so `supportsProject` returns false and the dispatcher selects TsMorphEngine — which cannot process `.vue` files.

**Probed 2026-09-07:** `ts.parseJsonConfigFileContent` returns `projectReferences` with absolute paths when the config has `references`. `extraFileExtensions: [{ extension: ".vue", ... }]` (already passed at `ts-project.ts:82`) makes `include: ["src/**/*"]` match `.vue` files, so the handoff entry's stated failure mode ("referenced configs may use include patterns without explicit .vue entries") does not occur. Following references costs one `readConfigFile` + `parseJsonConfigFileContent` per reference — cheaper than a disk walk.

- [ ] Given a workspace with a root `tsconfig.json` using `{"files":[], "references":[{"path":"./tsconfig.app.json"}]}` where `tsconfig.app.json`'s `include` covers `.vue` files, `dispatchRequest` with `method: "getTypeErrors", params: { file: "src/App.vue" }` returns `status: "success"` with at least one diagnostic from that file (not `INTERNAL_ERROR` and not an empty `diagnostics` array).

## Structural criteria

(none)

## Interface

No new public surface. No new parameters, response fields, or error codes.

- **Post-write diagnostics**: `filesModified` already includes `.vue` paths — the change only makes the check look at them. The `typeErrors` array gains entries with `file` pointing at `.vue` paths, which is already valid per the `TypeDiagnostic` type.
- **Engine routing**: `makeRegistry` and `supportsProject` are internal — the caller sees the same `get-type-errors` response shape with the same status field, just `success` instead of `INTERNAL_ERROR`.
- **TsMorphEngine.getTypeErrors**: gains the ability to return empty diagnostics for a file not in its program, instead of throwing. Existing behaviour for `.ts`/`.tsx` files in the program is unchanged.

## Open decisions

All decisions resolved with probe evidence 2026-09-07.

### AC1: how should invalidateService reach the project-wide key? (resolved)

- **Chosen:** Drop every `__no_tsconfig__:` key in the cache when `invalidateService` is called (Option A — sweep by prefix).
- **Reason:** `this.workspaceRoot` exists but the code comments warn it reflects whichever workspace first constructed the cached engine and isn't guaranteed current — so keying on it would be wrong for the same reason `getService` takes `root` per call. Dropping by prefix avoids depending on any stored value and works with the existing caller signatures. The over-eviction (dropping per-directory entries for sibling directories) is harmless — those rebuild lazily on next query, and the bug is latent regardless.
- **Consequences:** No-tsconfig workspaces lose more service entries than necessary on each invalidation, but service rebuild is cheap and this path is not hit through the dispatcher.

### AC2: how does the post-write check handle .vue paths? (resolved)

- **Chosen:** Widen `TS_FILE_EXTENSIONS` unconditionally to `[".ts", ".tsx", ".vue"]`. Make `tsGetTypeErrors` return empty diagnostics for files not in the ts-morph program (instead of throwing `Could not find source file`).
- **Reason (probed):** TsMorphEngine throws on `.vue` paths — the existing `getSemanticDiagnostics` call fails because `.vue` is not in the program. Returning empty is the correct answer: a file type the engine cannot check has no type errors *from that engine*. No new `Engine` capability, no `instanceof` check, no public surface change. Existing `.ts`/`.tsx` behaviour is unchanged.
- **Consequences:** `TsMorphEngine.getTypeErrors` on a `.vue` path returns `{ diagnostics: [], errorCount: 0 }`. This is only reached when the dispatcher selects TsMorphEngine for a project containing `.vue` files — which AC3 fixes. No-tsconfig Vue projects (unfixed by AC3) still get TsMorphEngine but `.vue` diagnostics return empty rather than throwing.

### AC2: what does checking .vue files cost on a move touching many SFCs? (resolved)

The handoff entry posed this cost question directly. A move that touches N `.vue` files adds N per-file `getTypeErrors` calls through VolarEngine. Each call is `vueGetTypeErrorsForFile`, which builds a service lazily if no cached one exists. On a warm service this is fast — the service is already loaded — so N warm checks are O(N × diagnostic time per file), not O(N × service build). Cold (first dispatch after a write) adds one service build regardless of N. This is the same cost model that `.ts` post-write checks already pay.

### AC3: how to detect Vue in a solution-style tsconfig (resolved)

- **Chosen:** Gate on `files` empty + `references` non-empty, then follow references (Option 4 gate + Option 2 body).
- **Reason (probed):** `ts.parseJsonConfigFileContent` returns `projectReferences` with absolute paths. `extraFileExtensions` already passed at `ts-project.ts:82` makes `include: ["src/**/*"]` match `.vue`, so the handoff's stated failure mode does not occur. One `readConfigFile` + `parseJsonConfigFileContent` per reference is cheaper than any disk walk and matches `tsc` semantics. The gate (`files` empty + `references` non-empty) means TS-only projects with normal tsconfigs pay nothing extra — the existing `fileNames.some()` check runs as before. Disk scan is unnecessary.
- **Consequences:** `isVueProject` gains one branch before the `parsed.fileNames.some()` check. Existing memoisation (`vueProjectCache`) covers the extra work per tsconfig path.

## Security

- **Workspace boundary:** N/A — no new file reads or writes.
- **Sensitive file exposure:** N/A — no new file content is read or returned.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** `.vue` file diagnostics already appear in `get-type-errors` responses (single-file mode). Post-write diagnostics now includes them too, following the same schema and cap.

## Edges

- **Non-Vue projects are unaffected.** `getTypeErrorsForFiles` with a TsMorphEngine may receive `.vue` paths if the dispatcher selects the wrong engine — `tsGetTypeErrors` now returns empty for non-program files instead of throwing.
- **Existing scenario files for `get-type-errors` and `moveFile` remain valid.** AC2 does not change the shape of any response field.
- **`filesModified` may name a non-existent path.** This is a pre-existing defect tracked separately in handoff.md. `scope.fs.exists(f)` at `post-write-diagnostics.ts:25` already skips missing files before any extension check.
- **`scope.fs.exists` for `.vue` files in post-write diagnostics.** `exists` returns the same result for `.vue` as for `.ts` — the file is on disk. The existing filter already handles this via `:25`.

## Done-when

- [ ] All ACs verified by tests
- [ ] `post-write-diagnostics.test.ts:25-37` and `:129-147` replaced with tests that assert `.vue` diagnostics are returned via VolarEngine (and empty via TsMorphEngine for non-program files)
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated if public surface changed: none
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule
- [ ] handoff.md entries for the three bugs removed
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Verification:** `pnpm check` — lint, build, 1442 unit tests, 531 eval tests, both typecheck projects — all green. Targeted mutation on `get-type-errors.ts` scored 98.18% (pre-existing survivor at line 79). `ts-project.ts` scored 95.65% (cache set+return at line 107 marked noise — unobservable after the immediate return).

**Reflection:** Good: the three ACs split cleanly. The decisions moved from prose assertions to probes — `projectReferences` resolved, TsMorphEngine throw confirmed, engine reachability traced. Bad: the initial AC2 implementation shipped a false-clean on the public `get-type-errors` command and killed two regression tests for the parse-cache eviction. The `handlesFileExtension` capability was the correct fix — gate the filter, not the engine contract.

**Implementation notes:**
- AC1 closes a latent mismatch (VolarEngine unreachable without tsconfig through dispatcher). The test drives VolarEngine directly.
- AC3 follows project references; directory-style references (`{"path": "./packages/app"}`) are not handled — `readConfigFile(ref.path)` fails on a directory. `ts.resolveProjectReferencePath` is the fix. Deferred to handoff.
- AC3 skips the reference walk when `files` is non-empty alongside `references`. Running the normal check first then references as fallback would cover that shape too. Deferred.

**Tests added:** 8 (4 source, 4 test files touched)
**Mutation score:** get-type-errors.ts 98.18%, ts-project.ts 95.65%
**Commits:** ea5d3ba (AC1), 422fcec/08bc1c8 (AC2), e982bc8 (AC3)