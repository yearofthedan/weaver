# Daemon discovery cache invalidation

**type:** change
**date:** 2026-08-09
**tracks:** handoff.md # Daemon discovery cache invalidation → docs/internals/daemon.md

---

## Context

`src/utils/ts-project.ts` caches `findTsConfig` (dir → tsconfig path or `null`) and `isVueProject` (project root → bool) in module-level Maps for the daemon's whole lifetime. The daemon outlives many CLI calls, so a project whose structure changes underneath it keeps serving decisions made from the structure it first saw. The dominant failure is silent: a project that gains its first `.vue` file keeps routing through `TsMorphEngine`, and a `rename` then skips every occurrence inside `.vue` files and reports success.

## User intent

*As a developer running an agent against my project, I want weaver's refactoring operations to act on my project's current structure, so that adding a `tsconfig.json` or my first `.vue` file mid-session doesn't produce a rename that silently misses files.*

## Relevant files

- `src/utils/ts-project.ts` — holds both caches; gains the reset function.
- `src/daemon/dispatcher.ts` — `dispatchRequest` is the transaction boundary; calls the reset.
- `src/daemon/daemon.ts:207-215` — `startWatcher` wiring; drops the startup-time `isVueProject` call.
- `src/daemon/watcher.ts:54` — the extension filter that makes event-driven invalidation unworkable (see Open decisions).
- `src/daemon/language-plugin-registry.ts` — `makeRegistry`/`supportsProject` consume `isVueProject` per request; `invalidateAll` clears engines.
- `src/ts-engine/engine.ts:57-74` — `projects` is keyed on the discovery result, which is why engine caches self-heal once discovery is fresh.
- `src/daemon/daemon.integration.test.ts` — the pattern for spawning a real daemon against a temp workspace.

### Red flags

- (none — `ts-project.ts` is 72 lines and both functions are small)

**Layer-fit check:** every AC except *stable within a dispatch* needs a real daemon against a real workspace (the singleton engine and cached plugin compiler are the thing under test; an in-process test rebuilds them per case and passes vacuously). *Stable within a dispatch* is a pure unit test on `ts-project.ts` with a spied filesystem read.

## Value / Effort

- **Value:** A rename or find-references reflects the project as it is on disk, not as it was when the daemon started. Prevents the silent-incomplete-refactor failure — the one weaver exists to prevent — for the case where an agent scaffolds structure and then refactors across it in the same session. Today the only remedy is `weaver stop`, and nothing tells the user they need it.
- **Effort:** Small. One new exported function, one call site, one conditional deleted. Three files changed plus tests. No new infrastructure and no new concepts beyond naming the transaction boundary.

## Behaviour

- [x] **A tsconfig created mid-session governs the next request.** Given a daemon that has served a request against a workspace with no `tsconfig.json`, when a `tsconfig.json` setting `strict: false` is added at the root, the next `get-type-errors` for a file with an implicitly-`any` parameter no longer reports `TS7006`. Rules out an implementation that refreshes the file set but keeps the old compiler options. *(integration)* — direction inverted from the original draft: TypeScript 6 treats an **absent** `strict` as on for `noImplicitAny`, so the no-tsconfig fallback already flags the parameter and it is the added config that must silence it (see Edges).
- [x] **A deleted tsconfig does not break the next request.** Given a daemon serving a workspace with a root `tsconfig.json` setting `strict: false`, when that file is deleted, the next operation returns a success response rather than failing to read the missing config — and reports `TS7006`, since the fallback's absent `strict` re-enables `noImplicitAny`. *(integration)*
- [x] **A nearer tsconfig wins once it exists.** Given operations on `packages/app/src` resolving against a root `tsconfig.json` with `strict` off, when a `tsconfig.json` with `strict` on is added at `packages/app`, the next `get-type-errors` for a file in `packages/app/src` reports the strict-only diagnostic. *(integration)*
- [x] **A project that gains its first `.vue` file gets Vue-aware renames.** Given a daemon that has served a request against a workspace with no `.vue` files, when a `.vue` file that imports and uses a symbol from a `.ts` file is added inside the tsconfig's `include`, the next `rename` of that symbol rewrites the occurrence inside the `.vue` file and lists that file in `filesModified`. Asserting both rules out the Vue engine being selected while the file goes unwritten. *(integration)*
- [x] **Edits to a `.vue` file added after startup are observed.** Given a daemon started against a workspace with no `.vue` files, when a `.vue` file is added and its content then edited on disk, the next operation reflects the edited content rather than the content at add time. *(integration)*
- [x] **Discovery is stable within one dispatch.** Given one dispatched operation, `tsconfig.json` is read from disk at most once per distinct directory queried, and parsed for `.vue` membership at most once per project root. Guard against the memo being reduced to per-call reads — not user-facing behaviour. *(unit)* — met by the existing black-box caching tests in `ts-project.test.ts` ("caches a found tsconfig — second call returns same path even after file is deleted" and its three siblings), which observe the memo through a stale answer rather than a read counter. Confirmed load-bearing by neutering the memo and watching them go red. An added spy-based read-counting file was deleted: it required `vi.mock` + `vi.resetModules` + a dynamic import (disallowed by `docs/code-standards.md`) and killed no mutants the static tests did not.

## Structural criteria

- (none — `resetDiscoveryCaches` and its call site are the mechanism behind the ACs above, not separate criteria)

## Interface

No change to any command's inputs, outputs, or error codes — this is internal to the daemon.

`resetDiscoveryCaches(): void`, exported from `src/utils/ts-project.ts`.

- **What does it contain?** No parameters, no return. Clears both module-level Maps.
- **Realistic bounds:** Called once per dispatched request. The Maps it clears hold one entry per distinct directory queried and one per project root — single digits for a normal workspace, bounded by workspace depth.
- **Zero/empty case:** Clearing empty Maps is a no-op; safe to call before any lookup has happened.
- **Adversarial case:** None reachable from user input — it takes none. Concurrent calls are not a concern: the daemon serialises requests through its mutex, and the CLI is the only caller.

`startWatcher` in `daemon.ts` is passed `VUE_EXTENSIONS` unconditionally instead of choosing between `TS_EXTENSIONS` and `VUE_EXTENSIONS` from `isVueProject`.

## Open decisions

**Decision: per-request reset vs. watcher-driven invalidation vs. no cache.** *Resolved — per-request reset, plus watching `VUE_EXTENSIONS` unconditionally.*

The handoff entry proposed hooking the watcher's `onFileAdded`/`onFileRemoved` to clear the relevant entries. That cannot work as written, for two reasons:

1. `watcher.ts:54` filters events by file extension. `.json` is in neither `TS_EXTENSIONS` nor `VUE_EXTENSIONS`, so a `tsconfig.json` create, delete, or move never reaches any callback.
2. The watched extension set is chosen once at startup from `isVueProject` (`daemon.ts:207-211`). In a TS-only project the watcher never reports `.vue` files — so the event that should invalidate the `isVueProject` cache is precisely the one that cache caused to be filtered out.

Making the event-driven approach work would need basename matching for `tsconfig.json`, unconditional `.vue` watching, a new `onConfigChanged` callback, and rules for which entries to drop (descendant dirs for `findTsConfig`, the project root for `isVueProject`, and `null`-valued entries that an added tsconfig above them now invalidates). It would still be wrong for a `tsconfig.json` created above the workspace root, which is outside the watch tree.

Recompute cost decided it. Measured on this repo, 2026-08-09:

| Operation | Cost |
|---|---|
| `findTsConfig` walk | 0.006–0.011 ms |
| `isVueProject` (`parseJsonConfigFileContent`) | 0.2–1.3 ms — 1.3 ms is weaver's own tsconfig |
| Warm compiler-backed request, server-side | 4–5 ms |
| Cold request that builds the ts-morph program | 977 ms |
| Any CLI call, end to end | ~520 ms (client process startup dominates) |

Rebuilding both caches costs 1–3 ms against a ~520 ms end-to-end call. The invalidation protocol is not worth writing for that, and correctness by construction beats a set of path-pattern rules that have to be right for every structural mutation.

Deleting the caches outright was the third option. Rejected narrowly: a per-dispatch memo costs one exported function more and keeps `isVueProject` from being re-parsed on every one of the ~10 discovery lookups a single request makes.

**Consequences.**

- Enables: correct behaviour for every structural mutation, including ones the watcher cannot observe, with no dependence on event delivery.
- Rules out: treating these caches as a performance lever. If `isVueProject`'s 1.3 ms ever matters, the fix is to make the check cheaper (it does not need full file enumeration to answer "is there at least one `.vue` in the include set"), not to widen the cache's lifetime. Logged as a follow-up rather than folded in here, to keep an optimisation out of a correctness fix.
- Watch for: the reset being read as waste and "optimised" back into a lifetime cache. The reason it is per-request is recorded here.

**Decision: fold the unconditional `VUE_EXTENSIONS` change into this spec, or log it separately.** *Resolved — fold in.*

The reset alone fixes engine *selection* when a project becomes a Vue project, but the watcher would still emit no `change` events for that `.vue` file, so later edits to it would not refresh the Volar service until an unrelated add/unlink fired. The change also deletes the startup-time `isVueProject` call, which is the second of the two stale decisions the handoff entry names — leaving it would mean shipping a fix that addresses one of the two. Extra `.vue` events in a TS-only project are no-ops: `refreshFile` returns early when the project has no such source file (`engine.ts:248-250`).

## Security

- **Workspace boundary:** N/A. No new file writes and no new path parameters. `resetDiscoveryCaches` takes no input; discovery reads the same paths it reads today, and every request still passes through the existing `validateFilePath` / `WorkspaceScope.contains` checks in `dispatchRequest` before any discovery happens.
- **Sensitive file exposure:** N/A. Discovery reads `tsconfig.json` only, and reads no file content into any response. Watching `.vue` unconditionally widens which paths the watcher reports, but the watcher only invalidates caches by path — it does not read or emit content.
- **Input injection:** N/A. No new string parameters.
- **Response leakage:** N/A. No response field changes. A previously-cached wrong engine choice could produce a response listing fewer modified files than it should; this change makes that response more accurate, not more revealing.

## Edges

- The memo is only guaranteed fresh *within* a dispatch. Watcher callbacks fire between requests and `refreshFile` performs its own `findTsConfigForFile`, so the Maps are not empty between dispatches — the guarantee is "cleared at the start of each dispatch", not "empty when idle". The doc comment must say this.
- A structural change leaves the previous key's `Project` in `TsMorphEngine.projects` (e.g. the `__no_tsconfig__` entry after a tsconfig appears). Bounded by the number of distinct tsconfig paths seen, so not a leak worth code, but do not assert the map has exactly one entry.
- Reset must happen before the first discovery call in a dispatch — including before `makeRegistry`, which calls `findTsConfigForFile` while choosing the engine.
- A request that changes structure (`moveFile` writing a new `tsconfig.json`, `deleteFile` removing the last `.vue`) sees the pre-change view for the rest of that dispatch. Correct: the operation was planned against the structure it read.
- Watching `VUE_EXTENSIONS` unconditionally must not change behaviour for a TS-only project beyond the extra no-op invalidations.
- Engine selection flipping back to `TsMorphEngine` when the last `.vue` file is deleted has no user-observable consequence — no wrong answer, only which engine serves. Verify it does not error; do not assert engine identity as an AC.
- Reusing the warm compiler project when structure is unchanged is only observable through timing, which is a flaky assertion. If it needs a guard, inspect the project cache directly rather than measuring.
- The strict-diagnostic fixture originally assumed the no-tsconfig fallback (`new Project({ useInMemoryFileSystem: false })`) leaves `strict` off. It does not. That project has `compilerOptions = {}`, and TypeScript 6's `getStrictOptionValue` reads an absent `strict` as **on** for the individual flags, so `noImplicitAny` is already active in the fallback. The fixtures for the first two ACs are inverted accordingly: the added `tsconfig.json` sets `strict: false` and the observable is the diagnostic *disappearing*. Same discriminating power, opposite direction.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for `src/utils/ts-project.ts` — 96.00%, sole survivor classified as equivalent
- [x] `pnpm check` passes (lint + build + test) — 1129 unit/integration + 519 eval
- [x] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md` — largest is `daemon.integration.test.ts` at 396 lines; `daemon.ts` shrank
- [x] Docs updated:
      - `docs/internals/daemon.md` — per-dispatch discovery scope, the "cleared per dispatch, not empty when idle" distinction, and why invalidation is not watcher-driven. (The routing note did not in fact claim a daemon-lifetime cache; it simply never said when discovery is re-evaluated.)
      - `docs/internals/watcher.md` — "Extension selection" rewritten: `VUE_EXTENSIONS` is watched unconditionally, and why the startup-time choice was self-defeating
      - handoff.md current-state section — `ts-project.ts` line gains `resetDiscoveryCaches`
      - No command page or error-code change (no public surface change)
- [x] Follow-up added to handoff.md: reduce `isVueProject`'s cost so it does not enumerate every file in the program
- [x] Non-obvious gotchas added to `docs/internals/daemon.md`
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

---

## Outcome

**Shipped:** `resetDiscoveryCaches()` in `src/utils/ts-project.ts`, called as the first statement of `dispatchRequest`; `startWatcher` now receives `VUE_EXTENSIONS` unconditionally, deleting the startup-time `isVueProject` call and the `__sentinel__` path it existed to feed.

### Verification

Driven on the real CLI path against a scratch workspace, not only through tests — auto-spawned daemon, real `pnpm exec weaver` calls.

*A workspace gaining its first `.vue` file mid-session* — daemon served a `find-references` while the project was TS-only, then `App.vue` was added and `rename` run through the same daemon:

```
filesModified: [".../src/App.vue", ".../src/utils.ts"], locationCount: 3
```

and `App.vue` on disk had both the import and the call site rewritten to `welcomeUser`. This is the silent-incomplete-refactor failure the spec exists to prevent.

*Edits to a `.vue` file added after startup* — `find-references` across three requests on one daemon: TS-only (1 ref), after adding `App.vue` (3 refs, two inside the `.vue`), after editing the usage out (**1 ref — `App.vue` gone**).

*A tsconfig created mid-session* — `get-type-errors` reported `TS7006 Parameter 'name' implicitly has an 'any' type` with no tsconfig, then `errorCount: 0` after a `tsconfig.json` with `strict: false` was added, proving compiler options were re-read rather than just the file set.

Red states were confirmed per batch by removing the fix and re-running, not inferred. Batch 2: all three tsconfig tests failed on the *second* request returning the stale answer (`expected [ 7006 ] to not include 7006`) while the `status: "success"` assertions passed first. Batch 3: the `.vue`-edit test failed with the reference still present after the usage was deleted.

**Tests:** 8 added (3 unit on `ts-project.ts`, 5 integration in `daemon.integration.test.ts`), net +6 after removing 2 redundant ones. Suite 1129 unit/integration + 519 eval, `pnpm check` green.

**Mutation:** `src/utils/ts-project.ts` 96.00% (21 killed, 3 timeout, 1 survived). The survivor — `isMixedContent: true → false` — was classified rather than waved through: flipping it leaves the suite green because `isVueProject` reads only `parsed.fileNames`, and the flag governs how a matched file is parsed, not whether it joins the file set. It is a required field of `FileExtensionInfo`, so it cannot be deleted. Recorded in `docs/tech/mutation-testing.md`. `dispatcher.ts` and `daemon.ts` are outside the Stryker `mutate` array (`src/daemon/**` is commented out at `stryker.config.mjs:28`); a forced scoped run reports 0% purely from sandbox composition, so the guard for those one-line changes is the removed-fix red state above.

### Discoveries

**The spec's `strict` assumption was backwards.** The draft assumed ts-morph's no-tsconfig fallback leaves `strict` off, so an added tsconfig turning it *on* would surface `TS7006`. TypeScript 6 reads an absent `strict` as **on** for the individual flags, so the fallback already reports it and the added config has to silence it. The spec's own Edges section required confirming this before relying on it, which is the only reason it was caught before the fixtures were built on sand.

**One AC needed no code from its own batch.** "A project that gains its first `.vue` file gets Vue-aware renames" was already green on batch 2's reset alone: `rename` carries `pathParams: ["file"]`, so `makeRegistry` gets the real path and re-evaluates `isVueProject` fresh each dispatch, and the Volar engine is created lazily so its first read of the new file is always current. Kept as a regression guard. The unconditional watch is load-bearing only for *later edits* to such a file.

**A pre-existing routing bug surfaced and was logged, not fixed.** `dispatchRequest` builds the plugin-selection registry from the workspace root for any operation with empty `pathParams` (`getTypeErrors`, `searchText`, `replaceText`), and `findTsConfigForFile` then treats that root as a *file* and walks from its parent — one level too high to find a tsconfig at the workspace root. In a Vue project `getTypeErrors` on a `.vue` file therefore routes to `TsMorphEngine` and throws. Reproduces with the reset fully wired in, so it is independent of this change. Logged to handoff as `[needs design]`.

### Reflection

**What went well.** Splitting the seam from adoption paid for itself: every batch had a genuine failing state, and re-verifying each one by hand (pull the fix, rebuild, re-run) turned "the agent says it was red" into observed output. The execution agents were candid — one reported an AC was already green rather than manufacturing a failure, and one flagged its own standards violation and a tool-discipline slip unprompted. That honesty is worth more than a clean-looking report.

**What did not.** Batch 1 spent most of its run building ~90 lines of `vi.mock` + `vi.resetModules` + dynamic-import machinery to count filesystem reads, for a guard four pre-existing black-box tests already provided. It was deleted after neutering the memo showed those tests go red on their own. The lesson generalises: before building white-box instrumentation, check whether the property is already observable through behaviour — a memo that never expires is visible as a stale answer, no spy required.

**What took longer than it should.** Real-path verification produced a convincing false red — `.vue` edits appeared unobserved on the CLI — because `dist/` had been rebuilt from the *reverted* source during the red-state check and never rebuilt after restoring. Confirming the artifact (`grep __sentinel__ dist/daemon/daemon.js`) before theorising resolved it in one step. On any change involving the daemon, the CLI runs `dist`, and `pnpm build` is part of the experiment, not a preamble to it.

**For the next agent.** The `getTypeErrors` routing bug above is the most valuable thing found here and is genuinely user-facing in Vue projects — worth picking up ahead of the cost follow-up. Do not re-widen these memos to a lifetime cache to reclaim the 0.2–1.3 ms; make `isVueProject` cheaper instead, which is the logged follow-up.
