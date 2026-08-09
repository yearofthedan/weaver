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

- [ ] **A tsconfig created mid-session governs the next request.** Given a daemon that has served a request against a workspace with no `tsconfig.json`, when a `tsconfig.json` enabling `strict` is added at the root, the next `get-type-errors` for a file whose only error requires `strict` (an implicitly-`any` parameter) reports that diagnostic. Rules out an implementation that refreshes the file set but keeps the old compiler options. *(integration)*
- [ ] **A deleted tsconfig does not break the next request.** Given a daemon serving a workspace with a root `tsconfig.json`, when that file is deleted, the next operation returns a success response rather than failing to read the missing config. *(integration)*
- [ ] **A nearer tsconfig wins once it exists.** Given operations on `packages/app/src` resolving against a root `tsconfig.json` with `strict` off, when a `tsconfig.json` with `strict` on is added at `packages/app`, the next `get-type-errors` for a file in `packages/app/src` reports the strict-only diagnostic. *(integration)*
- [ ] **A project that gains its first `.vue` file gets Vue-aware renames.** Given a daemon that has served a request against a workspace with no `.vue` files, when a `.vue` file that imports and uses a symbol from a `.ts` file is added inside the tsconfig's `include`, the next `rename` of that symbol rewrites the occurrence inside the `.vue` file and lists that file in `filesModified`. Asserting both rules out the Vue engine being selected while the file goes unwritten. *(integration)*
- [ ] **Edits to a `.vue` file added after startup are observed.** Given a daemon started against a workspace with no `.vue` files, when a `.vue` file is added and its content then edited on disk, the next operation reflects the edited content rather than the content at add time. *(integration)*
- [ ] **Discovery is stable within one dispatch.** Given one dispatched operation, `tsconfig.json` is read from disk at most once per distinct directory queried, and parsed for `.vue` membership at most once per project root. White-box guard against the memo being reduced to per-call reads — not user-facing behaviour. *(unit)*

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
- The strict-diagnostic fixture assumes the no-tsconfig fallback (`new Project({ useInMemoryFileSystem: false })`) leaves `strict` off. Confirm that before relying on it; if ts-morph's defaults differ, invert the fixture so the observable difference still exists.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/utils/ts-project.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] Docs updated:
      - `docs/internals/daemon.md` — the `VolarCompiler` routing note states that `isVueProject` is cached for the daemon's lifetime; update it to describe the per-dispatch scope, and record why invalidation is not watcher-driven
      - handoff.md current-state section — `ts-project.ts` line gains `resetDiscoveryCaches`
      - No command page or error-code change (no public surface change)
- [ ] Follow-up added to handoff.md: reduce `isVueProject`'s cost so it does not enumerate every file in the program
- [ ] Non-obvious gotchas added to `docs/internals/daemon.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
