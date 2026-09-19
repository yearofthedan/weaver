# A Vue project reports an unchecked file as clean

**type:** bug
**date:** 2026-09-14
**tracks:** handoff.md # the post-write check reports a written file outside the engine's program as clean

**sequences after:** [nested path param resolution](archive/20260914-nested-path-param-resolution.md) — the end-to-end cells below are surgical `replaceText` steps, which the scenario format expresses from that change on.

---

## Symptom

In a Vue project, a type check of a file the Volar program does not hold returns zero errors instead of the errors the file has. The caller cannot distinguish "checked, clean" from "not checked": both are `errorCount: 0`.

It reaches the user two ways, through one guard each:

- **the post-write check** — a mutating operation returns `typeErrorCount: 0` and `status: success` for a write that introduced a type error
- **the read-only command** — `get-type-errors --file <path>` returns `errorCount: 0, diagnostics: []`

The same input in a TS-only project reports the error, because the ts-morph engine adds the file to its program on demand and Volar does not.

## Value / Effort

- **Value:** A caller cannot distinguish a checked-and-clean write from an unchecked one: both come back `status: success, typeErrorCount: 0`. The check exists to tell the caller whether the edit it just made compiles, and it attaches that answer to the operation that made the edit. The affected file classes are generated and gitignored code, which an agent reaches by writing rather than by reading.
- **Effort:** Two functions in one file gain an add-then-recheck; the service gains one method beside an existing sibling. The response shape stays as it is.

```
input:    replaceText writing `export const n: number = "not-a-number";`
          into <root>/dist/gen.ts, in a workspace containing one .vue file
          and tsconfig include: ["src/**/*"]
actual:   status: success, typeErrorCount: 0, typeErrors: []
expected: status: warn, typeErrorCount: 1,
          typeErrors: [{ file: "dist/gen.ts", line: 1, col: 14, code: 2322,
                         message: "Type 'string' is not assignable to type 'number'." }]

input:    get-type-errors --file <root>/dist/gen.ts, same workspace
actual:   status: success, errorCount: 0, diagnostics: []
expected: status: success, errorCount: 1, diagnostics: [ the TS2322 above ]

control:  the identical workspace with the .vue file removed (TS-only engine)
actual:   status: warn, typeErrorCount: 1 — correct today, must stay correct
```

## Root cause

Confirmed by reproduction, and the mechanism observed by driving `buildVolarService` directly.

`vueGetTypeErrorsForTsFile` (`src/plugins/vue/get-type-errors.ts:110-113`) returns an empty result when `program.getSourceFile(file)` is falsy, and `vueGetTypeErrorsForFile` (`:81-83`) does the same when `service.vueVirtualToReal` lacks the file's virtual path. Both guards exist for a real reason: `getSemanticDiagnostics` throws `Could not find source file` for a path outside the program, and that throw previously reached the dispatcher and turned a landed write into `INTERNAL_ERROR`. What the caller sees instead is `errorCount: 0` for a file outside the program.

A file is outside the program when it is outside **both** of the service's two seeds:

- the tsconfig's own file set, and
- the workspace walk, `walkFiles(workspaceRoot, TS_EXTENSIONS)` (`src/plugins/vue/service.ts:222`), which is `git ls-files --cached --others --exclude-standard` inside a repository — so gitignored paths are invisible — and outside one a readdir that skips `SKIP_DIRS` = `node_modules`, `.git`, `dist`, `.nuxt`, `.output`, `.vite` (`src/utils/file-walk.ts:11,34-49`)

For `.vue` files the second seed is `ts.sys.readDirectory(projectRoot, [".vue"], …)` filtered by the same `SKIP_DIRS` (`service.ts:207-212`), so an SFC under `dist/` or `.nuxt` is hidden the same way.

Measured, in a Vue workspace with `include: ["src/**/*"]`:

| Input | Result |
|---|---|
| non-git workspace, `dist/gen.ts` | `errorCount: 0` — hidden by `SKIP_DIRS` |
| git repo, gitignored `generated/gen.ts` | `errorCount: 0` — hidden by `git ls-files` |
| git repo, gitignored `src/generated/gen.ts` | `errorCount: 1` — the tsconfig's `include` covers it, so the walk is irrelevant |
| `dist/Gen.vue` | `errorCount: 0` — hidden by the `.vue` scan's `SKIP_DIRS` filter |

## Fix

Give the Volar service the on-demand add the ts-morph engine already has — `getDiagnosticServiceForFile` calls `service.addScriptFile(filePath)` (`src/ts-engine/engine.ts:193-196`), which is why the TS-only engine answers this input correctly.

1. **`src/plugins/vue/service.ts`** — `CachedService` gains `addScriptFile(filePath)`, built inside `buildVolarService` beside the existing `rereadFile` where `scriptFileNames`, `vueVirtualToReal`, `registerScript` and `versions` are already in closure. A `.vue` path gets `${filePath}.ts` mapped in `vueVirtualToReal` and pushed to `scriptFileNames`, and its script registered as `"vue"`; any other path is pushed as-is. Content and version come through the same read path `rereadFile` uses. Idempotent: a path already present is left alone.
2. **`src/plugins/vue/get-type-errors.ts`, `vueGetTypeErrorsForTsFile`** — on a program miss, call `addScriptFile`, then **re-check** `getProgram().getSourceFile(file)`. Present → query as normal. Still missing → today's empty result.
3. **`src/plugins/vue/get-type-errors.ts`, `vueGetTypeErrorsForFile`** — the same shape for the `.vue` path, against the virtual path's mapping and the program.

**The re-check is required.** Measured: pushing a path whose content cannot be read leaves the program without it (`inProgramAfterAdd=false`), and querying anyway throws `Could not find source file` — the exact `INTERNAL_ERROR` the guards were introduced to stop. Adding without re-checking reintroduces it.

**Two alternatives, measured:**

- *Route the file to ts-morph.* Disproven. A generated file importing an SFC comes back `codes=[2307,2322]` — `"Cannot find module '../src/App.vue'"` fabricated alongside the real error, because the ts-morph project has no `.vue` language support, so the response carries a fabricated TS2307 beside the real one.
- *Report the file as unchecked rather than clean.* It has vocabulary to reuse (`checked` / `unchecked` on `GetTypeErrorsResult`, `src/operations/types.ts:141-143`), but it answers a different question: the file is genuinely checkable, so the caller wants the errors.

**Adjacent inputs** — regression coverage for each:

- `.ts` under `dist/` in a non-git workspace → the real TS2322, was `0`
- `.ts` under a gitignored directory outside the tsconfig's `include` → the real error
- an out-of-program `.ts` that **imports an SFC** → the real error **only**, no TS2307; this is the cell that separates the fix from routing to ts-morph, so it must be pinned
- `.vue` under `dist/` → the real error, was `0`
- `.mts` / `.cts` out of program → the real error (the extension set was widened on 2026-09-13; these are the inputs that widening exposed)
- a file already in the program → unchanged, and no duplicate entry in `scriptFileNames`
- a path that cannot be read → empty result, no throw, no `INTERNAL_ERROR`
- the TS-only control for each cell above → unchanged, so the fix is visible as convergence between the two engines rather than as new Vue behaviour
- `status: warn` reaching the consumer when the written file has an error — no test in the suite asserts this today (it closes the standing `status: warn` handoff chore)

**Layer-fit:**

| Unit of verification | Layer |
|---|---|
| `addScriptFile` puts a `.ts` and a `.vue` path into the program, is idempotent, and no-ops on an unreadable path | unit against a real fixture — `src/plugins/vue/service.test.ts` (195 lines, room) |
| add-then-recheck in both `get-type-errors` functions, including the still-missing branch returning empty without throwing | unit with a fake `getService` — `src/plugins/vue/get-type-errors.test.ts` (528 lines; check the hotspot rule before adding, and push setup into helpers rather than growing the file with copies) |
| explicit `get-type-errors --file` on an out-of-program `.ts` and `.vue`, Vue and TS-only | scenario — extend `src/operations/getTypeErrors.scenarios.yaml`, which already carries Vue fixtures |
| the post-write check on a surgical write, including `status: warn` | scenario — `src/operations/replaceText.scenarios.yaml`, created by the preceding spec |

## Security

- **Workspace boundary:** Every path reaching `addScriptFile` has already passed the dispatcher's boundary check and, on the post-write path, been written by the operation; the explicit command names its own file. The read goes through the service's existing read path, and the program it extends is the one `buildVolarService`'s own walk already built.
- **Sensitive file exposure:** The add reads file content into the language service, so a check on a written `.env`-class path would parse it. Unchanged in practice — the operations that write refuse sensitive files before writing (`isSensitiveFile` in `replaceText.ts:124`), so such a path never reaches `filesModified`; and the explicit command's target is the caller's own named file, which it could already read. No content enters the response: diagnostics carry a file, position, code and compiler message.
- **Input injection:** The added path is one the request already named, and it reaches the filesystem through the same validation as before.
- **Response leakage:** The response keeps its existing fields and gains diagnostics it was already meant to carry — messages from the TypeScript compiler, capped at `MAX_DIAGNOSTICS` by the existing `capDiagnostics`. A compiler message can quote a type name from the checked file, which is already true of every diagnostic the command returns.

## Edges

- **Per-file program rebuild costs one program per file.** The ts-morph side already carries a known N+1 of exactly this shape — see the `refreshFile` discards roots added via `addScriptFile` handoff entry: for a file the tsconfig does not cover, the add forces a fresh program per file. The post-write check loops over `filesModified`, so a write touching N out-of-program files pays it N times. Measure with N=5 before and after, and record the number in the Outcome.
- **A later project-wide check counts the added file.** Shipped as: it does not. `addScriptFile` widens the cached service's `scriptFileNames`, which `describeCheckedScope` reads, so the service keeps `builtFileNames` — the file set it was built with — and the project-wide walk, `checked` and `unchecked` derive from that snapshot. The compiled program is still shared with the add, so an in-program file's import of an added SFC resolves once a query has added it; that sequence-dependence, and the TS2307 a fresh service reports for such an import, are queued in `handoff.md`.
- **`addScriptFile` touches one service of the several a workspace can have.** It is reached through `this.services.get(this.cacheKey(…))`, the same shape as `refreshWrittenFile` and `invalidateService`. A sibling service holds no out-of-program path either, so the multi-service gap stays where its own entry records it; the reach is recorded here so a future reader knows the new add touches the same one.
- **Semantic diagnostics carry the real error only.** A tsconfig with `rootDir`/`outDir` that excludes the written file is the shape the *single-file `get-type-errors` judges a file against a tsconfig that excludes it* entry describes, where ts-morph produces TS6059. Measured on this fix: semantic diagnostics carry only the real TS2322; TS6059 appears in `getCompilerOptionsDiagnostics()`, which weaver never queries (`semanticErrors` uses `getSemanticDiagnostics` alone). Keep a cell on it so a change to the diagnostic source cannot import the defect silently.
- **Mutation scope: `src/plugins/**` is commented out of `stryker.config.mjs`'s `mutate` array**, so neither touched file is measured by `pnpm test:mutate`. Both need explicit `pnpm test:mutate:file` runs. `service.ts` currently measures 69.58% — under the 75 break threshold — from 33 survivors and 12 uncovered mutants in the `readFile` cache, the `createLanguage` registration callback and `getScriptSnapshot`, none of which this change touches (its own handoff entry). Acceptance here is every mutant *introduced by this change* killed or classified; the file-level score stays below threshold until that entry is worked.

## Done-when

- [x] Reproduction case now produces expected output — the literal repro: surgical `replaceText` into `dist/gen.ts` in a Vue workspace reports `status: warn` with the TS2322, and the TS-only control still does
- [x] `get-type-errors --file` on the same path reports the error in both engines
- [x] Regression tests cover every adjacent input listed above, including the SFC-importing cell (no TS2307) and the unreadable-path cell (no throw)
- [x] N=5 out-of-program files in one write measured before and after, and the number recorded in the Outcome
- [x] Mutation acceptance: explicit `pnpm test:mutate:file` on `src/plugins/vue/service.ts` and `src/plugins/vue/get-type-errors.ts`, with every mutant introduced by this change killed or classified per `mutate-triage`
- [x] `pnpm check` passes (lint + build + test)
- [x] `/review-changes` run over the whole change and its findings applied
- [x] `docs/internals/get-type-errors.md` records the on-demand add and why the re-check guard stays; `docs/commands/get-type-errors.md` if the user-visible contract for out-of-program files is stated there
- [x] The `status: warn` handoff chore removed, covered by the post-write scenario
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

### Verification

Driven on the real CLI (`dist/` rebuilt by the pre-commit hook) against a fresh workspace whose `tsconfig.json` has `include: ["src/**/*"]`, a `.vue` file under `src/`, and the checked files under `dist/`. Every input uses a sentinel name, so a pass cannot be a coincidental match against pre-existing state.

```
$ weaver replace-text '{"edits":[{"file":"dist/gen.ts","line":1,"col":26,
                                 "oldText":"SENTINEL_GEN","newText":"\"x\""}]}'
{"status":"warn","filesModified":["…/dist/gen.ts"],"replacementCount":1,
 "typeErrors":[{"file":"…/dist/gen.ts","line":1,"col":14,"code":2322,
                "message":"Type 'string' is not assignable to type 'number'."}],
 "typeErrorCount":1,"typeErrorsTruncated":false}

$ weaver get-type-errors '{"file":"dist/gen.ts"}'
… "errorCount":1, TS2322 at 1:14          (was errorCount: 0)

$ weaver get-type-errors '{"file":"dist/Gen.vue"}'
… "errorCount":1, TS2304 at 2:19          (was 0; positions in the real SFC)

$ weaver get-type-errors '{}'             # after both single-file queries
… "errorCount":0,"checked":{"files":1},"unchecked":{"files":0}
```

Cells verified on the final artifact: `.ts`, `.vue`, `.mts` and `.cts` under `dist/`; a gitignored `.ts` outside `include` in a git workspace; an out-of-program `.ts` importing an SFC (its own TS2322, with the `.vue` import resolving to the real module); a `.ts` under a tsconfig whose `rootDir` excludes it (the file's own TS2322; the check reads semantic diagnostics, and both engines hold TS6059 in the compiler-options set for this fixture); the post-write check in a Vue workspace and its TS-only control (both `warn` / 1 / TS2322); and the project-wide answer after the single-file queries above, which stayed at the service's construction-time scope. The dispatcher answers `FILE_NOT_FOUND` for an absent path before the engine is consulted, so the unreadable-path case lives at the unit layer.

A project-wide check on a workspace whose `src/main.ts` imports an SFC under `dist/` reports `checked.files: 2, unchecked.files: 0` before and after a single-file check on that SFC. The response counts the files it answered for, so it never claims a file it filtered out of the diagnostics. The TS2307 a fresh service reports for that import disappears once the SFC is added — the queued entry below.

### Tests

+26 in the six touched test files (143 → 169), of which 13 are scenario cases; the main lane went 1545 → 1571. Cases written to fail for the right reason were checked by removing the behaviour they name: the built-set filter (removing it reports the added SFC), the closure's narrowing to the built set (removing it counts the added SFC as checked), the add/`builtFileNames` split on the real service (re-adding to the snapshot fails it), and the program-membership guard before the add (forcing it fails the case that pins a held file out of the add). The two "still outside the program after the add" cases in `get-type-errors.test.ts` pass against the pre-change code, because that branch's observable output is identical either way — they pin the re-check itself.

### Mutation

`pnpm test:mutate:file src/plugins/vue/service.ts` — 70.32% (109 killed, 34 survived, 12 no-coverage). One survivor sits on a line this change introduced: `bumpVersion`'s `+1`, whose direction and size never reach an answer because the language service compares versions for change. Recorded as a comment at the line. The rest are the pre-existing set the `plugins/vue/service.ts` handoff entry records.

`pnpm test:mutate:file src/plugins/vue/get-type-errors.ts --force` — 94.94% (75 killed, 4 survived, 0 no-coverage). Two earlier runs recorded 94.52% and 93.15% for the same file: the incremental cache keys on source text and reuses verdicts across runs, so a scoped run's numbers move with what it re-tested. The four survivors are pre-existing (`translateVirtualOffset`'s optional chain and its two guards, and the project-wide program-membership guard). Two changed-line survivors were closed: the outer `vueVirtualToReal.has` guard, whose false arm only skips a call that returns immediately for a mapped path — removed as a refactor; and the guard before the add, which became a cost guard once its body changed from returning empty to adding the file, and which a case now pins by asserting a file the program holds is not added.

### The N=5 edge, measured

Five out-of-program files in one `dist/` in a Vue workspace, checked one after another through the real service:

| | `getProgram()` calls | distinct programs | total | errorCounts |
|---|---|---|---|---|
| before the fix | 5 | 1 | 195.9 ms | 0,0,0,0,0 |
| after | 10 | 6 | 220.7 ms | 1,1,1,1,1 |

One program rebuild per out-of-program file, plus the cold build the first pre-check triggers. The extra `getProgram()` call per file is served from the current program.

### Decisions

`builtFileNames` — a snapshot of the file set the service was built with — drives the project-wide `unchecked` count and the `.vue` diagnostics, so a single-file check on an out-of-program SFC cannot report an error for a file the response counts in `unchecked`. Review showed the snapshot does not cover the compiled program, which the add is shared with: an in-program file's import of an added SFC starts resolving once a query added it. The source comment and the internals doc now record that.

Verification then found the same collection still reaching `checked`: `typeCheckedFiles` closes over the program, which the add widens, so an added SFC was counted as checked while `vueGetTypeErrorsFromService` filtered its diagnostics out — `errorCount: 0` for a project the response said it had checked three files of. The closure is now narrowed to `builtFileNames` for the caller's own files, which keeps `checked` a subset of the set the diagnostics come from.

### Defects found and queued

Three handoff entries, each with a measurement behind it:

1. A project-wide Vue check reports a false TS2307 for an in-program file's import of an out-of-program SFC, and the answer changes once a single-file query adds it.
2. A TS-only project asked about a `.vue` file returns `INTERNAL_ERROR` with a stack.
3. `vueGetTypeErrorsForFile` tests its virtual-path mapping where the `.ts` path tests program membership; the two diverge for a deleted-then-reread SFC.

### Reflection

Each correction the review rounds produced was a test that passed without the code it claimed to cover. Removing the behaviour by hand and watching the test fail found every one of them, including two inside fixes from the previous round.
