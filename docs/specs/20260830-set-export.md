# set-export: add or remove `export` on a top-level declaration

**type:** change
**date:** 2026-08-30
**tracks:** handoff.md # *No operation changes a symbol's visibility* → docs/commands/set-export.md + docs/internals/set-export.md; handoff.md # *`resolveParams` is a third copy of the CLI's path resolution* → folded in as the prerequisite seam

---

## Context

Adding or removing `export` on a declaration is a structural edit no weaver operation covers, so agents fall back to `sed` or manual `Edit` with a hand-written regex per declaration form (`function`, `const`, `class`, `type`, `interface`) — and get silence when the form doesn't match. That is exactly the failure mode the weaver-refactor skill tells agents to avoid. ts-morph's `setIsExported(bool)` covers every declaration kind uniformly, so one compiler-aware operation closes the gap. This spec also folds in the scenario-runner fix that `set-export` requires to adopt the scenario format: it is the first scenario adopter with a literal-string parameter (`symbolName`), which the runner's resolve-every-string rule corrupts.

## User intent

*As an agent refactoring code, I want to add or remove `export` on a top-level declaration with one validated call, so that the edit is correct for every declaration form and un-exporting never silently breaks importers.*

## Relevant files

- `src/ts-engine/move-symbol.ts` — pattern for symbol-level structural edits (lookup → scope writes → invalidation); its fallback scan is the model for seeing files outside the project graph
- `src/ts-engine/symbol-ref.ts` — `SymbolRef.fromExport`: name → exported-declaration resolution; `isDirectExport()` distinguishes re-exports
- `src/ts-engine/non-exported-declaration.ts` — `findNonExportedDeclaration`: name-based lookup of non-exported top-level declarations (the add side's lookup; note it does not cover enums)
- `src/ts-engine/remove-importers.ts` — compiler-resolved module-specifier matching (`getModuleSpecifierSourceFile`) across the project graph
- `src/ts-engine/extract-function.ts` — single-file action pattern (scope writes, invalidation, result shape); `.vue` rejected by VolarEngine before reaching the ts action
- `src/operations/extractFunction.ts` — thin operation wrapper pattern (`assertFileExists` + engine call)
- `src/adapters/schema.ts` — Zod arg schemas; identifier-regex convention (`newName`, `symbolName`)
- `src/daemon/dispatcher.ts` — `OPERATIONS` table (holds `pathParams` per method), post-write diagnostics + status wiring that the scenarios assert through
- `src/adapters/cli/operations.ts` — `SUBCOMMANDS` table; `resolveRelativePaths`
- `src/plugins/vue/engine.ts` — VolarEngine delegation pattern (`.vue` guard, TS work delegates to `this.tsEngine`)
- `src/__testHelpers__/scenarios/scenario-runner.ts` — `resolveParams` (the seam to fix), `executeScenario`
- `src/__testHelpers__/scenarios/scenario-oracle.ts` + `scenario-schema.ts` — `changed`/`unchanged` effect contract, deep-equal response, `typeErrors: none` sugar
- `src/operations/moveFile.scenarios.yaml` + `moveFile.scenarios.test.ts` — scenario-format exemplar, including `.vue` fixtures through the real Volar path
- `src/operations/operations-purity.test.ts` — auto-covers any new file in `src/operations/` (no `node:fs`)
- `.claude/skills/weaver-refactor/SKILL.md` — discovery surface to update
- `.claude/skills/scenario-tests/SKILL.md` — its `resolveParams` gotcha note becomes stale once the seam lands

### Red flags

- **Test hotspots:** none. All test surface is new files (`setExport.scenarios.yaml` + its vitest file). `dispatcher.ts` and `cli/operations.ts` each grow one table entry.
- **Layer-fit:** the seam AC is runner wiring — verified through `executeScenario` with an existing method (`searchText`). All behaviour ACs are observable through `dispatchRequest` (response + workspace tree) and live at the scenario layer. No focused ts-engine unit tests are planned; they are only justified if mutation testing later finds a branch the scenarios cannot reach.

## Value / Effort

- **Value:** A routine structural edit becomes one call that is correct for every declaration form — no per-form regex, no silence on mismatch — idempotent on retry, and guarded in the dangerous direction: un-exporting a symbol other files use refuses and names the referencing files instead of silently breaking them (the post-write type check only covers `filesModified`, so an unguarded un-export is invisible). Removes the last fallback to `sed`/`Edit` for visibility edits, and lands the runner fix that unblocks scenario adoption for any future literal-string method.
- **Effort:** One new ts-engine action + thin operation wrapper + Zod schema + one `OPERATIONS` entry + one `SUBCOMMANDS` entry + one `Engine` interface method (+ VolarEngine delegation) + one error code. The remove direction's external-reference detection (language-service references over the project graph + an AST scan of import/export declarations for files outside it, mirroring moveSymbol's two layers) is the bulk. All existing patterns; no new infrastructure. The test surface is almost entirely YAML.

## Behaviour

All behaviour ACs run through `dispatchRequest` as scenario cases (`src/operations/setExport.scenarios.yaml`), exercising schema validation, path-param resolution, the real engine, post-write diagnostics, and status wiring. Fixtures include a minimal `tsconfig.json` per project. Paths below are workspace-relative as the scenario oracle sees them.

**Seam (prep — lands first, with its own test):**

- [ ] **AC0 — the scenario runner resolves only declared path params.** The dispatcher's per-method `pathParams` declaration is exported and the runner uses it instead of resolving every relative string. A `searchText` scenario with `pattern: "foo"` (searchText declares `pathParams: []`) dispatches the literal string unjoined — before the fix the pattern arrives as `<workspace>/foo`. Every existing `moveFile` scenario still passes (declared path params resolve as before).

**Add direction:**

- [ ] **AC1 — add export to a function.** `src/a.ts` = `function foo() { return 1; }\n`; `setExport {file: src/a.ts, symbolName: foo, exported: true}` → response `{status: success, filesModified: [src/a.ts], filesSkipped: [], symbolName: "foo"}` (+ `typeErrors: none` sugar); `src/a.ts` becomes `export function foo() { return 1; }\n`; `tsconfig.json` unchanged.
- [ ] **AC2 — every supported declaration form.** Non-exported `const foo = 1;`, `class Foo {}`, `interface Foo {}`, `type Foo = number;`, `enum Foo {}` each gain the `export` keyword with the rest of the file byte-identical. Enums excluded — see Edges.

**Remove direction:**

- [ ] **AC3 — remove export when nothing outside the file references it.** `src/a.ts` = `export function foo() { return 1; }` plus a local call to `foo()` in the same file; no other file references it; `exported: false` → `src/a.ts` becomes `function foo() { return 1; }` (local call intact), success response.
- [ ] **AC4 — external use blocks removal.** With `src/b.ts` alongside:
  - `import { foo } from "./a";` (used) → `{status: error, error: "SYMBOL_IN_USE", message: …names src/b.ts…}`; every file byte-unchanged.
  - The same import **unused** still blocks — the import statement itself would break.
  - `export { foo } from "./a";` (re-export, no other use) → `SYMBOL_IN_USE`.
  - `import * as a from "./a";` + `a.foo()` → `SYMBOL_IN_USE`.
  - Controls that must NOT block: `src/b.ts` importing a different symbol (`import { bar } from "./a";`) → removal proceeds; a namespace import that never touches `foo` → removal proceeds.

**Contract:**

- [ ] **AC5 — idempotent no-op.** `foo` already exported + `exported: true` → `{status: success, filesModified: [], filesSkipped: [], symbolName: "foo"}`, `src/a.ts` byte-unchanged. Symmetric: non-exported + `exported: false`. With `filesModified` empty no `typeErrors` fields are attached — the deep-equal response pins that shape difference. This is also what distinguishes "already done" from `SYMBOL_NOT_FOUND` on mechanical retry.
- [ ] **AC6 — SYMBOL_NOT_FOUND.** The name matches no top-level declaration, exported or not: absent entirely; present only function-local; present only as a class member. File byte-unchanged.
- [ ] **AC7 — NOT_SUPPORTED set.** Each returns `{status: error, error: "NOT_SUPPORTED"}` with the reason in the message, all files byte-unchanged:
  - `.vue` target file.
  - The name resolves only through a re-export in this file (`export { foo } from "./other"` where `other.ts` owns the declaration).
  - The declaration is exported only via a trailing `export { }` statement (`const foo = 1;` + `export { foo };`) — removing nothing would leave it exported.
  - The name resolves only to a default export (`export default function foo()`).
  - Multiple top-level declarations share the name (function overloads).
  - The name is one declarator of a multi-declarator statement (`const a = 1, foo = 2`) — either direction would drag the sibling declarator with it.

**Vue projects:**

- [ ] **AC8 — `.ts` targets in a project containing `.vue` files.** Add and remove behave as above. Un-export is blocked when a `.vue` SFC's script imports the symbol (`SYMBOL_IN_USE`), and when any workspace file outside the tsconfig `include` set imports it — the same two detection layers moveSymbol uses.

## Structural criteria

(none)

## Interface

New CLI subcommand `set-export`; daemon method `setExport`.

**Parameters** (`SetExportArgsSchema`):

- `file` (required string) — absolute path to the `.ts`/`.tsx` file containing the declaration. Declared as a path param in both `OPERATIONS` and `SUBCOMMANDS`. Bounds: must exist (`FILE_NOT_FOUND`), inside the workspace (`WORKSPACE_VIOLATION`), no control/fragment characters (`INVALID_PATH`). `.vue` → `NOT_SUPPORTED`. Adversarial: paths with spaces are fine (string param, no shell); traversal attempts hit the workspace check.
- `symbolName` (required string) — the declaration's name, constrained to `^[a-zA-Z_$][a-zA-Z0-9_$]*$` (same convention as `move-symbol`). Names a **top-level** declaration only — function-locals, class members, and namespace members are invisible to the operation (`SYMBOL_NOT_FOUND`). **Not a path** — the scenario runner must never resolve it (AC0).
- `exported` (required boolean) — `true` adds the `export` keyword; `false` removes it.
- `checkTypeErrors` (optional boolean, default on) — standard convention; dispatcher attaches diagnostics when `filesModified` is non-empty.

**Success response:** `{status: "success"|"warn", filesModified: [<file>] | [], filesSkipped: [], symbolName}`. `filesSkipped` is always empty — single file, workspace-validated upfront — and is present for contract parity with every other write operation. The no-op case returns empty `filesModified` and therefore carries no `typeErrors` fields.

**Errors:**

- `FILE_NOT_FOUND` — `file` does not exist.
- `SYMBOL_NOT_FOUND` — no top-level declaration with that name, exported or not.
- `SYMBOL_IN_USE` (**new code**) — `exported: false` while other files reference the symbol. Message names the symbol and the referencing files (absolute paths, per existing EngineError convention, e.g. move-symbol's `SYMBOL_EXISTS`); lists at most 10 files plus the total count.
- `NOT_SUPPORTED` — the AC7 set.
- Dispatcher level, unchanged: `VALIDATION_ERROR`, `WORKSPACE_VIOLATION`, `INVALID_PATH`.

**Engine surface:** `Engine.setExport(file, symbolName, exported, scope): Promise<SetExportResult>` with `SetExportResult { filesModified, filesSkipped, symbolName }` in `operations/types.ts`. TsMorphEngine implements via a new standalone action (`ts-engine/set-export.ts`); VolarEngine rejects `.vue` targets and delegates the rest to `tsEngine`.

**Remove-direction detection (two layers, mirroring moveSymbol):** language-service references at the declaration position cover files in the project graph (import specifiers count as references, so unused imports block; references through re-export chains are included); workspace files outside the graph — `.vue` SFC scripts, files outside the tsconfig `include` — get an AST scan of import/export declarations whose specifier resolves to the target file and which name the symbol. References inside the declaring file never block.

**Seam interface change:** `dispatcher.ts` exports the per-method `pathParams` declaration (its `OPERATIONS` table already holds it); `scenario-runner.ts` resolves only those params, replacing the resolve-every-string rule.

## Open decisions

None — all forks resolved with the user 2026-08-30:

1. **First-class operation vs a documented replace-text recipe** → first-class operation. The recipe leaves the core pain intact (agents still hand-write a regex per declaration form, with silence on mismatch) and contradicts the skill's own "never sed / manual edits" guidance; `setIsExported` makes the compiler path cheap and uniform.
2. **Both directions vs add-export only** → both, one operation. The primitive and all wiring are shared; un-export without the external-reference guardrail would silently break importers (the post-write check covers only `filesModified`), so a guardrail-less remove direction was not shippable and the guarded version's marginal cost is one detection scan.
3. **Naming and identification** → `set-export` with `exported: boolean`; name-based identification (`file` + `symbolName`), consistent with `move-symbol` and with the finding that agents often lack line/col.
4. **Vue** → `.vue` targets `NOT_SUPPORTED` (top-level `export` is not valid in `<script setup>`); `.ts` targets in Vue projects fully supported, including SFC-aware detection.
5. **Folding the resolveParams handoff item** → folded as the prerequisite seam AC. It is test-harness plumbing with no standalone user value and a hard dependency of scenario adoption; its design direction was already agreed in the handoff entry.

Consequences to watch: the ts-engine action is the primitive the future moveSymbol auto-export (Could tier) should reuse — keep it callable without operation-layer coupling. `SYMBOL_IN_USE` messages embed absolute paths per EngineError convention; if that convention ever changes to workspace-relative, the scenarios' deep-equal messages change with it.

## Security

- **Workspace boundary:** The only write is the single target file, through `scope` (the port), after dispatch-boundary validation (`validateFilePath` + workspace containment on the declared path param). The remove direction writes nothing — it refuses when references exist — so there is no second write path.
- **Sensitive file exposure:** No new sensitive-content surface. The target must parse as a TS/TSX source file for any declaration to resolve; same posture as `rename`/`extract-function` (neither sensitive-checks its target file).
- **Input injection:** `symbolName` is constrained to the identifier regex before it reaches any code path; `file` passes `validateFilePath`. No shell involvement, no string interpolation into paths beyond validated params.
- **Response leakage:** `SYMBOL_IN_USE` names files from the user's own project graph — no foreign content. No file content ever enters a response. Absolute paths in error messages match the existing EngineError convention.

## Edges

- `.tsx` targets behave identically to `.ts` (same engine path).
- **Enums are out of scope.** `findNonExportedDeclaration` (the add side's lookup parity) does not cover enums, so an enum `symbolName` yields `SYMBOL_NOT_FOUND` today; extending the lookup is a follow-up if demanded. AC2 pins the five supported forms.
- The no-op success returns empty `filesModified` and therefore no `typeErrors` attachment — scenarios pin both shapes.
- Local references inside the declaring file never block removal; only references in other files do.
- An unused named import still blocks; a namespace import that never touches the symbol does not.
- Ambient (`declare`) declarations and namespace members are top-level-but-not-module-scope for this operation's purposes: lookup sees top-level statements only, consistent with `move-symbol`.
- `SYMBOL_IN_USE` messages cap the file list at 10 plus a total count.
- `checkTypeErrors: false` skips the post-write check (dispatcher convention, not re-tested here).
- The two detection layers must agree with moveSymbol's definition of "outside the project graph" so a `.vue` SFC or an out-of-include file can never slip past the remove direction.

## Done-when

- [ ] All ACs verified by tests: AC0 via a `searchText` scenario + surviving moveFile scenarios; AC1–AC8 in `src/operations/setExport.scenarios.yaml`
- [ ] Mutation score ≥ threshold for touched files — `pnpm test:mutate:file` per file; note `src/operations/**` and `src/ts-engine/**` are commented out of the default mutate array, so runs must be explicit (`--mutate <files> --force`, scratch `--incrementalFile`), per the scenario-tests skill
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated (public surface changed):
  - README.md — Refactor row in the commands table
  - `docs/commands/set-export.md` created (when, inputs, output, errors, examples, limits — including the supported declaration forms and the `.vue` restriction)
  - `docs/internals/set-export.md` created (how it works: `setIsExported`, the two-layer detection, why the guardrail is mandatory)
  - `docs/commands/README.md` — index row + Vue-support footnote style, consistent with existing rows
  - `docs/reference/error-codes.md` — add `SYMBOL_IN_USE`
  - `.claude/skills/weaver-refactor/SKILL.md` — frontmatter description, "Pick a command" table row, a body section, `SYMBOL_IN_USE` in the errors list
  - `.claude/skills/scenario-tests/SKILL.md` — replace the `resolveParams` gotcha (the divergence is gone; the runner resolves only declared path params)
  - handoff.md current-state section (command count / layout)
- [ ] Handoff entries removed at ship time: *No operation changes a symbol's visibility* and *`resolveParams` is a third copy of the CLI's path resolution* (the latter's residual — collapsing the `SUBCOMMANDS`/`OPERATIONS` declaration copies — is absorbed into the *get-type-errors scenarios* entry, which already references it)
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/internals/set-export.md` or the relevant `docs/tech/` doc (skip if nothing worth recording)
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
