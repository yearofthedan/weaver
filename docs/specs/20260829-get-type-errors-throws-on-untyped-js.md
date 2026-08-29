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

*Left blank pending a design pass. The two candidate approaches differ in blast radius, not
just implementation.*

**Constraint the design pass must respect, verified here.** Removing the JS files from the
project is not a free "fix the cause" option: with `allowJs` off, weaver currently *does*
rewrite an ESM import inside a `.js` file when the target moves. Observed on the reproduction
shape — `src/consumer.js` importing `./main.js`, after `move-file src/main.ts -> src/lib/main.ts`:

```
before: import { greet as g } from "./main.js";
after:  import { greet as g } from "./lib/main.js";     <- rewritten, allowJs unset
```

That reach comes from `addWorkspaceFiles` adding the file. Making that walk `allowJs`-aware
would trade a loud `INTERNAL_ERROR` on one read-only command for a silently stale import
across every move and rename — a strictly worse failure. (A `require()` call in the same file
is not rewritten either way; that is the existing ts-morph import-declaration boundary, not
part of this bug.)

So the fork is where the fix sits, not whether the divergence is real:

- **At the point of use** — `tsGetTypeErrorsForProject` asks only about files the program
  contains (filter the list, or iterate the program's list instead). Localised; keeps JS
  importer reach intact. Leaves the divergent list in place for any future consumer of
  `getProjectSourceFilePaths` to trip over.
- **At the source** — `addWorkspaceFiles` stops adding what the program rejects. Removes the
  divergence for everyone, but regresses the JS importer rewriting shown above.
- **Open question either way** — whether the response should tell the caller that JS files
  were not type-checked, or stay silent because a file outside the program has nothing to
  report. `filesSkipped` is the existing precedent for "weaver declined to touch this".

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
