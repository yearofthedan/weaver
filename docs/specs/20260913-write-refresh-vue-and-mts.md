# A write's refresh misses the Vue service, and the check skips `.mts`

**type:** bug
**date:** 2026-09-13
**tracks:** handoff.md # A Vue project's SFC compiler stays behind disk after an unchecked write; # The post-write check skips `.mts`/`.cts`, so those writes report clean

---

## Symptom

Two queued entries, one filter chain: what a daemon write refreshes, and which files the
post-write check reports on. Both make the daemon answer from text that is not on disk.

**1. A Vue project answers from before the write — in both directions.**

```
input:    warm the Volar service (get-type-errors on src/App.vue), then
          replace-text inserting ": number" into App.vue's script with
          checkTypeErrors:false, then get-type-errors on src/App.vue
actual:   {"status":"success","diagnostics":[],"errorCount":0,"truncated":false}
          — repeated, indefinitely
expected: TS2322 at App.vue:4:7
```

```
input:    a CHECKED write breaking src/composables/useCounter.ts (reported 2 errors),
          then an UNCHECKED write reverting it, then get-type-errors on that file
actual:   errorCount 2 — both errors naming text no longer on disk
expected: errorCount 0
```

Both directions are wrong: an error on disk goes unreported, and a removed error keeps
being reported. A caller cannot tell either outcome from a correct one — both come back
`status: success`.

**2. A `.mts` write reports clean with the check left ON.**

```
input:    replace-text writing "return 42;" into a string-returning function in
          src/lib.mts on a "module": "nodenext" project, checkTypeErrors left on
actual:   {"status":"success","filesModified":[".../src/lib.mts"],"replacementCount":1,
           "typeErrors":[],"typeErrorCount":0,"typeErrorsTruncated":false}
expected: typeErrorCount 1 — get-type-errors on that same file reports
          TS2322 "Type 'number' is not assignable to type 'string'."
```

## Value / Effort

- **Value:** `checkTypeErrors: false` is offered on all seven write operations to skip the
  check's cost, and in a Vue project it silently turns every later read in that daemon
  session into a guess — including `rename` and `move-symbol`, which compute edits from
  those positions. The `.mts` half needs no flag at all: a caller running the check is
  told its write compiles when it does not. Recovery takes a daemon restart between
  calls.
- **Effort:** localised — plumbing through the drain that already exists. Five files: the
  Volar service factory, the Vue engine, the registry fan-out, and one
  `handlesFileExtension` in each engine.

## Expected

A read dispatched after any write in the same daemon session answers from the text on
disk, in a Vue project as in a TS-only one, whether or not the write ran the check. A
write to a `.mts` or `.cts` file with the check on reports that file's type errors.

## Root cause

**Confirmed by reproduction and isolation, 2026-09-13, at `b9d73f7`.**

Three things could bring a compiler to the text a daemon write just produced. In a Vue
project, with `checkTypeErrors: false`, none of them reach Volar:

| Path | Site | With the flag off |
| --- | --- | --- |
| Post-write check's refresh loop | `dispatcher.ts:416` gate → `post-write-diagnostics.ts:26` → `engine.refreshFile` | not reached |
| Watcher invalidation (fans out to plugins) | `daemon.ts` → `invalidateFile` → `plugin.invalidateFile` | suppressed by design (`shouldSuppressSelfWrite`) |
| End-of-dispatch drain | `dispatcher.ts:450` `refreshWrittenFiles` → `refreshProjectFile` | runs, but reaches `tsMorphEngineSingleton` only (`language-plugin-registry.ts:105`) |

The drain's restriction is deliberate and its comment says why: `VolarEngine.refreshFile`
is `invalidateService` (`plugins/vue/engine.ts:101-103`), which deletes the whole cached
service for the tsconfig, so fanning the drain out would put a full service rebuild on the
next read after every dispatch that wrote.

**Isolation.** Two controls, same daemon, same disk:

- Stopping the daemon and re-asking returned the TS2322 — so the error is real and the
  compiler can see it; only the retained service could not.
- An **external** write to the same file was picked up correctly on the next read. The
  plugin fan-out works; what is missing is a path from the daemon's *own* write to it.

**Three things have to move together.** `buildLanguageServiceHost` creates `versions`
(`plugins/vue/service.ts:79`) and writes to it nowhere, so `getScriptVersion` always
answers `"0"` and the TypeScript language service keeps the snapshot it first took. A
`.vue` file needs its `language.scripts` registration replaced as well, since that is
what regenerates the virtual TypeScript. `VolarEngine.notifyFileWritten`
(`engine.ts:288`) updates `fileContents` and has no production caller; that update alone
leaves a read answering from the snapshot.

**The `.mts` half.** `post-write-diagnostics.ts:23` filters `filesModified` through
`engine.handlesFileExtension`, and both implementations decline: `TsMorphEngine`
(`ts-engine/engine.ts:212`) allows `.ts`/`.tsx`, `VolarEngine`
(`plugins/vue/engine.ts:449`) adds `.vue`. Confirmed directly:
`.ts=true .tsx=true .mts=false .cts=false .js=false`. A declined path is neither
refreshed nor queried, and the operation reports `typeErrorCount: 0`.

## Fix

A per-file Volar refresh, fanned out from the drain. The measurements below come from a
prototype of this fix, since reverted.

1. **`src/plugins/vue/service.ts`** — `buildVolarService` owns the `versions` map and
   passes it into `buildLanguageServiceHost` (which stops creating its own). `CachedService`
   gains a per-file refresh that: re-reads the path from disk, sets `fileContents`,
   increments that path's version, and re-registers the snapshot with
   `language.scripts.set(path, snapshot, path.endsWith(".vue") ? "vue" : "typescript")`.
   All three are needed: the version is what makes the TS language service re-snapshot,
   and the `language.scripts` registration is what makes Volar regenerate an SFC's virtual
   TypeScript. A path that can no longer be read drops its `fileContents` entry and bumps
   its version.
2. **Untracked-path guard.** The refresh can only repair files the service already serves:
   `scriptFileNames` is fixed when the service is built, so re-registering a path that is
   not in it leaves the language service unable to serve it. When the path (via
   `toVirtualVuePath`) is not among `scriptFileNames`, fall back to `invalidateService`.
   No current operation reaches this — every operation that creates a path
   (`moveFile`, `moveSymbol`, `extractFunction`, `deleteFile`) invalidates the service
   itself, confirmed by a `moveFile` whose next read cost 870 ms — so the guard runs on a
   path no current caller takes, and holds the refresh to files it can actually repair.
3. **`src/plugins/vue/engine.ts`** — `VolarEngine` applies that refresh across its cached
   services. `refreshFile` keeps its current meaning (drop the service): the checked
   path's cost is a separate entry, not this fix.
4. **`src/daemon/language-plugin-registry.ts`** — the drain's per-path call fans out to
   every loaded engine instead of the ts-morph singleton alone. Add `refreshWrittenFile`
   to the `Engine` interface (`ts-engine/types.ts`), implemented by both engines, and
   rename `TsMorphEngine.refreshProjectFile` to it — one slice old, three call sites, and
   "project" stops being accurate once Volar implements the same contract. The registry's
   exported function takes the same name, matching the dispatcher's `refreshWrittenFiles`
   that drives it.
5. **`src/ts-engine/engine.ts:212` and `src/plugins/vue/engine.ts:449`** —
   `handlesFileExtension` accepts `.mts` and `.cts`.

**Measured, on the Vue fixture project through the real CLI and daemon:**

| Read | Before | With the prototype |
| --- | --- | --- |
| after an unchecked SFC write | 0 errors (wrong), 233 ms | TS2322 (correct), 233 ms |
| after an unchecked revert of a `.ts` error | 2 stale errors, 228 ms | 0 errors (correct), 228 ms |
| after the service is dropped (what a `refreshFile` fan-out would cost) | 885 ms | — |

So the per-file refresh costs nothing measurable against a warm read, where fanning out
`refreshFile` would have added ~650 ms to the next read after every write.

### Adjacent inputs

- **A `.ts` file in a Vue project**, not only a `.vue` one — both are served by the Volar
  service, and the false-positive reproduction above is the `.ts` case.
- **`.cts` alongside `.mts`** — same filter, same answer (`false`), no separate mechanism.
- **`.js`/`.jsx` are deliberately excluded.** Whether a `.js` file is checkable depends on
  `allowJs`, and asking anyway is a known throw
  ([archived spec](archive/20260829-get-type-errors-throws-on-untyped-js.md)). Out of
  scope.
- **An unchecked `deleteFile`, and the old path of a `moveFile`** — both reach the drain as
  paths that no longer exist. The prototype's unreadable-path branch returned cleanly and a
  later read was correct.
- **A read-only dispatch** — drains nothing, and must not build a service that was never
  loaded.
- **An unchanged write** (identical bytes) — refreshes, bumps a version, and costs one
  re-snapshot of one file. An early return on equal content is left out deliberately: it
  saves work the measurement above prices at nothing a caller can observe.

## Security

- **Workspace boundary:** unchanged. The refresh re-reads paths the daemon itself wrote
  through `WorkspaceScope.writeFile`, which boundary-checked them before the write; the
  drain's pending set is fed only by `RecordingFileSystem`.
- **Sensitive file exposure:** N/A for new exposure. The service re-reads a file it already
  held and already served; `isSensitiveFile` governs which files operations write, which
  this does not change.
- **Input injection:** N/A. Every path the refresh takes comes from the daemon's own
  recorded mutations, so the only strings reaching the filesystem are ones an operation
  already wrote.
- **Response leakage:** the `.mts`/`.cts` change makes diagnostics for those files appear
  in `typeErrors`, which is the same content the existing `.ts` path already returns and
  what the caller asked for. The drain adds no response field.

## Edges

- **The checked path must not regress.** With the check on, `refreshFile` still drops the
  service before querying, and the drain's per-file refresh then finds the same content.
  A checked write that introduces an error must still return `status: warn` with the
  diagnostics.
- **The hoisted-refresh rationale in `docs/internals/get-type-errors.md:68` stays true**
  — it is about `refreshFile`, which this fix does not change. The doc gains the second
  contract so the two are not confused.
- **A `.vue` write must move the *virtual* TypeScript.** That is what the
  `language.scripts.set` half is for, and the SFC reproduction is what proves it.
- **Volar's memory behaviour is unchanged** — the service is retained, not rebuilt, so the
  idle-eviction boundary in `docs/internals/daemon.md:77` (plugin engines untouched) still
  holds.

## Done-when

- [ ] Both reproductions produce the expected output, driven through the built `weaver`
      CLI against a real daemon (not only vitest): the unchecked SFC write followed by a
      check reports TS2322, and the `.mts` write with the check on reports
      `typeErrorCount: 1`
- [ ] `dispatcher-self-write.test.ts` — the existing Vue case at :246 ("completes a read
      after an unchecked write in a Vue project") is upgraded from "does not throw" to
      asserting the correct answer, and gains: the false-positive direction (unchecked
      revert of a reported error → `errorCount: 0`), and a `.ts`-file-in-a-Vue-project case
- [ ] `dispatcher-self-write.test.ts` — an unchecked `deleteFile` in a Vue project
      followed by a read of a surviving file, mirroring the existing TS case at :216
- [ ] A dispatcher-level case for a `.mts` write with the check **on** reporting its
      errors, and one for `.cts`
- [ ] `engine.test.ts` (both engines) — `handlesFileExtension` accepts `.mts`/`.cts` and
      still declines `.js`
- [ ] `service.test.ts` — refreshing a tracked file leaves the *same* `CachedService`
      instance in the cache (a dropped service would be a new object), and a subsequent
      read answers from the new text; refreshing a path the service does not serve drops
      the service instead
- [ ] The checked-path control: a checked write that introduces an error still returns
      `status: warn` with the diagnostics
- [ ] Mutation score ≥ threshold for `src/plugins/vue/service.ts` and the changed part of
      `src/plugins/vue/engine.ts`. `service.ts` measured 54.5% on 2026-08-31 and its
      pre-existing survivors are their own queued entry — score the lines this fix adds
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green
      `pnpm check` does not stand in for it
- [ ] Docs updated:
      - `docs/reference/response-format.md:52` — drop the Vue caveat on the flag
      - `docs/internals/daemon.md:65` — the write-observation description states that the
        end-of-dispatch refresh now reaches every loaded engine, and drops the "known gap"
        sentence
      - `docs/internals/watcher.md:78` — same correction to its closing sentence
      - `docs/internals/get-type-errors.md:68` — name the two refresh contracts
        (`refreshFile` drops the service for the check; `refreshWrittenFile` is the
        per-file repair the drain uses) and record that the post-write check covers
        `.mts`/`.cts`
- [ ] handoff.md gains a `[needs design]` entry: in a Vue project the *checked* write path
      still pays a full service rebuild — measured 949 ms against ~230 ms warm on the
      four-file fixture — because `getTypeErrorsForFiles` calls `refreshFile`; decide
      whether it can route through `refreshWrittenFile` for a tracked path, which is the
      same question `get-type-errors.md:68`'s hoisting note answers for today's contract
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` doc — at minimum that a
      Volar per-file refresh needs all three of content, version, and script
      re-registration, since any two of them silently leave a read stale
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
