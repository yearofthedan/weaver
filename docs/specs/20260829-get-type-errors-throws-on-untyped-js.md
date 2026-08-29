# `get-type-errors` throws when the workspace holds a `.js` file the program excludes

**type:** bug
**date:** 2026-08-29
**tracks:** handoff.md # `get-type-errors` throws on a tsconfig with no `include` or `files`

---

## Symptom

A project-wide `get-type-errors` call fails with `INTERNAL_ERROR` instead of returning
diagnostics, whenever the workspace contains any `.js`/`.jsx` file and `allowJs` is not
enabled.

```
input:    weaver get-type-errors '{}' --workspace <project with src/main.ts + jest.config.js,
                                                   tsconfig without allowJs>
actual:   {"status":"error","error":"INTERNAL_ERROR",
           "message":"Error during 'getTypeErrors': Could not find source file:
                      '<workspace>/jest.config.js'."}
           thrown from getValidSourceFile -> getSemanticDiagnostics
           -> tsGetTypeErrorsForProject (get-type-errors.ts:44)
expected: {"status":"success","diagnostics":[...],"errorCount":N,"truncated":false}
```

**The handoff entry's trigger was wrong in three ways, corrected by the experiments below.**
It is not specific to a missing `include`/`files`, not specific to root-level `.js`, and not
caused by ts-morph globbing. `include: ["src"]` still fails; a `.js` nested inside `src/`
still fails; a workspace with no tsconfig at all still fails. A plain
`new Project({ tsConfigFilePath })` does *not* pick the file up — weaver adds it.

## Value / Effort

- **Value:** The whole command is unusable project-wide on any TS project that keeps a
  `.js` config file (`jest.config.js`, `.eslintrc.js`, `vite.config.js`, `tailwind.config.js`)
  without `allowJs` — the default shape of NestJS, and common well beyond it. There is no
  workaround inside weaver: the caller must fall back to `tsc`, the exact tool the
  `weaver-code-inspection` skill tells agents to stop using. The single-file path still works,
  so the workaround is per-file calls with no way to enumerate the files.
- **Effort:** Root cause is isolated to two lines. The fix is localised to the diagnostics
  loop; the tempting alternative (stop adding the files at all) ripples into every operation
  that scans importers. See **Fix**.

## Expected

Project-wide `get-type-errors` returns diagnostics for the files the TypeScript program
actually contains, and reports nothing for files the program excludes — because a file
outside the program has no semantic diagnostics to report, not because they were suppressed.

```
input:    weaver get-type-errors '{}'  (workspace as above)
expected: {"status":"success","diagnostics":[],"errorCount":0,"truncated":false}
```

## Root cause

`TsMorphEngine.addWorkspaceFiles` (`ts-engine/engine.ts:36-44`) walks the workspace for
`TS_EXTENSIONS` — which includes `.js` and `.jsx` (`utils/extensions.ts:2`) — and calls
`project.addSourceFileAtPath` on every hit, unconditionally. It never consults `allowJs`.
ts-morph accepts the files, but the underlying TypeScript *program* is built from the
compiler options, and with `allowJs` unset it excludes them.

`tsGetTypeErrorsForProject` (`ts-engine/get-type-errors.ts:44`) then iterates
`compiler.getProjectSourceFilePaths(workspace)` — ts-morph's list, which holds the added JS
files — and hands each path to `ls.getSemanticDiagnostics`. That resolves the path against
the program via `getValidSourceFile`, which throws on anything the program does not contain.
The two lists diverge by exactly the JS files weaver injected.

**Observed directly.** Probing the built engine against the reproduction workspace:

```
weaver project files: [ '<ws>/jest.config.js', '<ws>/src/main.ts' ]
TS program files:     [ '<ws>/src/main.ts' ]
DIVERGENCE (in weaver list, not in program): [ '<ws>/jest.config.js' ]
```

**Driver isolated by changing one variable at a time** (each variant a fresh workspace, so no
daemon project cache is shared):

| Variant | Result |
| --- | --- |
| Reproduction as reported | **throws** |
| `+ "include": ["src"]` | **throws** — `include` is not the trigger |
| `+ "allowJs": true` | success — this is the driver |
| `jest.config.js` removed | success |
| `.js` nested at `src/legacy.js`, `include: ["src"]` | **throws** — not root-level-specific |
| No tsconfig at all | **throws** |

**Blast radius confirmed, not assumed.** A `move-file` in the same workspace shape returns
`status: success` and rewrites the importer correctly — mutating operations run post-write
diagnostics through `getTypeErrorsForFiles` (`daemon/post-write-diagnostics.ts:16`), which
iterates `filesModified` rather than the project file list, so it never asks the language
service about an excluded file. The single-file path (`tsGetTypeErrorsForFile`) is likewise
unaffected. The project-wide path is the only route through the divergent list.

**Why dogfooding never caught it:** weaver's own repo has zero tracked `.js`/`.jsx` files, so
`addWorkspaceFiles` adds nothing the program rejects and the project-wide call succeeds here.

**Vue projects are affected by the same line.** `vueGetTypeErrorsForProject`
(`plugins/vue/get-type-errors.ts:94`) delegates straight to `tsEngine.getTypeErrors(undefined, scope)`,
so a Vue project with a `.js` config file and no `allowJs` throws identically. Read from the
source, not reproduced — verify it when fixing.

## Fix

**Target behaviour is defined by `tsc`.** Project-wide `get-type-errors` should return what
`tsc --noEmit` returns for the same project. Verified against the reproduction fixture, with a
genuine type error (`bad.toUpperCase()` on a number) planted in `jest.config.js`:

| Config | `tsc --noEmit` |
| --- | --- |
| `allowJs` unset (reproduction shape) | exit 0, reports nothing — the file is not in the program |
| `allowJs: true, checkJs: true` | `jest.config.js(2,5): error TS2339` |

**In `tsGetTypeErrorsForProject` (`ts-engine/get-type-errors.ts:44`), ask only about files the
TypeScript program contains.** The function already holds the language service it needs —
`ls.getProgram()?.getSourceFile(filePath)` answers membership directly, so skip any path it
does not resolve before calling `getSemanticDiagnostics`.

Verified against both fixtures before dispatch — the check discriminates in both directions,
which is the property the guard-rail below depends on:

```
allowJs unset:   OUT  ./jest.config.js      IN   ./src/main.ts
allowJs true:    IN   ./jest.config.js      IN   ./src/main.ts
```

Iterating `program.getSourceFiles()` instead was considered and rejected: that list also
carries `lib.*.d.ts` and everything transitively resolved from `node_modules`, so it would need
its own workspace and declaration-file filtering — more code, and a new way to get the file set
wrong. Filtering the existing list needs no new engine method and leaves
`getProjectSourceFilePaths`'s contract untouched for its other callers.

**Guard-rail — key on program membership, not on the file extension.** A fix that skips `.js`
paths passes the reproduction and silently suppresses the TS2339 above in any project that
sets `allowJs`. The extension is not the property that matters; presence in the program is.

**Do not change `addWorkspaceFiles`.** Removing JS files from the project would remove the
divergence at its source, but it regresses behaviour that works today and matches prior art.
Verified on the reproduction shape — `src/consumer.js` importing `./main.js`, after
`move-file src/main.ts -> src/lib/main.ts` with `allowJs` unset:

```
before: import { greet as g } from "./main.js";
after:  import { greet as g } from "./lib/main.js";     <- rewritten
```

This is deliberate and correct. Editors keep a wider set of files known to the language
service than the set the program type-checks: open a `.js` file in a TS project with `allowJs`
off and you still get navigation and rename support, but no type-checking. `addWorkspaceFiles`
gives weaver the same property, which is what lets a move fix `.js` importers. The two-list
divergence is the intended model; the defect is only that the diagnostics loop asks the wide
list a question that belongs to the program. (A `require()` call in the same file is not
rewritten either way — the existing ts-morph import-declaration boundary, out of scope here.)

**Do not add a "files not type-checked" field to the response.** `tsc` does not report one, and
a file outside the program has no diagnostics to withhold. `filesSkipped` is not a precedent to
copy — it currently carries two incompatible meanings and is being reconsidered separately
(see the handoff entry).

**Adjacent inputs to cover with regression tests:** a `.js` at the workspace root and one
nested under `src/`; a `.jsx`; the same project with `allowJs: true`, which must still report
the JS file's errors; a workspace with no tsconfig at all; and a project whose only files are
excluded JS, which must return `errorCount: 0` rather than an error.

## Security

- **Workspace boundary:** N/A for the filtering approach — it removes paths from a list that
  is already produced by a workspace-scoped walk; it cannot widen what is read.
- **Sensitive file exposure:** N/A — the fix changes which files are *asked about*, and only
  ever narrows that set. No new file content is read.
- **Input injection:** N/A — no user-supplied string reaches a new code path; the paths
  involved come from the existing `walkFiles` scan.
- **Response leakage:** The fix changes the response from an `INTERNAL_ERROR` carrying a
  stack trace with absolute paths to a normal success payload — strictly less internal
  detail exposed. If the fix instead reports excluded files, verify that field carries
  workspace-relative paths like the rest of the response.

## Edges

- **Sibling extensions:** `.jsx` takes the same path as `.js` (both in `TS_EXTENSIONS`).
  `.mjs`/`.cjs` are not in the set and never get added, so they cannot trigger it.
- **`checkJs` without `allowJs`:** `checkJs` alone does not admit JS files to the program;
  confirm the fix keys on program membership rather than on reading `allowJs` directly.
- **Vue project-wide:** same delegation, same throw — cover it.
- **Happy path:** a project that *does* set `allowJs: true` must still report diagnostics for
  its `.js` files; the fix must not filter them out.
- **Empty result:** a workspace whose only files are excluded JS must return
  `errorCount: 0`, not an error and not a truncated list.

## Done-when

- [ ] Reproduction case now produces expected output
- [ ] Regression test covers the exact failing case
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (`docs/commands/get-type-errors.md` for user-facing, `docs/internals/` for implementation)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
