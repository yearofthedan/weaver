# Post-write check repairs the Volar service in place

**type:** change
**date:** 2026-09-14
**tracks:** handoff.md # a-checked-write-in-a-vue-project-rebuilds-the-whole-volar-service, # a-checked-write-to-a-resolved-dependency-or-the-tsconfig-rebuilds-the-volar-service-twice → docs/internals/get-type-errors.md

---

## Context

Every mutating command in a Vue project runs a post-write type check. The check calls `Engine.refreshFile` for each written path (`src/daemon/post-write-diagnostics.ts:30`), and `VolarEngine` implements that as `invalidateService` — the tsconfig's whole cached service is discarded, so the query that follows rebuilds it. The service already holds a per-path repair (`CachedService.rereadFile`) that reads the path from disk, re-registers its script and bumps its version; the end-of-dispatch drain uses it through `refreshWrittenFile`. Measured 2026-09-14 on the four-file `vue-errors` fixture: a three-file check costs 123 ms through the rebuild and 6 ms through the in-place repair, with identical diagnostics.

## User intent

*As a developer refactoring a Vue project through weaver, I want a rename or replace to return as fast as the edit itself is, so that the type check I get for free does not cost more than the change I asked for.*

## Relevant files

- `src/plugins/vue/engine.ts:89-127` — `invalidateService`, `refreshFile`, `refreshWrittenFile`; the three methods this spec changes.
- `src/plugins/vue/service.ts:296-318` — `CachedService.rereadFile`: reads disk, writes `fileContents`, re-registers the script, bumps `versions`. The repair the routing calls.
- `src/plugins/vue/service.ts:21-57` — `CachedService`'s shape: `scriptFileNames` (virtual paths for `.vue`) and `fileContents` (everything the host has read, resolved dependencies included) are the two membership sets the routing tests.
- `src/daemon/post-write-diagnostics.ts` — the check; `refreshFile`'s only production caller, and the reason refreshes are hoisted out of the query loop.
- `src/daemon/dispatcher.ts:439-460` — the end-of-dispatch drain that calls `refreshWrittenFile` for every written path.
- `src/daemon/language-plugin-registry.ts:83-113` — the watcher's `invalidateFile` goes through `plugin.invalidateFile`, not `Engine.refreshFile`; nothing else reaches the method this spec changes.
- `src/plugins/vue/engine.test.ts:132-242` — the existing refresh cluster; the new cases join it and four of its cases pin behaviour this spec must preserve.
- `docs/internals/get-type-errors.md:67-104` — documents today's contract, including the interleaved-vs-hoisted measurement and the `refreshFile`/`refreshWrittenFile` split.

### Red flags

- **Test hotspot:** `src/plugins/vue/engine.test.ts` is 779 lines, past the 500-line mark where mixed responsibilities are usual. Every case there drives one class, and the refresh cluster the new cases join is cohesive, so the file stays as it is. The hierarchy's first step (push down to units) does not apply: the behaviour is a property of a live Volar service, not of a pure function. Revisit if this change grows the file beyond that cluster.
- **Layer-fit:** every AC needs a real Volar service over a real workspace, so all six are engine-layer cases against a seeded fixture with inline writes (the `seedNamedFixture(FIXTURES.vueProject.name)` + `fs.writeFileSync` pattern the neighbouring cases already use). No in-memory filesystem path exists for a compiler service.

## Value / Effort

- **Value:** a checked write pays for the files it wrote instead of the whole project. The rebuild is O(project files) and the in-place repair is O(files written), so the saving grows with project size while the work stays proportional to the edit. It also collapses the two rebuilds a written dependency triggers into none.
- **Effort:** one source file changes (`src/plugins/vue/engine.ts`): a private predicate plus a two-line change to each of `refreshFile` and `refreshWrittenFile`. Six new engine cases, one extended assertion, one internals doc section.

## Behaviour

A written path reaches the check in one of four classes. The engine tests both membership sets the cached service holds — `scriptFileNames` (virtual-mapped for `.vue`) and `fileContents` — and repairs the path in place when either holds it.

- [ ] Given a warm service and `src/composables/useCounter.ts` rewritten with a type error, `refreshFile` followed by `getTypeErrors` on that file reports the new error, and a second path the service had read keeps its service-held text while the disk text differs — so the service was repaired, not rebuilt.
- [ ] Given a warm service and `src/App.vue` rewritten so its `<script setup>` assigns a string to a `number`, `refreshFile` followed by `getTypeErrors` on that file reports `errorCount: 1`, and a second path the service had read keeps its service-held text while the disk text differs. (`.vue` paths sit in `scriptFileNames` under their virtual `.vue.ts` name, a different membership branch from the case above.)
- [ ] Given a warm service, a `.vue` file importing `useCounter`, and a write to `useCounter.ts` that changes the exported signature so the importer no longer type-checks, `refreshFile` on `useCounter.ts` alone followed by `getTypeErrors` on the `.vue` importer reports `errorCount: 1` — a query for a file that was never refreshed sees the repaired text.
- [ ] Given a warm service that resolved `dist/dep.ts` through an import from `src/uses-dep.ts` (so the service holds its content in `fileContents` while the workspace walk left it out of `scriptFileNames`), and `dist/dep.ts` rewritten to export a `string` where the importer assigns it to a `number`, `refreshFile` on `dist/dep.ts` followed by `getTypeErrors` on `src/uses-dep.ts` reports `errorCount: 1`, and a second path the service had read keeps its service-held text while the disk text differs.
- [ ] Given a warm service and a newly created `src/brand-new.ts` containing `export const wrong: number = "nope";` — a path the service neither serves nor has read — `refreshFile` followed by `getTypeErrors` on it reports `errorCount: 1`, not `0`. The service cannot see a file it never loaded, so this class must still be rebuilt.
- [ ] Given the drain running after a dispatch wrote `dist/dep.ts` and the check already queried it, `refreshWrittenFile("…/dist/dep.ts")` leaves the service in place — a second path the service had read keeps its service-held text while the disk text differs — and a following `getTypeErrors` on `src/uses-dep.ts` still reports `errorCount: 1`. Today this path is invalidated, so the check's rebuild is discarded and the next read pays a second one.

## Structural criteria

- `src/ts-engine/engine.ts` is unchanged: the ts-morph engine keeps `refreshFile` = `refreshWrittenFile` + diagnostic-parse eviction, and its existing cases in `src/ts-engine/engine.test.ts:86-122` pass unmodified.

## Interface

The public surface is unchanged. `Engine.refreshFile` and `Engine.refreshWrittenFile` keep their names, parameters and `void` returns (`src/ts-engine/types.ts:152-160`); what changes is what `VolarEngine` does inside them.

The one new symbol is private to `VolarEngine`:

- `private repairInPlace(filePath: string): boolean`
  - **Contains:** whether the cached service for `filePath`'s tsconfig could re-read the path in place. `true` means `rereadFile` was called for it; `false` means no service is cached for that key, or the service holds neither `toVirtualVuePath(filePath)` in `scriptFileNames` nor `filePath` in `fileContents`.
  - **Bounds:** one `Map.get`, one array scan of `scriptFileNames` (one entry per project file — 262 on this repo, thousands on a large app) and one `Map.has`. Called once per written path, so a 10× input is a dispatch writing ten times as many files, each paying the same bounded work.
  - **Zero/empty case:** no service cached → `false`, and the caller's fallback decides. "Absent service" and "service that holds nothing for this path" are deliberately the same answer for the check, which must rebuild either way.
  - **Adversarial case:** a path that is both the tsconfig and in `fileContents` (the host reads the tsconfig it parsed) — the in-place branch would keep a service configured from stale options, so the tsconfig is excluded from the repairable set and falls to the invalidating fallback. Paths with spaces or symlinks are compared as the strings the service stored, unchanged from today's `refreshWrittenFile`.

The routing, stated as the pair of fallbacks:

| Method | Repairable | Not repairable |
|---|---|---|
| `refreshFile` (the check) | `rereadFile` | `invalidateService` |
| `refreshWrittenFile` (the drain) | `rereadFile` | `invalidateService` only when the path is its own tsconfig; otherwise leave the service alone |

## Open decisions

**Resolved 2026-09-14 — the check routes a path the service serves or has read through the in-place repair; the two methods differ only in their fallback.**

The alternative considered was leaving `refreshFile` as a full invalidate and giving `CachedService` a build generation so the drain could tell a service rebuilt after the write from one built before it — the shape the handoff entry for the double rebuild implied. Probing each path class showed it unnecessary: with the dependency class repaired in place, no class rebuilds twice (the dependency rebuilds zero times, a file unknown to the service rebuilds once in the check and is served by the time the drain runs, and the tsconfig never reaches the check because `handlesFileExtension` excludes `.json`). Generation tracking would have added mutable state to `CachedService` to solve a case that no longer exists.

- **Enables:** the drain and the check share one membership predicate, so a path class cannot be handled two different ways by accident.
- **Rules out:** a consumer that needs to know whether a service was built before or after a given write would have to add the generation at that point.
- **Watch for:** the repair's correctness rests on `rereadFile` bumping `versions`, which is what makes the language service take a fresh snapshot. A change there silently degrades every AC here into a stale-text answer, which is why the ACs assert diagnostics rather than cache membership.

## Security

- **Workspace boundary:** reads and writes stay as they are. `rereadFile` re-reads a path the service already loaded, and every path reaching both methods comes from the dispatch's own modification ledger, boundary-checked at write time.
- **Sensitive file exposure:** unchanged. The set of files the service reads is decided by `buildVolarService` and TypeScript's resolution, not by this change; the repair re-reads a path already in that set.
- **Input injection:** the parameter list is the same. `filePath` already flows into both methods from these callers.
- **Response leakage:** diagnostics are produced by the same code path as today (`vueGetTypeErrorsForTsFile` / `vueGetTypeErrorsForFile`), from text read the same way. The ACs assert the diagnostics are identical to the rebuild's, so nothing new reaches a response.

## Edges

- The check keeps refreshing every path before querying any (`post-write-diagnostics.ts:26-31`). The hoist still matters: a written path unknown to the service invalidates, so interleaving would rebuild once per such path. Its comment needs rewording, not removal, since "an engine is free to implement `refreshFile` by dropping a whole cached project" stays true for exactly that class.
- The check never refreshes a tsconfig: `getTypeErrorsForFiles` filters on `engine.handlesFileExtension`, which admits only `.ts`, `.tsx`, `.mts`, `.cts` and `.vue`. Assert it — extend the existing extension case (`src/plugins/vue/engine.test.ts:29`) to include `.json` → `false` — because the resolved decision above depends on it.
- `refreshWrittenFile` must keep invalidating for the tsconfig itself (`engine.test.ts:180-191`) and keep leaving a service alone for a path it holds nothing about, such as a written `README.md` (`engine.test.ts:216-232`), and must stay a no-op when no service is loaded (`engine.test.ts:234-242`). All three cases pass unmodified.
- `.mts` and `.cts` need no separate case: the routing branches on membership of the service's path sets, never on extension.
- A workspace with two Vue tsconfigs still refreshes only the service keyed by the written file's own tsconfig. The check reads through the same key it refreshes, so that property stays exactly as queued in its own entry.
- A written path the service cannot see even after a rebuild — gitignored or under a `SKIP_DIRS` directory — is still reported as clean. AC 5 pins that a *newly created* file inside the walk reports its real errors, which is what keeps this change from widening that gap; closing it is the separate queued decision about routing such a path to ts-morph or reporting it unchecked.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/plugins/vue/engine.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`
- [ ] The four preserved cases named in Edges (tsconfig invalidation, path-held-nothing, no-service no-op, ts-morph's own refresh cases) pass unmodified
- [ ] The extension case asserts `.json` → `false`
- [ ] Before/after milliseconds for a multi-file checked write re-measured on a Vue fixture and recorded in the Outcome section
- [ ] `docs/internals/get-type-errors.md:67-104` updated: the hoist rationale, the interleaved-vs-hoisted measurement, and the `refreshFile`/`refreshWrittenFile` contract paragraph all describe the post-change routing
- [ ] Both handoff entries removed (the whole-service rebuild and the double rebuild)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to `docs/internals/get-type-errors.md` or `docs/tech/`
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
