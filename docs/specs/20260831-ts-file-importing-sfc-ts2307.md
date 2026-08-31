# A `.ts` file importing an SFC always reports TS2307

**type:** bug
**date:** 2026-08-31
**tracks:** handoff.md # A `.ts` file importing an SFC always reports TS2307

---

## Symptom

`get-type-errors` on a `.ts` file in a Vue project reports `Cannot find module
'@/components/Widget.vue' or its corresponding type declarations` (TS2307) for
an SFC that exists on disk. No refactor is involved and the SFC is untouched.

```
input:    get-type-errors on a .ts file whose only content is
          `import Widget from "@/components/Widget.vue"`, in a Vue project
actual:   TS2307 — Cannot find module '@/components/Widget.vue' or its
          corresponding type declarations
expected: no error — the SFC exists and the Volar service the same engine
          already holds resolves it
```

Found 2026-08-29 while fixing the aliased-import defect. Moving an SFC now
rewrites its `.ts` importers, which puts them in `filesModified`, and the
post-write check inspects that array — so the move made a standing defect
visible rather than causing one. Pinned meanwhile by the
`repoints aliased importers of a moved SFC` scenario in
`moveFile.scenarios.yaml`, whose `description` records the expected `warn` as
deliberate.

## Value / Effort

- **Value:** Any `.ts` file importing an SFC is affected, which in a Vue project
  is routine. The false error surfaces on every `get-type-errors` call and on
  the post-write diagnostics of any move that rewrites a `.ts` importer, so an
  agent sees a `warn` on a correct refactor. No workaround beyond ignoring the
  code, which also hides genuine TS2307s.
- **Effort:** The cause is one branch in one method, but the fix is not a
  one-liner: the viable options differ in blast radius, and the project-wide
  path needs restructuring alongside whichever is chosen. See **Fix**.

## Expected

`get-type-errors` on a `.ts` file that imports an existing SFC returns no
diagnostic for that import.

## Reproduction

Run against a project on disk with the shape the `repoints aliased importers of a
moved SFC` scenario uses: `@/*` mapped onto `src/*`, with
`src/components/Widget.vue` imported through the alias from both `src/App.vue`
and `src/main.ts`. No refactor, nothing moved.

```
$ weaver get-type-errors --workspace <root> '{"file":"<root>/src/main.ts"}'
{"status":"success","diagnostics":[{"file":".../src/main.ts","line":1,"col":20,
 "code":2307,"message":"Cannot find module '@/components/Widget.vue' or its
 corresponding type declarations."}],"errorCount":1,"truncated":false}

$ weaver get-type-errors --workspace <root> '{"file":"<root>/src/App.vue"}'
{"status":"success","diagnostics":[],"errorCount":0,"truncated":false}
```

The same specifier, through the same alias, resolves from the SFC and fails from
the `.ts` file. The project-wide form (`'{}'`, no `file`) reports the identical
TS2307, because `vueGetTypeErrorsForProject` merges
`tsEngine.getTypeErrors(undefined, scope)` into its result.

## Root cause

`VueEngine.getTypeErrors` (`src/plugins/vue/engine.ts:400-409`) branches on file
extension: a `.vue` file goes to `vueGetTypeErrorsForFile` against the Volar
service, and anything else falls through to `this.tsEngine.getTypeErrors(file,
scope)`. The ts-morph project has no `.vue` language support, so a `.vue`
specifier resolves to nothing and TypeScript emits TS2307 — while the Volar
service the same engine already holds resolves it.

Isolated two ways, holding the workspace and the file constant and changing only
which service answers:

- **Direct probe.** `buildVolarService(tsconfig, main.ts, root)` followed by
  `baseService.getSemanticDiagnostics("<root>/src/main.ts")` returns `[]`. The
  Volar service has `main.ts` in its script set and resolves the SFC import.
- **Routing flip.** Replacing only the `this.tsEngine.getTypeErrors(file, scope)`
  line with a call through `getService(file, scope.root).baseService`, rebuilding,
  and re-running the exact repro command drops the diagnostic to
  `{"diagnostics":[],"errorCount":0}`. Restoring the line brings TS2307 back.

Routing is the driver, as the handoff entry theorised.

## Not this bug: a second defect the real project surfaced

Reproducing against a real Vue app with real `node_modules` showed the described
TS2307 **plus** a different failure that must not be folded into this one:
`get-type-errors` on any `.vue` file there returns `INTERNAL_ERROR — Could not
find source file`, thrown from `TsMorphEngine`, and `@/`-aliased imports of plain
`.ts` modules also report TS2307.

Cause of that second failure, confirmed by probe: the project root
`tsconfig.json` is solution-style (`"files": []` with `references`), so
`ts.parseJsonConfigFileContent` yields **0 `fileNames` and no `paths`**,
`isVueProject` returns `false`, and the Vue plugin never engages for the whole
workspace. Logged separately in `handoff.md` — it is a project-detection defect,
not a diagnostics-routing one.

## Fix

Route `.ts` diagnostics in a Vue project through the Volar service the engine
already holds, at all three sites that answer a diagnostics question. A probe
settled the approach: given a `.ts` file with one valid SFC import, one missing
SFC import and one real type error, ts-morph reports all three (the first
falsely) while Volar reports only the last two. Volar drops the false positive
and keeps every genuine diagnostic, so this is a correctness fix, not a
suppression.

**1. Single file.** In `VueEngine.getTypeErrors` (`src/plugins/vue/engine.ts:400-409`),
replace the non-`.vue` fall-through to `this.tsEngine.getTypeErrors(file, scope)`
with a call through `getService(file, scope.root).baseService.getSemanticDiagnostics(file)`.
Diagnostics for a `.ts` file come back carrying a real `d.file`, so the existing
`toDiagnostic` in `src/ts-engine/get-type-errors.ts` maps them directly — the
source-map translation in `translateVirtualOffset` is only needed for `.vue`.
Keep the `MAX_DIAGNOSTICS` cap and the `truncated` flag consistent with the
other two paths.

**2. Project-wide.** `vueGetTypeErrorsForProject` stops merging
`tsEngine.getTypeErrors(undefined, scope)` and iterates the Volar service for
both file kinds: `.vue` through the existing `vueGetTypeErrorsFromService`, and
everything else through `baseService`. `CachedService` does not currently expose
its script list, so it gains a `scriptFileNames` field (the local already exists
in `buildVolarService`). Constrain the iteration to the tsconfig's own file
list. `buildVolarService` deliberately pulls in every workspace TS/JS file via
`walkFiles` so test files stay visible to rename and find-references; iterating
that set for diagnostics would start reporting errors in files the tsconfig
excludes, which is a behaviour change this fix is not for.

**3. Post-write.** The seam already exists and the wrong side of it is being
called. `makeRegistry` returns both `projectEngine()` (Vue engine when the
project is Vue) and `tsEngine()` (always ts-morph), and `dispatcher.ts:386` asks
for the latter. Switch that call to `projectEngine()`, and widen
`getTypeErrorsForFiles` (`src/daemon/post-write-diagnostics.ts`) to take the
`Engine` interface instead of `TsMorphEngine`, looping `engine.getTypeErrors(file,
scope)` per file and aggregating into the three `PostWriteDiagnostics` fields.

`getTypeErrorsForFiles` currently calls `compiler.refreshSourceFile(file)` before
each check, and that method is `TsMorphEngine`-specific. Add `refreshFile(path):
void` to the `Engine` interface: `TsMorphEngine` maps it to the existing
`refreshSourceFile`, and `VolarEngine` maps it to its existing
`invalidateService`. The Vue engine already invalidates on its own writes, so
this is belt-and-braces there — but a post-write freshness guarantee should be
stated in the interface rather than left to each engine's internal habits. The
alternative, reaching for the registry's module-level `invalidateFile` from
inside the function, was rejected: `getTypeErrorsForFiles` takes every other
dependency as an argument, and reaching for module state would be the only
exception.

**Adjacent inputs.** A relative specifier (`./Widget.vue`) as well as an aliased
one; a `.ts` file importing an SFC that genuinely does not exist, which must
still report TS2307; a `.tsx` file, which takes the same non-`.vue` branch; the
project-wide form with no `file`; and a plain TypeScript project with no `.vue`
files anywhere, which must keep reporting exactly what it reports today.

## Test plan

The pin becomes the proof. `repoints aliased importers of a moved SFC` in
`src/operations/moveFile.scenarios.yaml` currently asserts `typeErrorCount: 1`,
with a `description` explaining that the `warn` is deliberate. Flip it to
`typeErrors: none` and delete that rationalising paragraph — the scenario was
written to hold the defect still, and the fix retires it.

Add scenarios alongside it for the relative-specifier form and for a move that
leaves a genuinely broken SFC import, which must still return `warn`. Cover the
single-file and project-wide paths in `src/plugins/vue/get-type-errors.test.ts`,
which is where the Volar diagnostics translation is already tested.

`getTypeErrorsForFiles`'s own tests (`src/daemon/post-write-diagnostics.test.ts`,
7 cases) need their signature updated for the `Engine` widening but not
relocating — they cover aggregation, the `.ts` filter and the `MAX_DIAGNOSTICS`
cap, inputs no existing scenario builds. Migrating them to a scenario file is
out of scope and deliberately not logged.

## Security

- **Workspace boundary:** N/A for the boundary itself — the fix changes which
  service answers a diagnostics question, and adds no file read or write.
  `buildVolarService` already walks the workspace under the same rules and is
  already built for every other Vue operation.
- **Sensitive file exposure:** N/A — no new file content is read. The Volar
  service's file set is unchanged by this fix; only which of its members are
  queried for diagnostics changes.
- **Input injection:** N/A — no user-supplied string reaches a new sink. The
  `file` parameter is validated by the operation layer before either engine
  sees it, exactly as today.
- **Response leakage:** Diagnostic messages are compiler-generated and already
  agent-visible. The fix removes messages rather than adding them. The one thing
  to watch is item 2: constraining project-wide iteration to the tsconfig file
  list is what keeps files the project excludes out of the response.

## Edges

- A `.tsx` file in a Vue project — same non-`.vue` branch, must be covered.
- A `.js`/`.jsx` file in a Vue project with `allowJs`, which ts-morph
  deliberately admits to the project graph but excludes from the program.
- A Vue project whose tsconfig does not list `.vue` in `include` — the
  "bundler-only Vue setup" `buildVolarService` already compensates for.
- A plain TypeScript project: `VolarEngine` is never constructed, so nothing
  should change. Worth an explicit regression case, since this is the majority
  path and the fix must not touch it.
- The happy path for `.vue` files, which already routes to Volar and must keep
  producing identical output after item 2 restructures the project-wide branch.
- Not covered here, logged separately: `getTypeErrorsForFiles` filters to
  `.ts`/`.tsx`, so a move that breaks an SFC still reports nothing.

## Red flags

- `src/plugins/vue/engine.ts` is 482 lines and `src/plugins/vue/get-type-errors.test.ts`
  is 339. Neither is over the point where a split is automatic, but both are
  where this change lands — check mixed responsibilities before adding to them
  rather than after.
- Item 2 is the only part that changes what a *passing* project reports. If the
  tsconfig-file-list constraint is dropped or wrong, the project-wide form
  starts reporting errors in excluded files and every consumer sees new noise.

## Done-when

- [ ] Reproduction case now produces expected output
- [ ] Regression test covers the exact failing case
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] Docs updated if public surface changed (`docs/commands/<name>.md` for user-facing, `docs/internals/<name>.md` for implementation)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
