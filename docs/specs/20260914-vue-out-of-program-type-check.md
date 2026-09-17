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
- **A later project-wide check counts the added file.** `addScriptFile` mutates the cached service's `scriptFileNames`, which is `describeCheckedScope`'s `walkedFiles`, so a project-wide check in the same daemon session counts the added file in `unchecked.files` (+1) — it is walked but outside the tsconfig's seed closure. Pin the change in a test so it is deliberate.
- **`addScriptFile` touches one service of the several a workspace can have.** It is reached through `this.services.get(this.cacheKey(…))`, the same shape as `refreshWrittenFile` and `invalidateService`. A sibling service holds no out-of-program path either, so the multi-service gap stays where its own entry records it; the reach is recorded here so a future reader knows the new add touches the same one.
- **Semantic diagnostics carry the real error only.** A tsconfig with `rootDir`/`outDir` that excludes the written file is the shape the *single-file `get-type-errors` judges a file against a tsconfig that excludes it* entry describes, where ts-morph produces TS6059. Measured on this fix: semantic diagnostics carry only the real TS2322; TS6059 appears in `getCompilerOptionsDiagnostics()`, which weaver never queries (`semanticErrors` uses `getSemanticDiagnostics` alone). Keep a cell on it so a change to the diagnostic source cannot import the defect silently.
- **Mutation scope: `src/plugins/**` is commented out of `stryker.config.mjs`'s `mutate` array**, so neither touched file is measured by `pnpm test:mutate`. Both need explicit `pnpm test:mutate:file` runs. `service.ts` currently measures 69.58% — under the 75 break threshold — from 33 survivors and 12 uncovered mutants in the `readFile` cache, the `createLanguage` registration callback and `getScriptSnapshot`, none of which this change touches (its own handoff entry). Acceptance here is every mutant *introduced by this change* killed or classified; the file-level score stays below threshold until that entry is worked.

## Done-when

- [ ] Reproduction case now produces expected output — the literal repro: surgical `replaceText` into `dist/gen.ts` in a Vue workspace reports `status: warn` with the TS2322, and the TS-only control still does
- [ ] `get-type-errors --file` on the same path reports the error in both engines
- [ ] Regression tests cover every adjacent input listed above, including the SFC-importing cell (no TS2307) and the unreadable-path cell (no throw)
- [ ] N=5 out-of-program files in one write measured before and after, and the number recorded in the Outcome
- [ ] Mutation acceptance: explicit `pnpm test:mutate:file` on `src/plugins/vue/service.ts` and `src/plugins/vue/get-type-errors.ts`, with every mutant introduced by this change killed or classified per `mutate-triage`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] `docs/internals/get-type-errors.md` records the on-demand add and why the re-check guard stays; `docs/commands/get-type-errors.md` if the user-visible contract for out-of-program files is stated there
- [ ] The `status: warn` handoff chore removed, covered by the post-write scenario
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
