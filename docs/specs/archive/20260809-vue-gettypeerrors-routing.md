# `getTypeErrors` picks the wrong engine in a Vue project

**type:** bug
**date:** 2026-08-09
**tracks:** handoff.md # `getTypeErrors` picks the wrong engine in a Vue project

---

## Symptom

In a Vue project, `getTypeErrors` never routes to `VolarEngine`, regardless of whether a `file` param is given:

- With `file` pointing at a `.vue` file: throws `Could not find source file: '<path>.vue'` instead of returning diagnostics.
- With no `file` (project-wide check): returns `status: "success"` with a diagnostics list that silently omits every `.vue` file's errors — no error, no indication anything was skipped.

## Value / Effort

- **Value:** `getTypeErrors` is a core weaver operation. On any Vue project it either crashes (single-file call) or returns a confidently wrong, incomplete result (project-wide call) — the second case is worse, since nothing in the response signals that Vue diagnostics are missing. No workaround short of not using the tool for Vue projects, which defeats its purpose.
- **Effort:** Root cause fully isolated and reproduced firsthand; the fix is two small, localised changes verified working end-to-end before writing this spec. No new infrastructure required.

```
input:    dispatchRequest({ method: "getTypeErrors", params: { file: "<workspace>/src/Broken.vue" } }, workspace)  [Vue project]
actual:   throws EngineError-wrapped "Could not find source file: '<workspace>/src/Broken.vue'."
expected: { status: "success", diagnostics: [...Broken.vue's real type errors...], errorCount: 1, truncated: false }

input:    dispatchRequest({ method: "getTypeErrors", params: {} }, workspace)  [Vue project, mixed .ts + .vue errors]
actual:   { status: "success", diagnostics: [...only the .ts file's errors...], errorCount: 1, truncated: false }  — .vue errors silently missing
expected: { status: "success", diagnostics: [...ts errors..., ...vue errors...], errorCount: 2, truncated: false }
```

## Expected

Both calls above route through `VolarEngine` when the workspace is a Vue project (has a tsconfig whose file set includes at least one `.vue` file), exactly like every other operation already does. The single-file call returns that file's real diagnostics instead of throwing. The project-wide call returns diagnostics for both `.ts` and `.vue` files, not just `.ts`.

## Root cause

One mechanism, two call paths.

`findTsConfigForFile(filePath)` (`src/utils/ts-project.ts:42-44`) assumes its argument is a file: it calls `findTsConfig(path.dirname(path.resolve(filePath)))`. That's correct when `filePath` really is a file — but `dispatchRequest` (`src/daemon/dispatcher.ts:289-292`) feeds it a *directory* (`workspace`) in two situations:

1. **`file` given, but ignored.** `dispatchRequest` builds the registry via `descriptor.pathParams.length > 0 ? makeRegistry(req.params[pathParams[0]], workspace) : makeRegistry(workspace, workspace)`. `getTypeErrors`'s `pathParams` is `[]` (`src/daemon/dispatcher.ts:177-178`) because its `file` param is optional, so even when `file` is supplied, the registry is built from `workspace`, not `file`. `makeRegistry(workspace, workspace)` calls `findTsConfigForFile(workspace)`, which strips one directory level too many (treating the workspace root directory as if it were a file inside it) and searches from the workspace's *parent* upward — missing a tsconfig sitting at the workspace root. `isVueProject` is therefore checked against the wrong (or no) tsconfig, `projectEngine()` falls back to `TsMorphEngine`, and `TsMorphEngine.getTypeErrors` throws because `.vue` files aren't in its project graph.
   Confirmed via direct repro: `dispatchRequest({ method: "getTypeErrors", params: { file: ".../Broken.vue" } }, workspace)` against the `vue-errors` fixture throws exactly this error, with the stack trace bottoming out in `TsMorphEngine.getTypeErrors` (`src/ts-engine/engine.ts:193`).

2. **`file` absent (project-wide check) — same bug, no crash, wrong answer instead.** Even a fix that special-cases "use `file` when present" leaves this path unchanged: with no `file` at all, `dispatchRequest` still calls `makeRegistry(workspace, workspace)`, so the same off-by-one applies directly to the workspace root. `TsMorphEngine` still gets selected as the project engine. Confirmed via direct repro on the same fixture: `dispatchRequest({ method: "getTypeErrors", params: {} }, workspace)` returns `status: "success"` with only the `.ts` file's diagnostic — `Broken.vue`'s error is silently absent, with no error or truncation flag indicating anything was skipped.

Every other operation is unaffected because their `pathParams` always includes the relevant file key, so `makeRegistry` already receives a real file path, not `workspace`.

## Fix

- `src/daemon/dispatcher.ts`: when `descriptor.pathParams` is empty, use `req.params.file` for registry construction whenever it is a string, instead of unconditionally passing `workspace`. Pass `undefined` through to `makeRegistry` when no `file` is present (don't collapse that case to `workspace` here — see next point).
- `src/daemon/language-plugin-registry.ts`: change `makeRegistry`'s signature from `(filePath: string, workspaceRoot: string)` to `(filePath: string | undefined, workspaceRoot: string)`. Inside `projectEngine()`, resolve the tsconfig via `filePath ? findTsConfigForFile(filePath) : findTsConfig(workspaceRoot)` — `findTsConfig` (already exported from `src/utils/ts-project.ts`, directory-aware, no `dirname` applied) is the correct lookup for "no specific file, use the workspace root directory itself." This is the change that fixes case 2, and combined with the dispatcher change, also fixes case 1.

This resolves the open design question from the handoff entry ("should `makeRegistry`'s plugin-selection lookup always use the request's `file` param when present, independent of `pathParams`?") — yes, and additionally, the "absent" fallback must use the directory-correct lookup rather than routing through the file-shaped one.

**Adjacent inputs to cover with regression tests** (see Edges below for the full list): a `.ts` file inside a Vue project (currently mis-routed too, just without a visible symptom); the project-wide call on a non-Vue project (must show no behaviour change); `searchText`/`replaceText`, which share the same `pathParams: []` shape but never call `registry.projectEngine()` (confirm unaffected, don't need new coverage — existing tests already cover their behaviour).

## Security

- **Workspace boundary:** `file`'s value now feeds `findTsConfigForFile`'s `fs.existsSync` walk-up *before* `operations/getTypeErrors.ts`'s own `scope.contains(absPath)` boundary check runs (that check still gates any actual file read, unchanged by this fix). The walk-up only tests for a literal `tsconfig.json` at ancestor directories of a path the caller already supplied as `file` — it exposes no information the caller didn't already have (the ancestor directory names are substrings of the input they provided). No weakening of the existing boundary.
- **Sensitive file exposure:** N/A — no file content is read at the registry-selection stage; only `fs.existsSync` on `tsconfig.json` candidates.
- **Input injection:** N/A — `file` was already accepted as an arbitrary string by `operations/getTypeErrors.ts`; this fix doesn't change what's readable, only which engine handles a request that was already going to be validated and (if valid) executed.
- **Response leakage:** N/A — response shape unchanged (`diagnostics`/`errorCount`/`truncated`), just correctly populated.

## Edges

- **`.ts` file inside a Vue project** — same mis-routing mechanism applies today (the file argument is ignored the same way), but it's invisible because `TsMorphEngine` handles plain `.ts` files fine. After the fix, both the single-file and project-wide calls should route to `VolarEngine` for `.ts` files in a Vue project too — add a case asserting this (e.g. via `utils.ts` in the `vue-errors` fixture).
- **Project-wide call on a non-Vue project** (`ts-errors`/`simple-ts` fixtures) — must be unchanged before/after: `findTsConfig(workspaceRoot)` finds the same tsconfig `findTsConfigForFile(workspace)` would have stumbled onto only by accident (or not at all); assert identical diagnostics.
- **`searchText`/`replaceText`** — share `pathParams: []` but their `invoke()` never calls `registry.projectEngine()`/`tsEngine()`, so this fix has no runtime effect on them. No new test needed; note in the PR/commit that this was checked, not assumed.
- **No tsconfig anywhere in the workspace** — `findTsConfig(workspaceRoot)` returns `null`, `projectEngine()` falls back to `TsMorphEngine` exactly as before. No behaviour change; worth one assertion since it's the other branch of the new conditional.
- **Happy-path regression risk:** operations with non-empty `pathParams` (`rename`, `moveFile`, `findReferences`, etc.) are untouched — the `pathParams.length > 0` branch in `dispatchRequest` isn't modified. Confirm with the existing test suite; no new coverage needed there.

## Done-when

- [x] Both reproduction cases (single-file `.vue`, project-wide) now produce the expected output
- [x] Regression tests cover both failing cases through `dispatchRequest` (not just at the `operations/getTypeErrors.ts` unit level, which already passes a correct engine directly and would not have caught this)
- [x] Regression tests cover the Edges above: `.ts` file in a Vue project, project-wide on a non-Vue project, no-tsconfig fallback
- [x] Mutation score ≥ threshold for `src/daemon/dispatcher.ts` and `src/daemon/language-plugin-registry.ts`
- [x] `pnpm check` passes (lint + build + test)
- [x] Tech debt discovered during investigation added to handoff.md as `[needs design]` (eval-suite tool-selection gap, `pnpm check` test-typecheck gap, `dispatcher.test.ts` tautological-assertion pattern, `_probe.ts` duplicate workaround)
- [x] Non-obvious gotchas added to `docs/architecture.md`: `findTsConfigForFile` vs `findTsConfig` are not interchangeable — the former assumes a file argument and always strips a directory level: passing it a directory silently searches one level too high
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Verification:** Exercised through the real CLI/daemon, not just tests. Built (`pnpm build`), spawned the actual daemon against a scratch Vue workspace (the `vue-errors` fixture content), and ran `weaver get-type-errors` through `pnpm exec`:

```
$ weaver get-type-errors --workspace <dir> '{"file":"<dir>/src/Broken.vue"}'
{"status":"success","diagnostics":[{"file":"<dir>/src/Broken.vue","line":2,"col":7,"code":2322,"message":"Type 'string' is not assignable to type 'number'."}],"errorCount":1,"truncated":false}

$ weaver get-type-errors --workspace <dir> '{}'
{"status":"success","diagnostics":[{"file":"<dir>/src/utils.ts",...},{"file":"<dir>/src/Broken.vue",...}],"errorCount":2,"truncated":false}
```

Before the fix, the same two calls threw `Could not find source file: '<dir>/src/Broken.vue'` and silently returned only the `.ts` error, respectively (confirmed via an in-process repro before writing this spec, then re-confirmed through the CLI/daemon after implementation).

**Reflection:**
- The root cause was broader than the handoff entry that seeded this spec described — the entry only covered "`file` given but ignored"; reproducing it firsthand surfaced a second, worse case ("`file` absent, wrong answer silently returned") that shares the same mechanism but wasn't previously known. Reproducing before speccing, not just reading the existing description, is what caught this — the entry's own repro claim ("confirmed via a direct repro") turned out to be true but incomplete.
- The execution agent's own mutation run found and fixed a real blocker: `vitest.stryker.config.ts` excluded `dispatcher.test.ts` from the Stryker sandbox entirely, so `dispatcher.ts` scored 0% until that exclusion was removed. Worth remembering: an AC or Done-when item requiring a mutation score can be silently unreachable because of unrelated tooling config, not the code under test — check the config before assuming a bad score reflects the tests.
- A concurrent, unrelated session was implementing `typecheck:test` (wiring `pnpm check` to typecheck `src/**/*.test.ts`) at the same time as this fix — itself the direct answer to a `[needs design]` entry this investigation had just added. It landed mid-session and changed what `pnpm check` covers; re-running it after the merge was the only way to get an accurate signal, and doing so incidentally validated that this fix's own new tests were clean under the new coverage.
- The post-implementation `/review-changes` pass (4 parallel review agents) earned its cost here: it caught a real duplicate workaround for the same underlying bug (`_probe.ts` in `src/plugins/vue/get-type-errors.ts`, deferred to handoff — a bigger surface than this fix's scope) and a real layer-fit issue (the routing decision was inlined instead of expressed via the file's own declarative `OPERATIONS` descriptor pattern), which in turn led to mutation testing surfacing a genuinely bad test pattern (`if (result.status === "success") {...} else {...}` — passes regardless of which branch fires) in two pre-existing, unrelated tests. None of these would have been caught by the spec's own Edges section, which was scoped to the bug itself.
- Recommendation for the next agent: when a fix changes a shared function's calling contract (`makeRegistry` here), re-run mutation testing after any post-review refactor, not just after the first implementation pass — the refactor here (declarative descriptor flag) genuinely moved which lines the equivalent-mutant reasoning applied to, and the mutation-testing doc would have gone stale (wrong line numbers, wrong survivor count) if not re-run and re-written against the final code shape.

**Test count:** 8 new tests total — 6 in `dispatcher.test.ts` (single-file `.vue`, single-file `.ts` in a Vue project, project-wide mixed `.ts`/`.vue`, project-wide non-Vue unaffected, a nested-tsconfig case built specifically to make the dispatcher-level routing observable rather than accidentally-correct-by-fixture-shape, and the VALIDATION_ERROR message-content regression added after mutation testing), 1 in `language-plugin-registry.test.ts` (no-tsconfig fallback with `filePath: undefined`), plus 1 pnpm-check-only assertion covered incidentally by the above.

**Mutation score (scoped runs):** `dispatcher.ts` 81.18% (69 killed / 12 survived / 4 no-coverage, all survivors classified in `docs/tech/mutation-testing.md` — 6 pre-existing/unrelated to this fix, 2 equivalent mutants from this fix's own code, 1 pre-existing real gap deferred to handoff, and the `pathParams.length > 0` equivalence class already accepted by the spec's own Edges call). `language-plugin-registry.ts` 90.63% (29 killed / 3 survived).

**Architectural decision recorded:** the registry-selection-by-file behavior is now declared via an explicit `usesFileForRegistry` flag on the `OPERATIONS` descriptor table entry, matching the file's existing `pathParams`-as-declarative-data convention, rather than an ad hoc check applied uniformly to every `pathParams`-empty operation. Only `getTypeErrors` sets it.

**Deferred, tracked in handoff.md:** the `_probe.ts` duplicate workaround in `src/plugins/vue/get-type-errors.ts` (same bug, different call path, working but redundant); the tautological `if (status === "success") {...} else {...}` test pattern in `dispatcher.test.ts`.
