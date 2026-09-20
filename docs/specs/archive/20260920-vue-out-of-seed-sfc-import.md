# A Vue project-wide check reports a false TS2307 for an SFC outside the service's seeds

**type:** bug
**date:** 2026-09-20
**tracks:** handoff.md # a project-wide vue check reports a false ts2307 for an out-of-seed sfc's import

---

## Symptom

A project-wide `get-type-errors` on a Vue project reports `TS2307 Cannot find module` for an import of a `.vue` file that exists on disk, whenever that SFC sits outside the two places `buildVolarService` learns `.vue` files from. The same command then returns a different answer depending on what the daemon answered earlier in its session.

Reproduced with the real `VolarEngine` on a workspace whose `tsconfig.json` is `{"include": ["src/**/*"]}`, `src/main.ts` imports `../dist/Broken.vue`, and that SFC exists on disk:

```
input:    get-type-errors {}   (project-wide, fresh service)
actual:   errorCount: 1
          [{ file: src/main.ts, line: 1, col: 20, code: 2307,
             message: "Cannot find module '../dist/Broken.vue' or its corresponding type declarations." }]
          checked: { files: 2 }, unchecked: { files: 0 }
expected: the import resolves, and the SFC — which an included file imports — is reported the way
          the ts-morph engine already reports an imported .ts file outside include

input:    the same call, after a single-file check on dist/Broken.vue in the same daemon session
actual:   errorCount: 0
expected: identical to the fresh answer
```

Three more shapes produce the same false 2307: an SFC under `.output/`, an SFC inside `node_modules/<pkg>/`, and an SFC outside the tsconfig's own directory. The single-file path (`get-type-errors --file <sfc>`) answers all of them correctly, because it adds the file on demand.

## Value / Effort

- **Value:** The check tells a caller their project compiles. A caller acting on it edits an import that already resolves, or creates a file that already exists; a caller reading `checked.files: 2` believes two files were examined. The trigger is ordinary — an SFC outside `src/`, or one shipped by a dependency — and re-running the command changes the answer, since the daemon's earlier calls decide it.
- **Effort:** Two files: the service gains one registration helper and the host callbacks that call it, and the project-wide check drops a filter and passes the resulting scope into the SFC diagnostics loop.

## Expected

- The import resolves, so `src/main.ts` is clean.
- The SFC is checked and its own errors are reported, because an included file imports it. `docs/commands/get-type-errors.md:41` states this contract ("the tsconfig's own files plus everything they import… unless an included file imports it, which is exactly what `tsc` does"), and `tsGetTypeErrorsForProject` already implements it with no narrowing to the file set the program was built with.
- The answer is the same whether or not a single-file query ran first.

Measured on the fixture above with both parts of the fix simulated, so the expectation is exact:

```
errorCount: 1
diagnostics: [{ file: dist/Broken.vue, line: 2, col: 7, code: 2322,
                message: "Type 'string' is not assignable to type 'number'." }]
checked:   { files: 3, tsconfig: tsconfig.json }
unchecked: { files: 0, reason: "outside tsconfig.json", otherConfigs: [] }
```

The Volar glue diagnostics without a source-map entry are dropped by `translateDiagnostics`, as today, so the SFC's own error is the only diagnostic it contributes.

## Root cause

Confirmed by reproduction, and the mechanism observed by driving `buildVolarService` directly and mutating one collection at a time.

**The SFC is absent from the service's file set.** `buildVolarService` seeds `.vue` knowledge from the tsconfig's file set and from `ts.sys.readDirectory(projectRoot, [".vue"], …)` filtered by `SKIP_DIRS` (`src/plugins/vue/service.ts:224-226`). An SFC under `dist`, `.output`, `.nuxt` or `node_modules` fails that filter, and one outside `projectRoot` is outside the scan's reach. Either way it is absent from `vueVirtualToReal` (`:285`) and from `language.scripts`.

**Resolution needs the registered script and the mapped virtual path.** The host answers a virtual `.vue.ts` path from the map (`fileExists`, `:139-142`; `readFile`, `:143`; `getScriptSnapshot`, `:120`). Isolation arms, each on a fresh service against the same fixture, reading `src/main.ts`'s diagnostics:

| mutation on the fresh service | `src/main.ts` |
|---|---|
| none | 2307 |
| push the virtual path into `scriptFileNames` | 2307 |
| map the virtual path in `vueVirtualToReal` | 2307 |
| map + push the root | 2307 |
| register the script only | 2307 |
| **register the script + map the virtual path** | **clean** |
| `addScriptFile` (register + map + root + version bump) | clean |

Registration is what makes `getScriptSnapshot` return generated TypeScript; the map is what makes `fileExists` answer for the virtual path. The register+map arm resolves the import with the root push absent, so the fix reaches its answer without widening `scriptFileNames`. The queued entry's stated mechanism — that `fileExists` gates on `vueVirtualToReal` alone — is incomplete: mapping without registration still fails.

**The order-dependence comes from the single-file path.** `vueGetTypeErrorsForFile` calls `service.addScriptFile(file)` unconditionally (`src/plugins/vue/get-type-errors.ts:92`), which registers, maps, pushes the root and bumps the version. The widened program then resolves the import, so a later project-wide call answers clean where a fresh one answered 2307.

**A second defect on the same path, independent of resolution.** `vueGetTypeErrorsForProject` narrows `checked` to `service.builtFileNames` for the caller's own files (`:163-169`), and `vueGetTypeErrorsFromService` filters the `.vue` diagnostics the same way (`:64-69`). `tsGetTypeErrorsForProject` reports the closure directly (`src/ts-engine/get-type-errors.ts:75`). So an SFC outside the built set that the closure does reach is counted unchecked and its diagnostics are dropped — the silent gap the narrowing was introduced to avoid creating in the other direction. Measured: with the SFC registered and resolving, the closure contains `dist/Broken.vue.ts`, `src/App.vue.ts` and `src/main.ts`, and the narrowed `checked` set contains only the latter two.

## Fix

**1. `src/plugins/vue/service.ts` — register an SFC the compiler resolves to.**

Add one helper inside `buildVolarService`, beside `storeContent` (`:326`) where `fileContents`, `registerScript`, `versions` and `vueVirtualToReal` are already in closure: given a real `.vue` path, read it from disk, store the content, register its script, bump its version and map its virtual path. "Already held" is `vueVirtualToReal.has(virtualPath)` — the map is what both host callbacks read, and it is the only one of the service's collections the helper is responsible for filling. That is a different predicate from `addScriptFile`'s `scriptFileNames.includes(virtualPath)` (`:355`), which stays as it is: a file the helper registered is mapped but not a root, so a later `addScriptFile` on it still runs and adds the root. Keep the version bump inside the helper so that second pass re-registers at a version the language service treats as new.

`addScriptFile` reuses the helper, keeping its own push to `scriptFileNames`.

**Verify the timing first.** The isolation arms above mutated a *fresh service before* the query; the fix instead registers from inside a host callback the compiler invokes *during* module resolution, mutating `language.scripts` while the program is being built. That the ingredients work says nothing about whether they work at that moment. Drive `buildVolarService` on the repro fixture with the helper wired into `fileExists` only, read `src/main.ts`'s diagnostics, and confirm clean before writing anything else. If lazy registration cannot be reached from resolution, the fallback is a pre-pass that registers the SFCs the seed files' import specifiers name, and the spec needs revisiting.

The host calls the helper when the compiler asks about a path it does not hold and the real `.vue` behind it exists on disk — from `fileExists`, so resolution succeeds, and from `getScriptSnapshot`/`readFile`, so a query that reaches the virtual path without a prior `fileExists` still gets generated code. Three properties, each with a case below: registration considers only a path ending `.vue.ts`; a real file occupying the virtual name wins (`ts.sys.fileExists(virtualPath)` true → skip); and `scriptFileNames` stays as the service was built with it, so the program grows only by what an import pulls in and `unchecked` keeps its meaning.

**2. `src/plugins/vue/get-type-errors.ts` — report the closure.**

Replace the `checked` filter (`:163-169`) with the closure itself — `const checked = closure`, as `tsGetTypeErrorsForProject` has it (`src/ts-engine/get-type-errors.ts:79`) — and pass that set into the SFC loop instead of filtering on the built set: `vueGetTypeErrorsFromService(service, checked)` iterates `service.vueVirtualToReal` and keeps the paths the caller's scope holds. `checked` and the set the diagnostics come from become the same set — the invariant the narrowing was defending, now satisfied from the other side.

**A dependency's SFC is diagnosed, matching the ts-morph side.** The closure is not filtered by `isOwnWorkspaceFile`, so an SFC under `node_modules/` that an included file imports lands in `checked` and its errors are reported — which is what `tsGetTypeErrorsForProject` already does for a `.ts` file in the same position, and what `tsc` does for a non-declaration file in its program. Only the `checked.files` *count* excludes dependencies (`type-check-scope.ts:101`), so such an SFC is reported without being counted, exactly as on the TS side. Noise from a dependency shipping uncompiled SFCs is the accepted cost of that parity; if it proves unacceptable in practice, the fix is one filter applied in both engines.

Both parts are needed: registration puts the SFC in the program, and the closure is what decides that a file in the program is reported.

**3. Comments and docs.** The two comments in `get-type-errors.ts` that explain the narrowing, `docs/internals/get-type-errors.md`'s "An on-demand add serves the query that asked for it" paragraph, and a gotcha in `docs/tech/volar-v3.md` recording what makes a `.vue` import resolve.

**Adjacent inputs**, each with the layer that verifies it:

| Unit of verification | Layer |
|---|---|
| `dist/` SFC imported by an included file: import resolves, SFC's error reported, `checked.files` counts it | scenario — `src/operations/getTypeErrors.scenarios.yaml` |
| project-wide answer identical with and without a preceding single-file check on that SFC | focused test — `src/operations/getTypeErrors.test.ts`, through `dispatchRequest` (two calls against one cached engine in one process; the scenario runner cannot express a sequence with a response assertion) |
| `vueGetTypeErrorsFromService` keeps out a path outside the caller's checked set, and reports one inside it | unit — `src/plugins/vue/get-type-errors.test.ts`, on the existing fakes |
| an import of an SFC that does not exist still reports TS2307 | scenario — the missing-file cell, on the same fixture |
| a `.vue` in a non-`SKIP_DIRS` ignored directory keeps resolving | scenario — existing coverage; keep a case |
| `node_modules/<pkg>/Comp.vue` imported by an included file: import resolves, the SFC's error is reported, `checked.files` does not count it | scenario — `getTypeErrors.scenarios.yaml`, pinning the parity decision above |
| an SFC outside the workspace root imported by an included file: import resolves and the SFC's error is reported, and `checked.files` does not count it (`isOwnWorkspaceFile` excludes it) | scenario — same fixture, sibling directory |
| a real file named `Foo.vue.ts` beside `Foo.vue` keeps winning resolution | verify while implementing; add a case only if the expectation is unambiguous |

The SFC-import cell needs a real Volar service, a real filesystem and the real module resolution, so it belongs at the scenario layer. The ordering cell needs two dispatches against one cached engine, which the scenario format refuses to build (a multi-step scenario asserts net file effects and cannot carry a response), so it stays focused.

**Test files.** `src/operations/getTypeErrors.test.ts` (510 lines) and `src/plugins/vue/get-type-errors.test.ts` (725) both sit past the length signal in `docs/code-standards.md`. Assessed against its refactoring hierarchy: each is the cohesive test file for one subject — the operation and the module — and neither holds a nameable responsibility that would move out, so the change adds to each without a prep refactor. The new scenario case goes in the existing `getTypeErrors.scenarios.yaml`.

**Shape.** The change stays inside the two existing modules: the registration helper is a closure inside `buildVolarService` beside `storeContent`, reading through the service's existing `readFileFromDisk`, and `vueGetTypeErrorsFromService` gains the scope parameter that replaces the built-set filter it applies today.

## Security

- **Workspace boundary:** The compiler already resolves these specifiers and the host already reads what it resolves; registration adds one more caller of that same read path, gated on a virtual path ending `.vue.ts` whose real `.vue` exists on disk. `isWithinWorkspace`/`isSensitiveFile` govern the walk-based operations, which keep their existing checks.
- **Sensitive file exposure:** The service's read path (`readFileFromDisk` → `fs.readFileSync`) already loads whatever the program resolves, including `node_modules` and out-of-workspace files, and the new caller is gated on the `.vue` extension, which keeps a `.env`-class path out of it. File content is used for type analysis and reaches the response only as compiler messages.
- **Input injection:** The path comes from an import specifier inside a workspace file, resolved by the TypeScript compiler — the same specifier that already reaches the host's `readFile` today.
- **Response leakage:** The response gains diagnostics it was already meant to carry. A compiler message can quote a type name from the checked file, which is true of every diagnostic the command returns, and `capDiagnostics` still bounds the list at `MAX_DIAGNOSTICS`.

## Edges

- **The narrowing's other direction.** An SFC a query added and the closure does not reach stays out of `checked` and out of the diagnostics — the guard the old filter provided, now expressed as scope membership. A unit case covers both sides.
- **Seeded SFCs keep their answers.** An SFC inside the seeds is in `seedFileNames`, hence in the closure, hence reported exactly as today; the existing `a-vue-scoped-project` scenarios are the guard.
- **Program size.** Registration adds an SFC to the program where an import reaches it, so a workspace with SFCs under `dist` pays for the ones it imports; the `.vue` seed scan keeps its `SKIP_DIRS` filter for the same reason.
- **Deleted SFC.** `rereadFile` drops a deleted SFC's script registration while leaving its map and root entries, and `vueGetTypeErrorsFromService` then throws for it. Its own queued entry covers that; the path is in the closure and in the built set alike, so it reaches `getSemanticDiagnostics` under either scope.
- **`unchecked` counts the service's built set**, so an out-of-seed SFC nothing imports appears in neither `checked` nor `unchecked`. Named here so this change stays scoped to the imported case; the queued entry on the field's meaning owns it.
- **Other engines and commands.** `tsGetTypeErrorsForProject` already reports the closure; the TS-only engine's `INTERNAL_ERROR` for a `.vue` path is a separate queued entry.
- **Cost.** Registration adds one `readFileSync` plus one script registration per newly resolved SFC, on the resolution path. Measure the end-to-end project-wide check before and after on a fixture with several out-of-seed SFCs and record both numbers.

## Done-when

- [x] Reproduction case now produces expected output — the literal repro on the real CLI: a workspace with `include: ["src/**/*"]`, `src/main.ts` importing a `dist/` SFC with a sentinel type error, checked project-wide, reports the SFC's error at its real position
- [x] Lazy registration from inside the resolution callback confirmed working before implementation (the timing check in Fix 1)
- [x] Regression test covers the exact failing case, plus the adjacent inputs above
- [x] The ordering cell passes: the project-wide answer is identical before and after a single-file check on that SFC
- [x] A missing SFC still reports TS2307, and the seeded path still reports what it reported before
- [x] Cost measured before and after on a fixture with several out-of-seed SFCs, recorded in the Outcome
- [x] Mutation acceptance: explicit `pnpm test:mutate:file` on `src/plugins/vue/service.ts` and `src/plugins/vue/get-type-errors.ts` (both are outside the default `mutate` array), with every mutant introduced by this change killed or classified per `mutate-triage`
- [x] `pnpm check` passes (lint + build + test)
- [x] `/review-changes` run over the whole change and its findings applied
- [x] `docs/internals/get-type-errors.md` updated for the new scope rule; `docs/tech/volar-v3.md` records what makes a `.vue` import resolve; `docs/commands/get-type-errors.md` checked against the new behaviour
- [x] Tech debt discovered during investigation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

### Verification

The repro on the real CLI, against a workspace whose `tsconfig.json` is `{"include": ["src/**/*"]}`, `src/main.ts` imports `../dist/Broken.vue`, and that SFC's script is `const broken: number = "SENTINEL_MAIN_IMPORT"`:

```
$ weaver get-type-errors '{}'      # project-wide, fresh daemon
{"status":"success","diagnostics":[{"file":"…/dist/Broken.vue","line":2,"col":7,"code":2322,
  "message":"Type 'string' is not assignable to type 'number'."}],"errorCount":1,
 "checked":{"files":3,"tsconfig":"…/tsconfig.json"},"unchecked":{"files":0,…}}
```

That is the Expected block, and the importer reports TS2307 no longer. A single-file check on the SFC followed by the same project-wide call returned byte-identical JSON, so the ordering cell holds on the daemon path, not only in-process.

Cells driven on the CLI: deleting the resolved SFC and checking project-wide returns `success` with the importer's TS2307, the deletion flow's own answer, with no throw from the stale virtual path; deleting a seeded SFC returns `success` with no errors; an import of an SFC that does not exist still reports TS2307; a seeded SFC still reports its own error.

### Tests

+10 cases (main lane 1571 → 1581), of which 4 are scenario cases. Each new case was checked against the pre-change code: the SFC-import scenario, the dependency-SFC scenario, the ordering cell, the outside-root cell, the scope unit, the service registration case, both deletion cases and the occupied-name case go red without the behaviour they name. The missing-SFC, non-`SKIP_DIRS` and disk-file-wins cases pass against the pre-change code; each is recorded as a guard for behaviour the change had to preserve.

The seeded-deletion case keeps `src/App.vue` in its fixture: with the deleted SFC as the workspace's only `.vue` file, the follow-up check leaves the Volar engine for the ts-morph one, so the stale mapping is outside what the case measures.

### Mutation

`pnpm test:mutate:file src/plugins/vue/get-type-errors.ts` — 95.9% (70 killed, 3 survived, 0 no-coverage). The three survivors are the pre-existing `translateVirtualOffset` guards already in the catalogue.

`pnpm test:mutate:file src/plugins/vue/service.ts` — 71.9% (128 killed, 38 survived, 12 no-coverage, 22 ignored). The file's deficit is its own queued entry's business; this change's mutants are the four lines the registration work added. Three survive, and each now records the invariant it holds: the `.vue.ts` gate, the map guard in `holdFile`, and the held-path script check. The fourth — the add's fallback branch — was removed rather than recorded: opening it changes no test answer, measured by hand, so the add holds the file once instead of calling the helper and repeating its work.

Cost (Edges): five out-of-seed SFCs in one `dist/`, project-wide check, median of five — cold 135.8/137.8 ms before and 143.9/148.1 ms after; warm 0.2 ms before and 0.3 ms after.

### Decisions

- Registration happens inside the resolution callback, rather than widening the `.vue` seed scan or rebuilding the service after a query-time add. The seed scan would make build output program roots; a rebuild would have nothing to repair once the fresh answer is correct. The timing check ran before any edit and passed — the isolation arms had mutated a fresh service before the query, so whether the same ingredients work mid-resolution was a real unknown, and the fallback in the spec was available if they did not.
- `checked` is the program closure, as `tsGetTypeErrorsForProject` has it. The narrowing it replaces existed to keep `checked` a subset of the set the diagnostics come from; the new shape satisfies that from the other side, handing the same set to the `.ts` loop and to the SFC loop.
- A dependency's SFC is reported without being counted, matching the ts-morph engine and `tsc`.
- The occupied-virtual-name collision (`Foo.vue` beside a real `Foo.vue.ts`) stays queued. Both halves were measured on the CLI against the pre-change build, by querying the real `Foo.vue.ts` by name. When the SFC is seeded, the base build returned its generated diagnostics at untranslated positions (six of them, `vue` module-not-found among them), and this build returns an empty result. When the SFC is outside the seeds, the base build returned that file's own errors, and this build returns an empty result. Recorded as a limitation in `docs/commands/get-type-errors.md` and in the internals doc, and carried on the `INTERNAL_ERROR` entry in `handoff.md`.
- The negative-probe memo an efficiency review proposed is queued: it needs an invalidation story covering a created SFC the post-write drain does not reach, and its benefit is under 1% of a real post-write rebuild.

### Reflection

The design question the entry carried — widen the SFC seed scan, or rebuild the service after a query-time add — had a third, cheaper answer: register from the resolution callback. Mutating one collection at a time is what found it, and it also falsified the entry's stated mechanism: `fileExists` answering from the virtual map is necessary and not sufficient, because `getScriptSnapshot` has nothing to serve until the script is registered.

The one question those arms could not answer was whether the same registration works while the program is being built, since each arm mutated a fresh service before the query. That check ran before any edit and passed, so the fix could assume resolution-time registration, and the fallback it named — a pre-pass over the seed files' specifiers — was not needed.

Two review rounds each produced a regression in the previous round's fix, and both were a mapping outliving the state it was computed under: an add leaving an SFC unmapped, and a deleted SFC's virtual path still resolving. What those cost is recorded in `docs/design-principles.md` and `docs/code-standards.md`.

Three of the four mutants this change introduced survive, and each carries a comment at its line; the fourth lived in a branch whose arms agree, so deleting the branch was the fix. The file's remaining survivors belong to its own queued entry.
