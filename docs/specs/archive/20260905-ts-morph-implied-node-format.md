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

- **Value:** The defect reaches every diagnostic path in a non-Vue project, but
  the three are not worth the same. Standalone `get-type-errors` competes with
  `npx tsc --noEmit`, which is free, universal and correct by definition — a
  wrong answer there is weaker than an alternative the caller already has.
  **The post-write check is where this costs something.** `getTypeErrorsForFiles`
  runs over `filesModified` after every refactor and reports whether the files
  weaver just rewrote still typecheck; the caller has no substitute for it,
  because its value is that it is attached to the operation and scoped to what
  changed. A false clean there means weaver rewrote a project's imports and
  reported that nothing broke, wrongly — a lie about the one thing weaver
  exists to do. `"type": "module"` with `module: NodeNext` is the default shape
  for a modern Node TypeScript package, so this is the common case. No caller
  parameter changes it.
- **Effort:** Contained. The two diagnostic accessors are already documented as
  returning a raw `ts.LanguageService` with "no ts-morph coupling at the call
  site", and `getLanguageServiceForConfig` has exactly one caller. Everything
  downstream (`semanticErrors`, `capDiagnostics`, `toDiagnostic`) is typed
  against `ts.LanguageService` and `ts.Diagnostic` and does not change. The new
  work is one module and a second cache entry on the existing invalidation
  paths.

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

**Resolution is affected too, not only checking.** Given a dual-published
dependency whose `exports` map names different type declarations per condition,
against the same tsconfig:

```
[host tsc ] resolved: dualpkg/esm.d.ts   diags= none
[ts-morph ] resolved: dualpkg/cjs.d.ts   diags= 2305
```

ts-morph follows the `require` condition where `tsc` follows `import`, so the
module graph itself points at the wrong declaration file. This reaches every
consumer of the ts-morph project, including find-references and rename — a wider
blast radius than diagnostics. It is deliberately **not** fixed here (see Edges).

**Patching `impliedNodeFormat` after creation does not work.** Setting the field
on each compiler source file before the program is first requested:

```
[unpatched]             format= undefined  resolved= cjs.d.ts  diags= 2305
[patched pre-program]   format= 99         resolved= cjs.d.ts  diags= 2307
[after refreshFile]     format= 99         resolved= cjs.d.ts  diags= 2307
```

The format field changes but resolution does not, and the resulting mismatch
turns a wrong-member error (TS2305) into "cannot find module" (TS2307). The
route trades one wrong answer for a worse one and is closed.

**No supported override exists.** `ProjectOptions` (`ts-morph@28.0.0`,
`lib/ts-morph.d.ts:723-763`) exposes `compilerOptions`, `fileSystem`, and
`resolutionHost`, and nothing that reaches source-file creation. The document
registry is private to `@ts-morph/common` and is not injectable.

## Fix

Serve the diagnostic paths from a host-TypeScript language service. ts-morph
keeps serving manipulation, where its AST APIs are doing real work; for querying
it contributes only project construction, which is the thing it gets wrong.

- **New `src/ts-engine/diagnostic-service.ts`.** Builds and caches one
  diagnostic service per tsconfig path — plus one for the no-tsconfig case,
  matching the existing `NO_TSCONFIG_CACHE_KEY` shape — from the host
  `typescript` (already a direct dependency at 6.0.3). Its compiler host reads
  through the `FileSystem` port rather than `node:fs`, per
  `docs/design-principles.md`. The behaviour that matters is that source files
  are created from the `CreateSourceFileOptions` the host supplies, so
  `impliedNodeFormat` is computed rather than dropped.

  **Amended during implementation: `ts.createProgram`, not
  `ts.createLanguageService`.** This section originally specified a
  `ts.LanguageService`. Built that way it fixed both reported faces, but it
  reported 15 errors on *this* repository that `tsc` does not (TS7006, TS2532,
  concentrated in files using ts-morph's own conditionally-typed API). Isolated
  by holding `compilerOptions` and the root file list fixed and swapping only
  the driving API, on a vanilla `ts.sys`-backed host:

  ```
  createProgram         : 0 errors   (matches `tsc -p tsconfig.json --noEmit`)
  createLanguageService : 15 errors
  ```

  The two APIs genuinely disagree, for reasons not chased into the checker
  internals. Since the target is the verdict `tsc` gives, the module builds on
  `ts.createProgram`, rebuilt lazily via `oldProgram` reuse when the file set
  grows. The exported type is a hand-written two-method
  `DiagnosticLanguageService`, not `ts.LanguageService`; `semanticErrors` in
  `get-type-errors.ts` narrows to `Pick<ts.LanguageService,
  "getSemanticDiagnostics">` so the Vue engine's real `ts.LanguageService` still
  satisfies it unchanged. Cache keys, invalidation, and the accessor pair are as
  specified above.
- **`TsMorphEngine` gains `getDiagnosticServiceForFile` and
  `getDiagnosticServiceForConfig`**, alongside the existing accessors rather
  than replacing them. The two are not a wrapper and its target: the by-file
  accessor must *add the file to the service's file set if the tsconfig does not
  already cover it*, which is what `ensureProject` does for the ts-morph side
  today. Collapsing it into `getDiagnosticServiceForConfig(findTsConfigForFile(p))`
  drops that, and single-file checks on an excluded file would silently return
  clean — the same false-clean failure this spec exists to remove. `invalidateProject` (`engine.ts:111`) and `refreshFile`
  (`:261`) drop the cached diagnostic service under the same cache key they
  already use for the ts-morph project, so freshness has one rule, not two.
- **`src/ts-engine/get-type-errors.ts` switches its three lookups** — `:49`
  (single-file), `:59` (project-wide), and `:65`
  (`getProjectSourceFilePathsForConfig`, which feeds `typeCheckedFiles`). A raw
  program exposes its own file list, which is what `type-check-scope.ts` needs
  to compute the closure. `semanticErrors`, `capDiagnostics` and `toDiagnostic`
  are typed against `ts.LanguageService` and `ts.Diagnostic` and do not change.
- **`extract-function.ts:43` keeps `getLanguageServiceForFile`.** It applies
  edits through the ts-morph project, so it stays on ts-morph's service. This is
  the reason the new accessors are added beside the old ones.
- **The Volar path is untouched.** It already drives a real language service and
  already answers correctly, which is the parity target.

**Adjacent inputs** — the fix must not be narrowed to the reported symptom:

- `"type": "module"` + NodeNext + `import.meta` → **no** TS1470 *(this repo)*
- `"type": "module"` + NodeNext + extensionless relative import → TS2835 **is**
  reported *(the false clean; the case that matters)*
- A CommonJS package (`"type"` absent or `"commonjs"`) + `import.meta` → TS1470
  **is still** reported, so the fix does not overcorrect
- `.mts` / `.cts` files, which pin the format by extension regardless of
  `package.json`
- A workspace with no `tsconfig.json`, which the existing no-tsconfig cache key
  covers and which must keep working

### Coverage

Every cell holds a case or a written reason it is empty. An empty unexplained
cell is where this defect returns.

| Input | Project-wide | Single-file | Post-write | Volar |
|---|---|---|---|---|
| ESM + `import.meta` → no TS1470 | ✓ | ✓ | ✓ | ✓ |
| ESM + extensionless import → TS2835 **reported** | ✓ | ✓ | ✓ | ✓ (passes today — pins that the fix does not regress the correct engine) |
| CJS + `import.meta` → TS1470 **kept** | ✓ | ✓ | ✓ | ✓ |
| `.mts` / `.cts` pin format by extension | ✓ | ✓ | — same lookup as single-file, no separate path | ✓ |
| No `tsconfig.json` in the workspace | ✓ | ✓ | — as above | N/A — `buildVolarService` without a tsconfig is the separate solution-style-config entry |

**Test placement.** All of the above land in the existing
`src/operations/getTypeErrors.scenarios.yaml`. They must **not** go in
`src/operations/getTypeErrors.test.ts` (484 lines) or
`src/plugins/vue/get-type-errors.test.ts` (513 lines) — both are past the point
`docs/code-standards.md` calls out, and the archived project-wide-diagnostics
spec already ruled them out for this operation's coverage. The scenario runner
deep-equals the whole response, which is the stronger assertion here anyway.

**Layer-fit.** Every case above needs a real workspace — a `package.json` whose
`type` field is the variable under test, a tsconfig, and a resolved program — so
they are scenarios, not unit tests; none is a pure function of its inputs. The
one exception is `diagnostic-service.ts`'s cache and invalidation behaviour
(same tsconfig returns the same service; `refreshFile` and `invalidateProject`
drop it), which is a pure function of its inputs given a `FileSystem` port and
gets focused unit tests against `InMemoryFileSystem`.

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
- **Deliberately out of scope: the ts-morph project's own resolution.** The
  dual-package finding in Root cause is the same cause reaching a different set
  of consumers — find-references, get-definition and rename walk the ts-morph
  module graph, and it resolves the wrong export condition. Folding it in would
  put two behaviour changes behind one fix, and it needs its own design (a
  `resolutionHost` override, moving those reads onto the host service too, or
  neither). Logged as a separate `[needs design]` entry.
- **Two compilers become resident.** ts-morph's bundled TypeScript 6.0.2 serves
  manipulation while the host 6.0.3 serves diagnostics, so version skew between
  them stops being invisible and becomes observable in output. The Vue path
  already runs host TypeScript beside ts-morph, so the precedent exists, but the
  memory cost of a second program per tsconfig on a long-lived daemon is real
  and should be checked rather than assumed.
- **Engine parity.** The archived project-wide-diagnostics spec records the same
  defect shape shipping three times as a Volar/ts-morph disagreement. This is
  the same disagreement with the roles reversed, so the regression cases run on
  both engines, not one.
- **Not a regression of the tsconfig-scope change.** It reproduces on a plain
  `new Project({ tsConfigFilePath })` with no workspace walk, which is how the
  archived spec's Edges section already recorded these two errors as expected
  residue.

## Done-when

- [ ] Reproduction case now produces expected output
- [ ] Verified on the real path: **every** case in the Coverage table, run through the
      built CLI, each matching `tsc -p <tsconfig> --noEmit` on the same workspace
- [ ] The three core cases verified on the **Volar** engine too, confirming the fix brings
      ts-morph to the answer Volar already gives rather than moving both
- [ ] No service accessor changed outside `src/ts-engine/get-type-errors.ts` — confirmed by
      diff. `extract-function.ts:43` must still call `getLanguageServiceForFile`, and its
      existing tests must pass unchanged
- [ ] Memory of a long-lived daemon holding both programs measured on this repository, and
      the figure recorded in the Outcome — the Edges note calls this unverified
- [ ] Regression test covers the exact failing case
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] Docs updated if public surface changed (`docs/commands/get-type-errors.md` for user-facing, `docs/internals/get-type-errors.md` for implementation)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Shipped 2026-09-06.** 8 commits, `a4ffa75..HEAD`.

### Verification

Driven through the built CLI against real workspaces, each compared to
`tsc -p <tsconfig> --noEmit` on the same input:

| Workspace | weaver | `tsc` |
|---|---|---|
| This repository | `errorCount: 0` | exit 0 |
| ESM + extensionless relative import, project-wide | `1` — TS2835 | TS2835 |
| Same, single-file | `1` — TS2835 | — |
| Same + an `App.vue` (Volar) | `2` — TS2835 on both files | — |
| Dual-published `exports` fixture | `0` | 0 |
| CommonJS package + `import.meta` | TS1470 still reported | TS1470 |

Before the fix the first reported 2 spurious TS1470 and the second reported
`errorCount: 0` against `tsc`'s TS2835 — both faces closed, in both directions.

The dual-package fixture is worth noting: project-wide diagnostics now resolve
the `import` condition, so the *diagnostics* half of the resolution defect went
with this change. The reference-graph half did not — find-references and rename
still walk ts-morph's module graph.

Tests: 1394 → 1425. Mutation on `diagnostic-service.ts`: **54.69% → 71.43%**
(84.75% over covered mutants). Every survivor is classified in a comment at its
line; two groups remain, both equivalent rather than untested, plus one
uncovered group (`directoryExists`/`getDirectories`) that TypeScript reaches
only through `@types`/node_modules discovery, which no fixture in the suite has.

### Architecture changed during implementation

The Fix section originally specified a `ts.LanguageService`. Built that way it
fixed both reported faces but reported 15 errors on this repository that `tsc`
does not. Holding compiler options and the root list fixed and swapping only the
driving API showed `createProgram` at 0 and `createLanguageService` at 15 — a
TypeScript-level divergence, verified independently before the deviation was
accepted. The Fix section records the amendment.

### What the review caught that the implementation did not

Four review lenses ran over the diff. Beyond duplication and dead code, the
efficiency lens found that `refreshFile` dropped the whole diagnostic service,
making every write pay a cold full-project rebuild on the daemon's hot path.

Attempting to fix it surfaced two things neither the spec nor the review knew:
passing `oldProgram` makes a moved file report "not found", and
`moveFile` never calls `invalidateProject`, so an entry that survives a refresh
serves a file that has moved away. The first was narrowed by removing `oldProgram`
alone and watching a `moveFile` scenario go green — but only to *that flag*, not
to a mechanism inside the compiler, which a later probe under minimal options
could not reproduce. Recorded as an observation, not an explanation. Both are now
handoff entries; the incremental rebuild was **not** shipped, because it needs an
invalidation contract that does not exist yet.

The memory question the spec flagged as unverified is now measured: **524 MB**
ts-morph alone, **876 MB** with both programs, **1342 MB** with a second tsconfig.
That is a real cost and its own handoff entry.

### Reflection

**What went well.** Using `tsc` as an oracle made both the diagnosis and the
verification cheap — the false-clean face, which is the one that mattered, was
found by diffing against it rather than by reasoning. Every claim that drove a
decision was reproduced independently before being acted on: the bundled-compiler
hypothesis (killed), the LanguageService divergence (confirmed), the `oldProgram`
regression (isolated to one variable).

**What did not.** The spec said `ts.LanguageService` because I designed it from
the failing symptom without checking that the API I named actually matched `tsc`
on this codebase. One probe at spec time would have caught it. The mutation score
also came in at 54.69% on a brand-new module — the tests exercised a single-root
program with no imports, which is the shape that makes most of the module
unreachable.

**For the next agent.** The `refreshFile` behaviour is a deliberate,
documented regression: it drops the whole program rather than risk serving a
moved-away file. Do not "optimise" it back without reading the two handoff
entries first — the caching is easy and the invalidation contract is the actual
work. And `getDiagnosticServiceForFile` must keep adding the file to the
service's roots; collapsing it into the by-config accessor reintroduces the
false clean this spec exists to remove.
