# Stale ts-morph project after a `checkTypeErrors: false` write

**type:** bug
**date:** 2026-09-12
**tracks:** handoff.md # A `checkTypeErrors: false` write leaves ts-morph's project stale, so read operations answer from pre-write text

---

## Symptom

In a daemon session whose ts-morph project is already loaded, a write dispatched with
`checkTypeErrors: false` leaves that project holding the text from before the write. Every
later operation that resolves a position or computes an edit through the cached project
answers from it: `findReferences`, `getDefinition`, `rename`, `findImporters`, `moveSymbol`,
`extractFunction`.

Read side:

```
input:    findReferences at src/lib.ts:2:17 — greet's true on-disk position, after
          replaceText inserted one banner line with checkTypeErrors: false
actual:   {"status":"success","symbolName":"ion ","references":[
            {"file":"src/lib.ts","line":2,"col":13,"length":4},
            {"file":"src/lib.ts","line":3,"col":6,"length":4}]}
expected: {"status":"success","symbolName":"greet","references":[
            src/lib.ts:2:17, src/a.ts:1:10, src/a.ts:3:13, src/a.ts:4:13]}
```

Write side, same setup, `rename greet → salute` at the same true position:

```
actual:   status warn, symbolName "ion ", greet never renamed, lib.ts corrupted:
            1  // banner
            2  export functsalutegreet(name: string): string {
            3    retsalute`hi ${name}`;
expected: greet renamed to salute in lib.ts and at all three call sites in a.ts
```

Both come back `status: success` / `status: warn`, never `error`, so a caller has no signal
that the answer is computed against text that is no longer on disk.

## Value / Effort

- **Value:** the only workaround is "never pass `checkTypeErrors: false`", which is the
  parameter every batch-write caller reaches for. There is no way to detect the bad state
  from a response, and the write-side outcome is a corrupted file plus an unrenamed symbol —
  the user is left repairing a file by hand. It also makes the flag behave as a correctness
  switch while being documented as a cost switch (`docs/commands/rename.md:28` and siblings).
- **Effort:** localised. Root cause confirmed; the fix adds a pending set to state that
  already observes every write, one singleton-only accessor, and one call in
  `dispatchRequest`. No new infrastructure, no new engine method.

Reproduction (real daemon, `weaver` CLI against a two-file project, 2026-09-12):

```
input:    warm the project, then
          replace-text '{"edits":[{...oldText:"export",newText:"// banner\nexport"}],
                         "checkTypeErrors":false}'
          then find-references at src/lib.ts:2:17
actual:   symbolName "ion ", 2 references at lib.ts:2:13 and lib.ts:3:6
expected: symbolName "greet", 4 references
```

Isolation: re-running the identical query after a same-shape write with the check left **on**
returned `symbolName: "greet"` and all 4 references. Same disk state, same query — only the
post-write refresh differed.

## Expected

A read dispatched after any write in the same daemon session answers from the text on disk.
`findReferences` at `src/lib.ts:2:17` returns `symbolName: "greet"` with four references;
`rename` at the same position renames `greet` and leaves no other text altered.

## Root cause

Three things could refresh ts-morph's source file after a daemon write. With
`checkTypeErrors: false`, none of them run.

| Path | Site | With the flag off |
| --- | --- | --- |
| Post-write check's refresh loop | `post-write-diagnostics.ts:30` → `engine.refreshFile` | not reached — gated at `dispatcher.ts:416` |
| Watcher invalidation | `daemon.ts:173` → `invalidateFile` | suppressed by design (`shouldSuppressSelfWrite`) |
| Write-time observation | `self-write-state.ts:38` → `evictDiagnosticParse` → `engine.ts:283` | runs, but drops the diagnostic parse only |

The third is deliberately half a refresh. `engine.ts:276-282` records why:
`refreshFromFileSystemSync` at write time would replace a node tree the in-flight operation
still holds references into. So the diagnostic cache is kept honest on every write, and
ts-morph's own `SourceFile` is repaired only as a side effect of the post-write check —
which is exactly what the flag turns off.

`TsMorphEngine.resolveOffset` (`engine.ts:295-302`) converts line/col through that stale
`SourceFile`, and the language service answers from the same program, so both the offset and
the reported locations are wrong. `rename` then computes its edits at those offsets and
writes them, which is how a file ends up with `functsalutegreet`.

## Fix

Defer the ts-morph half of the refresh to the end of the dispatch that wrote. At that point
the operation has returned and holds no nodes — which is safe by demonstration, not by
argument: the default path already refreshes there, at `post-write-diagnostics.ts:30`.

1. **`src/daemon/self-write-state.ts`** — `SelfWriteState` gains a pending set fed from the
   same `onMutated` hook that already evicts the parse, and `drainPending(): string[]`
   returning the deduped paths and clearing the set. Keeping it here, beside the ledger,
   means the daemon's write-observation state stays in one place and the set is injectable
   through the existing `createSelfWriteState(inner, onMutated)` seam.
2. **`src/daemon/language-plugin-registry.ts`** — add `refreshProjectFile(filePath)`,
   reaching `tsMorphEngineSingleton` only, mirroring `evictDiagnosticParse`'s existing shape
   (`language-plugin-registry.ts:99-101`). It calls the existing
   `TsMorphEngine.refreshFile`; no new engine method. Deliberately **not** the existing
   `invalidateFile`, which fans out to plugins — Vue's `invalidateFile` drops the whole
   Volar service, a measured ~1035 ms rebuild, which a caller who opted out of the check has
   not asked to pay.
3. **`src/daemon/dispatcher.ts`** — drain in the existing `finally` beside `onActivity?.()`,
   so a partially-applied failed operation is covered too. A read-only dispatch drains an
   empty set.

The drain's diagnostic half costs nothing extra: `DiagnosticServiceCache.refreshFile` is a
map lookup and delete, and the write-time `evictFile` has already dropped the service for any
path that carried a parse.

**Measured cost** (this repo, 88-file project, 2026-09-12): `refreshFromFileSystemSync` is
0.05 ms on an unchanged file, 1.6–5 ms on a genuinely changed 400-declaration file, 1.1 ms
for 50 unchanged files — against a ~520 ms end-to-end CLI call.

### Decision record: when to drain

Eager (in `finally` of the writing dispatch) over lazy (before the next dispatch's `invoke`).
The mechanism is identical either way; only the call site differs.

- **Enables:** one invariant a reader can hold — no dispatch returns leaving the engine
  stale. Covers writes that happen outside any later dispatch, and partial writes from an
  operation that threw.
- **Rules out:** the saving lazy would give on a long write-only batch with no reads, which
  the measurement puts at single-digit milliseconds per changed file.
- **Watch for:** a write path that produces many mutations to the *same* file in one
  dispatch pays the refresh once per dispatch, not once per write, because the pending set
  dedupes. If a future operation writes the same file hundreds of times across separate
  dispatches, re-price this.

### Adjacent inputs

- **`.mts` source.** The drain offers every mutated path and lets the engine filter by what
  it tracks. The laziest wrong implementation is an extension allowlist, and the codebase
  already contains that mistake (`post-write-diagnostics.ts`, `handoff.md:187`), so this
  input gets its own regression test.
- **A removal in the pending set** — `deleteFile`, and the old path of a `moveFile`.
  `RecordingFileSystem.rename`/`unlink` report both paths through `onMutated`, so a deleted
  path reaches the drain. Verified 2026-09-12 that `refreshFromFileSystemSync` on a deleted
  file returns `Deleted` and forgets the source file rather than throwing.
- **A read-only dispatch.** Drains an empty set; must not build an engine or touch a
  project that was never loaded.

## Security

- **Workspace boundary:** unchanged. The drain refreshes paths the daemon itself wrote
  through `WorkspaceScope.writeFile`, which enforced the boundary before the write. It
  introduces no new write and no new path source — the pending set is fed only by
  `RecordingFileSystem`, whose mutations all passed the boundary check.
- **Sensitive file exposure:** N/A for new exposure. `refreshFromFileSystemSync` re-reads a
  file the daemon has already written, into a project that already held it; nothing new is
  read and no content reaches a response.
- **Input injection:** N/A — no new parameter, and no user-supplied string reaches the
  filesystem through this change.
- **Response leakage:** N/A — the drain adds no response field and no error message. It runs
  in `finally` and its result is not part of the response.

## Edges

- **The default path must not regress.** With `checkTypeErrors` left on, the post-write check
  still refreshes before querying; the drain that follows finds unchanged content and is a
  no-op.
- **A Vue project is not fixed by this.** `VolarEngine.resolveOffset`
  (`plugins/vue/engine.ts:170`) reads from disk, and its reads answer from the Volar service,
  so the stale state there is the service, not ts-morph's project — that is
  `handoff.md:185`'s entry. This fix refreshes the ts-morph singleton only, and a `.vue`
  write is likewise out of scope. Stated here so the boundary is deliberate, not assumed.
- **`tsAfterFileRename` keeps its own eviction** (`after-file-rename.ts:23-26`). The drain
  does not replace it: that eviction runs *inside* a move, between the two halves of the
  operation, where this fix deliberately does nothing.
- **Concurrency.** Requests are serialised by the daemon's promise-chain mutex, so no second
  dispatch interleaves with a drain. The pending set needs no locking.

## Done-when

- [ ] The reproduction returns `symbolName: "greet"` and four references, driven through the
      `weaver` CLI against a real daemon (not only vitest)
- [ ] `src/operations/rename.scenarios.yaml` — three-step scenario (warm read, unchecked
      write, rename) passes; it is red before the fix (verified 2026-09-12)
- [ ] `dispatcher-self-write.test.ts` covers: unchecked write then `findReferences` returns
      the correct symbol and lines; the same with a `.mts` source; an unchecked `deleteFile`
      followed by a read
- [ ] `self-write-state.test.ts` covers that `drainPending` returns the paths written
      through the shared filesystem and is empty on the next call, so the set cannot grow
      for the life of the daemon
- [ ] `language-plugin-registry.test.ts` covers that `refreshProjectFile` before any engine
      is loaded does not throw, matching the existing `invalidateFile` case
- [ ] A Vue-project smoke case: an unchecked write followed by a read completes without
      error. This fix does not repair Volar's own staleness (`handoff.md:185`), so the case
      pins that the drain does not break the Vue path rather than that it fixes it
- [ ] Mutation score ≥ threshold for `src/daemon/self-write-state.ts` and
      `src/daemon/language-plugin-registry.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green
      `pnpm check` does not stand in for it
- [ ] `docs/internals/get-type-errors.md:82-90` — the list of what invalidates what gains the
      deferred ts-morph refresh, since that list is where the next reader looks
- [ ] `docs/internals/daemon.md` — the write-observation description states that the parse
      eviction happens at the write and the ts-morph refresh at the end of the dispatch
- [ ] handoff.md gains a `[needs design]` entry: a scenario step cannot use surgical
      `replaceText`, because `resolveRelativePaths` resolves only the params
      `pathParamsFor` declares, so a nested `edits[].file` stays relative and the step fails
      with `WORKSPACE_VIOLATION`
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
