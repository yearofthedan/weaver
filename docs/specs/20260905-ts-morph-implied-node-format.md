# ts-morph source files carry no `impliedNodeFormat`, so NodeNext diagnostics are wrong

**type:** bug
**date:** 2026-09-05
**tracks:** handoff.md # ts-morph's bundled compiler reports TS1470 on files the host `tsc` compiles cleanly

---

## Symptom

Under `module: NodeNext`, every diagnostic weaver's ts-morph engine produces is
computed as if the file emitted CommonJS, whatever the package's `type` field
says. Two faces, same cause:

**Fabricated errors.** On this repository, where `package.json` sets
`"type": "module"`:

```
input:    node dist/adapters/cli/cli.js get-type-errors '{}'   (workspace: this repo)
actual:   errorCount: 2
          src/daemon/build-id.ts:5:46      TS1470  The 'import.meta' meta-property is not
                                                   allowed in files which will build into
                                                   CommonJS output.
          src/adapters/cli/cli.ts:25:65    TS1470  (same)
expected: errorCount: 0 — `pnpm build` (tsc 6.0.3) exits 0 on the same tsconfig
```

**Missed errors — the dangerous face.** A workspace with `"type": "module"`,
`moduleResolution: NodeNext`, and `src/main.ts` doing `import { value } from "./helper"`:

```
input:    node dist/adapters/cli/cli.js get-type-errors '{}'    (workspace: the fixture)
          node dist/adapters/cli/cli.js get-type-errors '{"file": "src/main.ts"}'
actual:   both return errorCount: 0, diagnostics: []
expected: errorCount: 1 —
          src/main.ts:1:23  TS2835  Relative import paths need explicit file extensions in
                                    ECMAScript imports when '--moduleResolution' is 'node16'
                                    or 'nodenext'. Did you mean './helper.js'?
          which is exactly what `tsc -p tsconfig.json --noEmit` reports.
```

**The engines disagree.** Adding an `App.vue` to that same fixture routes it to
Volar, which reports TS2835 on both `src/main.ts` and `src/App.vue` — the answer
`tsc` gives. Identical TypeScript input therefore gets two different verdicts
depending on whether a `.vue` file happens to exist in the workspace.

## Value / Effort

- **Value:** A false clean is the worst output this command has. An agent reads
  `errorCount: 0` as "my change is type-safe" and there is nothing in the
  response to contradict it — the same reasoning that put `checked`/`unchecked`
  into the response shape. It reaches every diagnostic path in a non-Vue
  project: project-wide `get-type-errors`, single-file `get-type-errors`, and
  the post-write check `getTypeErrorsForFiles` runs over `filesModified` after
  every refactor. `"type": "module"` with `module: NodeNext` is the default
  shape for a modern Node TypeScript package, so this is the common case, not
  an exotic one. There is no workaround from the caller's side — no parameter
  changes it.
- **Effort:** The cause is pinned to a single line in a dependency weaver does
  not control, and `ProjectOptions` exposes no hook to override it (see Root
  cause). Every route is therefore either a workaround inside weaver or an
  upstream change, with materially different risk. This needs design.

## Expected

Weaver's ts-morph engine gives the verdict `tsc` gives for the same tsconfig, on
both faces above, and agrees with the Volar engine on identical TypeScript input.

## Root cause

`@ts-morph/common@0.29.0` never sets `impliedNodeFormat` on any source file it
creates.

`DocumentRegistry.#updateSourceFile`
(`node_modules/.pnpm/@ts-morph+common@0.29.0/.../dist/ts-morph-common.js:2932`)
calls:

```js
createCompilerSourceFile(fileName, scriptSnapshot, compilationSettings.target, version, true, scriptKind)
```

and `createCompilerSourceFile` (same file, `:787`) forwards that third argument
to `ts.createLanguageServiceSourceFile` as its `optionsOrScriptTarget`
parameter. TypeScript accepts either a bare `ScriptTarget` or a
`CreateSourceFileOptions` object there, and only the object form carries
`impliedNodeFormat`. ts-morph always passes the bare `compilationSettings.target`,
so every source file in a ts-morph project has `impliedNodeFormat === undefined`.

With `module: NodeNext` and no `impliedNodeFormat`, TypeScript resolves the
file's emit format as CommonJS. `import.meta` then raises TS1470, and the
ESM-only extension requirement that raises TS2835 is never applied.

**Observed, per program (all against this repo's `tsconfig.json`):**

| Program | `impliedNodeFormat` on `build-id.ts` | Diagnostics |
|---|---|---|
| `ts.createProgram`, host TypeScript 6.0.3 | `99` (ESNext) | none |
| `ts.createProgram`, ts-morph's bundled TypeScript 6.0.2 | `99` (ESNext) | none |
| `new Project({ tsConfigFilePath })` | `undefined` | **TS1470** |

**The bundled compiler version is not the driver.** The handoff entry suspected
`@ts-morph/common`'s frozen TypeScript 6.0.2 resolved the module format
differently from the host 6.0.3. It does not: driven directly, the bundled copy
computes format `99` and reports nothing. That hypothesis is dead.

**Isolating experiment.** Holding the compiler fixed at the host 6.0.3 and
changing only how source files are created — a custom `CompilerHost` whose
`getSourceFile` calls `ts.createLanguageServiceSourceFile` with a bare
`ScriptTarget`, exactly as ts-morph does, versus with the `CreateSourceFileOptions`
the host is handed:

```
[bare ScriptTarget  ] src/daemon/build-id.ts    impliedNodeFormat= undefined  diags= 1470
[bare ScriptTarget  ] src/adapters/cli/cli.ts   impliedNodeFormat= undefined  diags= 1470
[CreateSourceFileOpts] src/daemon/build-id.ts   impliedNodeFormat= 99         diags= none
[CreateSourceFileOpts] src/adapters/cli/cli.ts  impliedNodeFormat= 99         diags= none
```

One variable, both directions.

**Why Volar is unaffected:** `buildVolarService` drives a real TypeScript
language service, which computes `impliedNodeFormat` for its own files. It never
goes through ts-morph's `DocumentRegistry`.

**No supported override exists.** `ProjectOptions` (`ts-morph@28.0.0`,
`lib/ts-morph.d.ts:723-763`) exposes `compilerOptions`, `fileSystem`, and
`resolutionHost`, and nothing that reaches source-file creation. The document
registry is private to `@ts-morph/common` and is not injectable.

## Fix

*Blank by design — routed to `/spec`.* The cause is confirmed, but every route
is a different trade of correctness against risk, and none is a local patch:

- build a plain `ts.Program` from the host `typescript` (already a direct
  dependency at 6.0.3) for the diagnostic paths, leaving ts-morph to serve
  rename and find-references;
- set `impliedNodeFormat` on each compiler source file after ts-morph creates it
  and before diagnostics are requested — reaching past the public API of a
  dependency, and needing to hold across every recreation ts-morph performs on
  edit;
- fix it upstream and pin;
- accept it and make the limit visible in the response.

They differ in whether the two engines converge, what a `refreshFile` cycle
costs, and how much of ts-morph's internals weaver takes on. That is a design
decision, not an implementation detail.

## Security

- **Workspace boundary:** N/A — this is a diagnostic computed over files already
  in the project; no fix route implied above changes which paths are read or
  written.
- **Sensitive file exposure:** N/A — no new file reads. A fix that builds a
  second program reads the same file set the existing program already reads.
- **Input injection:** N/A — no user-supplied string reaches new code; the
  defect and its fixes concern a compiler flag computed from `package.json`.
- **Response leakage:** A fix changes which diagnostics appear, and diagnostic
  messages already carry file paths and source spans. No new class of content
  enters the response.

## Edges

- **Both directions must be verified.** A fix checked only against this
  repository confirms the fabricated-error face and says nothing about the
  missed-error face, which is the one that costs a user something. The TS2835
  fixture is the falsifying case.
- **Sibling diagnostics with the same dependency.** `impliedNodeFormat` also
  gates TS1471 (import attributes), TS1479 (importing ESM from CJS), and
  `verbatimModuleSyntax` checks. A fix that corrects TS1470 and TS2835 by
  special-casing either code has not fixed the defect.
- **The inverse package shape.** A workspace with no `"type": "module"` (or
  `"type": "commonjs"`) under NodeNext should still be judged as CommonJS —
  `import.meta` there is a real TS1470 that must survive the fix. `.mts`/`.cts`
  files pin the format by extension and are a third case.
- **The other two diagnostic paths.** Single-file `get-type-errors` and the
  post-write check over `filesModified` share the ts-morph language service and
  are confirmed to carry the defect (both return `errorCount: 0` on the
  fixture). A fix scoped to the project-wide path leaves them wrong.
- **Engine parity.** The archived project-wide-diagnostics spec records the same
  defect shape shipping three times as a Volar/ts-morph disagreement. This is
  the same disagreement with the engines' roles reversed, so the fix needs a
  case on both engines, not one.
- **Not a regression of the tsconfig-scope change.** It reproduces on a plain
  `new Project({ tsConfigFilePath })` with no workspace walk, which is how the
  archived spec's Edges section already recorded these two errors as expected
  residue.

## Done-when

- [ ] Reproduction case now produces expected output
- [ ] Regression test covers the exact failing case
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] Docs updated if public surface changed (`docs/commands/get-type-errors.md` for user-facing, `docs/internals/get-type-errors.md` for implementation)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
