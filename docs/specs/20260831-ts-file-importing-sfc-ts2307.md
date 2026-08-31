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

`VueEngine.getTypeErrors` (`src/plugins/vue/engine.ts:380-385`) branches on file
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

*Left blank deliberately: the fix has architectural forks and needs `/spec`.*

The routing is confirmed, but "which service should answer for a `.ts` file in a
Vue project" has more than one viable answer, with different correctness and
blast radius:

- Route `.ts` diagnostics through the Volar service. Matches how the SFC path
  already resolves, but changes the diagnostics every `.ts` file in a Vue project
  reports, not only the `.vue`-import ones. The project-wide path
  (`vueGetTypeErrorsForProject`) currently merges the ts-morph whole-project
  result, so it needs restructuring alongside. The experiment above stubbed
  `line`/`col`; a real implementation needs offsets mapped against the `.ts`
  source directly, not through Volar's source map, which only covers `.vue`.
- Teach the ts-morph project to resolve `.vue` specifiers, leaving routing as-is.
  Narrower, but puts SFC knowledge inside the engine that exists not to have it.
- Filter TS2307 on `.vue` specifiers out of `.ts` results. Rejected on sight: it
  hides a genuinely missing SFC, which is the failure the code exists to report.

Adjacent inputs a fix must cover: relative (`./Widget.vue`) as well as aliased
specifiers; the project-wide form with no `file`; a `.ts` file importing an SFC
that genuinely does not exist, which must still report TS2307; and the post-write
diagnostics path in `checkTypeErrors`, where the defect became visible.

## Security

*Pending — completed with the Fix.*

## Edges

*Pending — completed with the Fix.*

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
