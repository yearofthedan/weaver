# Project-wide diagnostics answer for a tsconfig, not the workspace walk

**type:** change
**date:** 2026-09-03
**tracks:** handoff.md # Project-wide diagnostics report files the tsconfig excludes → docs/commands/get-type-errors.md

---

## Context

`TsMorphEngine.addWorkspaceFiles` walks the whole workspace and adds every TS/JS file to the ts-morph project so that rename and find-references reach files the tsconfig excludes. `buildVolarService` carries the identical walk. Project-wide `get-type-errors` then asks for diagnostics over that walk-augmented set, so it reports files the tsconfig excludes — judged under compiler options that were never meant for them. The walk is right for the reference graph; this change stops diagnostics following it.

## User intent

*As a developer using weaver through an agent, I want a project-wide type check to give the same verdict my build gives, so that I can tell whether my change broke something instead of sifting errors my compiler never reports.*

## Relevant files

- `src/ts-engine/engine.ts` — `addWorkspaceFiles` (:38) computes the tsconfig-derived set as `existing` and discards it; `getProjectForDirectory` (:87) already caches one project per tsconfig path, so an explicit tsconfig needs no new cache shape
- `src/ts-engine/get-type-errors.ts` — `tsGetTypeErrorsForProject` (:51) iterates `getProjectSourceFilePaths`; this is the call site that changes
- `src/plugins/vue/get-type-errors.ts` — `vueGetTypeErrorsForProject` (:116) iterates `service.scriptFileNames`; its doc comment asserts parity with `TsMorphEngine` and must keep it
- `src/plugins/vue/service.ts` — `buildVolarService` (:144) seeds `projectFiles` from `tsConfigFileNames` plus on-disk `.vue`, then appends the walk (:178). Unlike ts-morph it does **not** pre-resolve the transitive closure — the reason a shared helper is needed rather than a per-engine subtraction
- `src/daemon/dispatcher.ts` — `getTypeErrors` descriptor (:210) pairs `pathParams: []` with `usesFileForRegistry: true`; engine selection at :376-383 reads `pathParams[0]` when present
- `src/adapters/cli/operations.ts` — `SUBCOMMANDS["get-type-errors"]` (:64) declares `pathParams: []`, the second copy of the same declaration
- `src/adapters/schema.ts` — `GetTypeErrorsArgsSchema` (:157); `ReplaceTextArgsSchema` is the precedent for a `.refine()` XOR between alternative scopings
- `src/operations/types.ts` — `GetTypeErrorsResult` (:131), the response shape being extended
- `src/utils/ts-project.ts` — `findTsConfig` (:23) matches only the literal `tsconfig.json`; `isVueProject` (:56) takes a tsconfig path directly, which is what explicit-tsconfig engine selection needs
- `src/__testHelpers__/scenarios/scenario-runner.ts` — 83 lines, fully generic over `method`; resolves exactly the params the dispatcher declares (:67), which is why it is the only layer that can falsify the path-resolution ACs

### Red flags

- `src/operations/getTypeErrors.test.ts` is 484 lines and `src/plugins/vue/get-type-errors.test.ts` is 497 — both at the point where `docs/code-standards.md` says mixed responsibilities are common. **Do not add this change's coverage to them.** New behaviour lands in a scenario file, which is where it belongs on falsifiability grounds anyway (below).
- No fixture in `src/__testHelpers__/fixtures/` has a file outside its tsconfig's include set — `ts-errors`, `ts-100-errors` and `vue-errors` all use `include: ["src/**/*"]` with every file under `src/`. The defect is therefore invisible to every existing test, and new fixtures are required.

**Layer-fit check.** AC1-3 and AC9 are properties of the engines' file selection and are observable at the operation layer, but they are cheaper and stronger as scenarios (the runner deep-equals the whole response). AC4-8 and AC10-11 traverse the dispatcher — schema validation, path resolution, engine selection — and are **only** falsifiable through it. All ACs ship as scenarios in a new `src/operations/getTypeErrors.scenarios.yaml`.

## Value / Effort

- **Value:** Today, on this repository, `pnpm check` is green while weaver's project-wide check reports **251 errors, truncated at 100**. Of the 100 visible, 87 are test/helper/eval files and the codes are dominated by TS6059 (`rootDir` violations) and TS1470 — errors that exist only because those files are being judged against a tsconfig that excludes them. Measured: without the walk the same project holds 85 files and 2 errors; with it, 284 files and 251. **The walk contributes 249 of 251 errors — 99%.** An agent cannot use a signal whose baseline is unknown and whose output cap is consumed by noise; a real error can be pushed out of the response entirely. After this change the verdict matches the build, and where weaver's answer is partial it says so in the response rather than staying silent.
- **Effort:** One new shared helper module, two call sites (one per engine), one new optional parameter threaded through schema + both `pathParams` declarations, and two new response fields. No new infrastructure: project caching is already keyed by tsconfig path, `isVueProject` already takes a tsconfig path, and the scenario runner needs **zero** changes to host a second operation (verified by reading it — it dispatches any `method` generically).

## Behaviour

- [ ] Given a workspace whose `tsconfig.json` sets `include: ["src"]`, a clean `src/ok.ts`, and a type error in `tests/broken.test.ts`, `get-type-errors '{}'` returns `errorCount: 0` and `diagnostics: []` — matching `tsc -p tsconfig.json`, which exits 0 on this input.
- [ ] Given a workspace whose `tsconfig.json` sets `include: ["src"]`, where `src/main.ts` imports `../lib/helper.ts` and the type error is in `lib/helper.ts`, `get-type-errors '{}'` reports that error with `errorCount: 1` and the diagnostic's `file` naming `lib/helper.ts`. (`tsc` reports it too: an excluded file pulled in by an import is part of the program. This AC exists to reject the lazy implementation — filtering to `parseJsonConfigFileContent`'s `fileNames` — which would return 0 here.)
- [ ] Given a workspace with **no** `tsconfig.json` and a type error in `src/broken.ts`, `get-type-errors '{}'` reports it with `errorCount: 1`, and the response carries `checked.tsconfig: null` with `unchecked.files: 0`. (With no tsconfig the walk is the only source of files; narrowing here would return a false clean bill of health.)
- [ ] Given the first workspace above, the response carries `checked: { files: 1, tsconfig: "<abs>/tsconfig.json" }` — `files` counting source files in the program that are under the workspace root, excluding `node_modules` and TypeScript's default library files. Diagnostics themselves are *not* so limited: the checked set is the tsconfig program's import closure, which reaches dependency `.d.ts` files, and those are reported when `skipLibCheck` is off because `tsc` reports them. `checked`/`unchecked` answer a narrower question — "how much of *my* code did you look at" — so both count the caller's own files and are complementary over that set.
- [ ] Given a workspace holding `tsconfig.json` (`include: ["src"]`), `tsconfig.test.json` covering `tests/`, and a type error in `tests/broken.test.ts`, `get-type-errors '{}'` returns `unchecked: { files: 1, reason: "outside <abs>/tsconfig.json", otherConfigs: ["<abs>/tsconfig.test.json"] }`.
- [ ] Given that same workspace, `get-type-errors '{"tsconfig": "tsconfig.test.json"}'` reports the error in `tests/broken.test.ts` with `errorCount: 1`, and `checked.tsconfig` names `<abs>/tsconfig.test.json`.
- [ ] Given that same workspace, `get-type-errors '{"tsconfig": "tsconfig.test.json"}'` produces the result above when invoked with the path **relative to the workspace**, from any working directory — not `FILE_NOT_FOUND`.
- [ ] Given that same workspace, `get-type-errors '{"file": "src/ok.ts"}'` returns `status: "success"` when invoked with the path relative to the workspace, from any working directory — not `FILE_NOT_FOUND`. (Current behaviour: only an absolute path works. Absorbed from the sibling handoff entry, because the same declaration governs both params and shipping a working `tsconfig` beside a broken `file` would be incoherent.)
- [ ] Given a Vue workspace whose `tsconfig.json` sets `include: ["src"]`, with a type error in `src/Broken.vue` and another in `tests/broken.test.ts`, `get-type-errors '{}'` reports the SFC error only, with `errorCount: 1`, and carries the same `checked`/`unchecked` field shape the TS engine produces for the equivalent workspace.
- [ ] Given any workspace, `get-type-errors '{"tsconfig": "does-not-exist.json"}'` returns `status: "error"` with `code: "FILE_NOT_FOUND"`.
- [ ] Given a workspace whose root `tsconfig.json` covers only `.ts` files and whose `tsconfig.app.json` covers `.vue` files, `get-type-errors '{"tsconfig": "tsconfig.app.json"}'` returns diagnostics for an SFC error — i.e. engine selection follows the named tsconfig, not the workspace root.
- [ ] Given a **Vue** workspace whose `tsconfig.json` sets `include: ["src/**/*.ts", "src/**/*.vue"]`, containing `src/App.vue`, where `src/main.ts` imports `../lib/helper.ts` and the type error is in `lib/helper.ts`, `get-type-errors '{}'` reports that error with `errorCount: 1` and the diagnostic's `file` naming `lib/helper.ts` — the same answer AC2 requires from the ts-morph engine for the same shape, and the same answer `tsc -p tsconfig.json` gives.

### Coverage table

Every cell holds an AC number or a written reason for being empty. Symmetry between the engines is not assumed — they reach the same behaviour through different code.

| Behaviour | ts-morph | Volar |
|---|---|---|
| narrows to the tsconfig program | AC1 | AC9 |
| keeps excluded-but-imported files | AC2 | **AC12** |
| no tsconfig — walk is the whole set | AC3 | N/A — `buildVolarService` without a tsconfig builds an empty-`compilerOptions` service; covered by the separate handoff entry on solution-style configs, not here |
| `checked`/`unchecked` fields | AC4, AC5 | AC9 (field shape) |
| `tsconfig` parameter | AC6, AC7, AC10 | AC11 |
| relative `file` resolution | AC8 | N/A — path resolution happens in the dispatcher, above engine selection |

## Structural criteria

- [ ] A single module exports the file-set rule used by both engines; `src/ts-engine/get-type-errors.ts` and `src/plugins/vue/get-type-errors.ts` both import it, and neither computes its own. (The Vue module already imports `capDiagnostics`/`semanticErrors` from the ts-engine side, so this direction of dependency is established.)
- [ ] That module **computes** the checked set — the transitive closure of the tsconfig's roots, resolved against the program it is given — rather than selecting between sets its callers computed. A function that only picks one of two arguments satisfies the criterion above while leaving each caller to get the closure right on its own, which is how the engines came to disagree the first time this was built. The behavioural guarantee is AC2 and AC12; this line exists so the shape cannot drift back.

## Interface

**New parameter** on `GetTypeErrorsArgsSchema`:

- `tsconfig` — optional string. Absolute path, or a path relative to the workspace root, of the `tsconfig.json` to answer for. Example: `"tsconfig.eval.json"`. Bounds: a single filesystem path; no length concern beyond the OS limit. Empty case: absent means "discover the tsconfig covering the workspace root", which is today's behaviour and stays the default. Adversarial: a path outside the workspace must raise `WORKSPACE_VIOLATION`, not load a foreign config; a path that exists but is not valid JSON, or is a directory, raises `FILE_NOT_FOUND`. Mutually exclusive with `file` — supplying both is a `VALIDATION_ERROR`, enforced by a `.refine()` in the schema (the `ReplaceTextArgsSchema` precedent), because the two express different scopings and silently preferring one would be a guess.

**New response fields** on `GetTypeErrorsResult`, present on project-wide results only:

- `checked` — `{ files: number, tsconfig: string | null }`. `files` is the count of program source files excluding `node_modules` and default library files; realistic range 1 to a few thousand. `tsconfig` is the absolute path of the config that answered, or `null` when the workspace has none.
- `unchecked` — `{ files: number, reason: string, otherConfigs: string[] }`. `files` counts workspace TS/JS files the walk enumerates that the checked program does not contain — `0` on a workspace whose tsconfig covers everything, and on a workspace with no tsconfig. `reason` is a short fixed string naming the config that set the scope. `otherConfigs` lists absolute paths of other `tsconfig*.json` files at the **workspace root**, excluding the one used, capped at 10.

Both fields are counts and a short capped list — never file lists. This is deliberate: `docs/agent-users.md` caps response size, and the `filesSkipped` handoff entry records what an uncapped array of paths costs.

The reason these fields exist rather than a documentation note: an agent is a literal interpreter with no memory across sessions. `errorCount: 0` from a narrowed check reads as "the repository is clean", and nothing in the response would contradict it. A human reading an IDE's problem list knows it covers open files; an agent has no such context. `unchecked` makes the partial answer visible at call time, which `docs/commands/get-type-errors.md` cannot do — agents read the skill and the command output, nothing else.

## Open decisions

**Decision: what should project-wide diagnostics report?** *Resolved: match `tsc -p <tsconfig>`.* Options were (a) match tsc, (b) keep everything but order tsconfig-program errors first so truncation cannot bury them, (c) document the breadth as intended. Chosen (a): the user's reference point for "is my code type-clean" is their build, and 99% of what weaver currently adds is not merely out of scope but fabricated by judging files against options meant for other files. (b) keeps the noise in the context window, which is the cost that matters for an agent. **Enables:** a trustworthy verdict, and an output cap spent on real errors. **Rules out:** project-wide as a way to sweep files no tsconfig covers — the `tsconfig` parameter and `file` are the routes to those. **Watch for:** any caller that relied on the breadth; there is none, as post-write diagnostics uses `getTypeErrorsForFiles` over `filesModified`, a separate path this change does not touch.

**Decision: how do the two engines stay in agreement?** *Resolved: one shared helper both engines call.* Options were a shared closure walk, per-engine subtraction of walk-added files, or a second tsconfig-only program. Subtraction is free and exact for ts-morph — measured: `project.getSourceFiles()` before the walk is precisely tsc's program, including the transitive closure — but Volar seeds from raw `parseJsonConfigFileContent` `fileNames` with no closure, so it would drop an excluded-but-imported file that ts-morph keeps. The engines would then disagree, which is the failure the handoff entry records as already tried and reverted during the SFC routing fix. A second program is the most faithful but pays a full build on the project-wide path. **Enables:** one rule, one place, identical answers. **Watch for:** the helper must be seeded with Volar's on-disk `.vue` set as well as the tsconfig roots, since `buildVolarService` deliberately adds SFCs the tsconfig does not list (bundler-only Vue setups) and those must keep getting diagnostics. **Falsified by:** AC12 — the Vue half of AC2. Without it, "the engines would then disagree" is an argument in a decision record and nothing runs it; the first build of this change shipped exactly that divergence, with the Vue engine returning `errorCount: 0` where `tsc` and the ts-morph engine both report the error.

**Decision: how wide is the narrowing?** *Resolved: project-wide only.* Single-file `get-type-errors` and post-write diagnostics over `filesModified` keep answering for any file. Both are explicit asks about a named file the caller pointed at or that weaver just wrote, and narrowing them would hide real breakage. **Watch for:** a single-file answer about a file outside the tsconfig is still computed under that tsconfig's options and can therefore carry the same fabricated errors. That is a real and separate defect; it is logged to handoff rather than folded in, because it changes which *project* answers rather than which *files* are asked about.

**Decision: should the default check every tsconfig it can find?** *Resolved: no — default to the discovered `tsconfig.json`, with `otherConfigs` naming the rest.* Checking the union is the most honest answer to "is this repository clean" (this repo's own answer is the union of three configs) but multiplies program builds for every caller, most of whom want the shipped code. With the other configs named in the response the follow-up is one obvious call rather than a search. **Watch for:** if agents are observed always issuing the follow-up calls, promoting the union to the default is a default change, not an interface change — the parameter is unaffected either way.

**Decision: does the change absorb the relative-`file` defect?** *Resolved: yes.* `SUBCOMMANDS` and the dispatcher both declare `pathParams: []` for this operation, which is why `file` is never resolved from relative to absolute. `tsconfig` needs that resolution, and the same one-line declaration governs both. Shipping a working `tsconfig` next to a knowingly broken `file` would be incoherent, and the scenario layer proves both at once. **Consequence:** the sibling handoff entry is removed by this change, not left behind.

**Decision: which engine answers when `tsconfig` is given?** *Resolved: the named tsconfig selects the engine.* Engine selection at `dispatcher.ts:376-383` uses `pathParams[0]` when `pathParams` is non-empty and otherwise falls back to `usesFileForRegistry` with `params.file`. Adding `file` to `pathParams` makes `usesFileForRegistry` redundant for this operation — `makeRegistry(undefined, workspace)` is what both branches produce when `file` is absent — but it also means a `{"tsconfig": …}` call with no `file` would select the engine from the workspace root, giving the TS engine for a Vue config or vice versa. `isVueProject` already takes a tsconfig path, so selection must consult the named config when one is supplied. **Watch for:** removing `usesFileForRegistry` if it becomes dead for every operation; check its other users before deleting the field rather than leaving an unused branch.

## Security

- **Workspace boundary:** `tsconfig` is a new path parameter reaching the filesystem, so it must be boundary-checked before the config is read — a path resolving outside the workspace raises `WORKSPACE_VIOLATION`. It flows through the same `resolveRelativePaths` + validation route as every other path param, which is the reason the declaration fix is part of this change rather than adjacent to it.
- **Sensitive file exposure:** N/A for new reads — a `tsconfig*.json` is not in `isSensitiveFile`'s classes, and the operation reads no file content it did not already read. `otherConfigs` enumerates only names matching `tsconfig*.json` at the workspace root.
- **Input injection:** `tsconfig` is interpolated into a filesystem path and nothing else — no shell, no regex. Standard path validation covers traversal.
- **Response leakage:** `checked.tsconfig` and `otherConfigs` put absolute paths into the response, which the response already does for every diagnostic's `file`. No file content is added. Diagnostics themselves are unchanged, and narrowing strictly reduces what is returned.

## Edges

- The `otherConfigs` glob is workspace-root only, so a monorepo's `packages/*/tsconfig.json` is not listed. Bounded output is the reason; document the limit rather than making the scan recursive.
- Narrowing must not change single-file results, and must not change post-write diagnostics over `filesModified`. Existing tests for both stay green untouched.
- The existing seven project-wide tests use fixtures whose files are all inside `include`, so they must pass **unchanged**. A change to any of them signals the narrowing went too far.
- `errorCount` and `truncated` keep their current meaning: `errorCount` is the true total within the checked scope, and `truncated` refers to the `MAX_DIAGNOSTICS` cap, not to `unchecked`.
- Two errors remain on this repository after the fix (TS1470 on `src/adapters/cli/cli.ts` and `src/daemon/build-id.ts`). These are **not** this defect — they reproduce on an 85-file tsconfig-only project with the walk disabled, and are logged separately. Do not treat a non-zero count on weaver itself as a failed verification.

## Done-when

- [ ] All ACs verified by scenarios in `src/operations/getTypeErrors.scenarios.yaml`
- [ ] Mutation score ≥ threshold for touched files, including the new shared helper
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`; the two get-type-errors test files must not grow
- [ ] Verified on the real path: `pnpm exec weaver get-type-errors '{}'` on this repository reports 2 errors rather than 251, and `'{"tsconfig": "tsconfig.eval.json"}'` reports the eval lane's own verdict
- [ ] Docs updated:
      - `docs/commands/get-type-errors.md` — the `tsconfig` input, the `checked`/`unchecked` output fields, and the scoping rule
      - `docs/internals/get-type-errors.md` — the shared file-set rule and why the walk is right for references but not diagnostics
      - `.claude/skills/weaver-code-inspection/SKILL.md` — the `tsconfig` parameter and what `unchecked` means, since agents read the skill and nothing else
      - handoff.md current-state section
- [ ] The sibling entry *`get-type-errors` never resolves a relative `file` argument* removed from handoff.md, being fixed here
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/internals/get-type-errors.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
