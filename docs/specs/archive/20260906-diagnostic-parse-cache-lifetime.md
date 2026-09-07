# Give the diagnostic parse cache its own lifetime

**type:** change
**date:** 2026-09-06
**tracks:** handoff.md # The diagnostic program is rebuilt from scratch after every write → docs/internals/get-type-errors.md

---

## Context

Weaver type-checks every file it writes. Doing that needs TypeScript's parsed view of
the project — 753 source files on this repository. After each write that whole view is
thrown away and rebuilt from disk, costing **747–831 ms per write**
([measurements](20260906-diagnostic-rebuild-cost-spike.md)).

The cause is a variable's location, not a decision. `buildCompilerHost`
(`diagnostic-service.ts:29`) declares `const parsed = new Map<string, ts.SourceFile>()`
inside the closure it returns, so the cache is owned by whichever `DiagnosticService`
created it. `refreshFile` deletes one entry from `DiagnosticServiceCache`, and 753
parses die with it because nothing else holds a reference.

It cannot simply stop dropping. The comment at `diagnostic-service.ts:22-26` states the
current correctness argument outright — the cache "cannot go stale" *because* the only
invalidation drops the whole thing. Retaining parses without a per-file signal would
report errors against content no longer on disk, and keep files that moved looking
present. Replacing that argument is the work.

## User intent

*As a developer refactoring with weaver, I want the type check after each write to be
fast enough not to interrupt me, so that I keep the safety of a post-write check instead
of learning to avoid the operations that run it.*

## Relevant files

- `src/ts-engine/diagnostic-service.ts` — `buildCompilerHost` owns the parse cache (`:29`);
  `DiagnosticServiceCache` (`:192`) is where the cache's new home goes. The comments at
  `:22-26` and `:104-118` record the invariants this change replaces — read both before editing.
- `src/ts-engine/engine.ts` — `refreshFile` (`:270`) and `invalidateProject` (`:110`) are the
  two signals; `loadDiagnosticServiceEntry` (`:169`) rebuilds roots from the ts-morph project
  on every cache miss.
- `src/ts-engine/move-file.ts` — the operation with no invalidation call at all.
- `src/daemon/post-write-diagnostics.ts` — the hot path; already refreshes every file before
  querying any, so one write costs one rebuild rather than one per file.
- `src/ports/in-memory-filesystem.ts`, `src/ports/__testHelpers__/throwing-filesystem.ts` —
  the diagnostic service is built over an injectable `fs: FileSystem`, and the throwing helper
  is the precedent for a wrapper that observes port calls.

### Red flags

- `src/ts-engine/engine.test.ts` is 415 lines — under the hard flag but close enough that new
  cases should not land there by default. New tests belong in `diagnostic-service.test.ts`
  (222 lines, ample room), which already owns this module's behaviour.
- No prep refactor needed.

**Layer-fit:** AC1, AC2 and AC4 are pure functions of file content and call sequence — unit
tests against `InMemoryFileSystem`, driving `DiagnosticServiceCache` directly. AC3 needs the
real move path (physical rename plus importer rewrite) against a warmed cache, so it is a
focused test calling the engine directly — see the note under Behaviour for why it cannot sit
at the operation layer.

## Value / Effort

- **Value:** A post-write type check stops costing most of a second. The check exists so a
  refactor cannot silently leave the workspace broken; at ~800 ms per write it is the kind of
  cost that makes a caller reach for an operation that skips it. It also closes a real
  correctness gap — `move-file.ts` invalidates nothing today, so it is the one operation whose
  post-write check can be answered from a graph that no longer matches disk.
- **Effort:** Three source files, no new modules or types, no public surface change. The cache
  moves up one level and gains a `delete`; two existing signals are re-pointed at it; one
  operation gains a call it should always have had.

## Behaviour

- [ ] Given a file checked once, then rewritten on disk with a new type error, then passed to
      `refreshFile` — the next `get-type-errors` on that file reports the **new** error and not
      the previous clean result. *(unit, `InMemoryFileSystem`)*
- [ ] Given a project of N files checked once, then one file passed to `refreshFile` and checked
      again — exactly **one** file's content is read through the `FileSystem` port during the
      second check. *(unit, counting `FileSystem` wrapper)*
- [ ] Given a check has parsed `a.ts`, and `move-file` then moves it to `b.ts`, a later check
      on the old path is not answered from the parse taken before the move.
      *(focused test, `move-file.test.ts`)*
- [ ] Given `invalidateProject` is called for a tsconfig, the next check re-reads **every** file
      through the `FileSystem` port. *(unit, counting `FileSystem` wrapper)*
- [ ] Given any operation rewrites a file's contents — a `rename`'s edits, a move's importer
      rewrites — a later check reflects what is on disk, whether or not the caller asked for
      diagnostics. *(regression test at `dispatchRequest`, plus a unit test at the port seam)*

**Type matrix.** The diagnostic service serves the ts-morph path only, so `.ts`/`.tsx` are the
input types. `.vue` is out of scope with a reason rather than a case: SFCs are answered by
`VolarEngine`, whose own `refreshFile` (`src/plugins/vue/engine.ts:95`) shares no code with
`diagnostic-service.ts`.

The second criterion is what makes the caching claim falsifiable. An implementation that keeps
dropping everything satisfies the first, third and fourth and fails only that one.

**The third criterion was rewritten during implementation.** It first read: *"`move-file` moves
`a.ts` → `b.ts` while another file still imports `a.ts`, the post-write check reports the
unresolved module"*, pinned by a scenario. That failure cannot occur, and the reason is
structural. `getTypeErrorsForFiles` (`src/daemon/post-write-diagnostics.ts`) only checks paths
in `filesModified`: an importer that *was* rewritten is in that array and resolves against the
new path, and one that was *not* rewritten never enters it and is never asked about. Neither
branch produces an unresolved module.

The retained parse is real, but no operation-layer route reaches it — `getTypeErrors`
(`src/operations/getTypeErrors.ts:15`) throws `FILE_NOT_FOUND` on its own existence check
before the engine is consulted, and post-write diagnostics filters on `scope.fs.exists` the
same way. So the guard, not the cache, is what answers for a moved-away path today, and the
criterion is observable only through a direct engine call — the exemption the `scenario-tests`
skill names. The fix still belongs in `move-file`: not serving a file that is gone is the
engine's own invariant, and resting it on a caller's existence check is what left `move-file`
with no invalidation call in the first place.

## Structural criteria

- (none — the cache's new ownership is the mechanism of the criteria above, not a separate deliverable)

## Interface

No public surface change: no new CLI action, socket handler, parameter, or error code. The
change is behind `Engine`, whose `refreshFile(path: string): void` signature is unchanged.

Two internal seams move:

- The parse cache becomes a per-tsconfig `Map<string, ts.SourceFile>` owned by
  `DiagnosticServiceCache` rather than captured in `buildCompilerHost`'s closure. Contents:
  one entry per source file the compiler has asked for, keyed by absolute path. Bounds: the
  project's file count — 753 here, ~130 MB. Empty case: a cold cache, which is exactly today's
  behaviour on every check. Adversarial case: a workspace large enough that retention matters,
  which is the resident-memory tradeoff recorded under Open decisions.
- `DiagnosticServiceCache` holds the service and its parses in one entry and builds the
  service itself, taking a `DiagnosticProjectSource` (`compilerOptions`, `rootNames`, and an
  injectable `fs: FileSystem`) from the caller. **Revised during implementation:** the spec
  first had `buildDiagnosticService` take the cache as a parameter and the engine thread it
  through. That shipped and was reverted in review — it put a `Map<string, ts.SourceFile>`
  the engine never reads into an exported signature, and forced a positional `undefined` at
  the call site to skip `fs` and reach it. Keeping construction inside the cache leaves the
  parse map private to the module, and `buildDiagnosticService` is gone rather than surviving
  as an export only its own tests called.

## Open decisions

**Decision (resolved): does the retained parse cache stay unbounded?**

- **Options:** unbounded per tsconfig; a bounded LRU; or defer the whole change until the
  daemon-memory entry is designed.
- **Chosen:** unbounded.
- **Reasoning:** unbounded-now and idle-eviction-later compose rather than conflict — the
  daemon-memory entry is already weighing evicting the diagnostic program on idle, and that
  policy drops this cache with it. A bounded LRU would put two eviction policies in competition
  over the same objects, and its cap would be a guess: there is no measurement saying which cap
  preserves the win. It would also make write latency depend on cache state — sometimes 250 ms,
  sometimes 800.
- **Consequences.** Steady-state memory rises by ~130 MB per tsconfig, on top of the 1342 MB
  already measured for two tsconfigs. Peak does not move, because that same 130 MB is allocated
  and discarded on every check today — but the parses stop being reclaimable between checks,
  and that is a real increase, not a free trade. It is accepted because the two costs are not
  symmetric: the 550 ms is paid by the user on every write and is unrecoverable without this
  change, while the memory is recoverable by a policy the next task is already designing.
  **For that task: this cache is the first thing to evict on idle.**

**Decision (resolved): is `oldProgram` passed to `ts.createProgram`?**

- **Chosen:** no — the existing comment at `diagnostic-service.ts:104-118` stands unchanged.
- **Reasoning:** measured at ~60 ms beyond this change's ~250 ms, roughly 7% of the original
  path, against pinning a compiler-internal bug the earlier work could not isolate or reproduce
  under minimal options. The handoff entry treated it as a blocker; it is a scope exclusion.
- **Consequences:** the `moveFile` scenario *two out-of-project files move in turn*, which goes
  red when `oldProgram` is passed, stays green and keeps guarding this.

**Decision (resolved): where does a write's eviction come from?**

- **Options:** (A) split `dispatchRequest`'s post-write block so it always refreshes `filesModified`
  and only *reports* under `checkTypeErrors`; (B) evict where the write is observed; (C) validate
  each cached parse against mtime+size on read.
- **Chosen:** B, at the `FileSystem` port — extend the existing self-write decorator
  (`src/daemon/self-write-state.ts`, `recording-filesystem.ts`) so the observations already feeding
  `SelfWriteLedger` also evict the diagnostic parse. `dispatcher.ts` builds every scope over the one
  `getSharedFileSystem()` instance, so the seam already sees every write.
- **Reasoning:** A leaves an engine invariant to a transport adapter, which `design-principles.md`
  rules out, and it does not even close the default path: `post-write-diagnostics.ts` filters to
  `.ts`/`.tsx` while importer rewrites cover `.js`/`.jsx`, so a rewritten `.js` importer under
  `allowJs` is never evicted. C costs little (~1.4 ms per rebuild for 753 files, measured) but fixes
  only the diagnostic half — ts-morph's `Project` stays stale — and turns every future
  missing-eviction bug from deterministic into intermittent, which is the wrong failure mode for a
  tool whose value is that its check cannot lie.
- **Consequences.** `after-file-rename.ts`'s hand-rolled `engine.refreshFile(oldPath)` is deleted
  along with the class of bug it patched. Two constraints hold the shape:
  - **The write path evicts the diagnostic parse only — it must not call `TsMorphEngine.refreshFile`.**
    That calls `refreshFromFileSystemSync()`, replacing ts-morph's node tree, and operations hold
    ts-morph node references across `scope.writeFile` calls (`persistSourceFile`, `move-symbol`).
    An eviction is a `Map.delete` and cannot disturb anything in flight. `post-write-diagnostics`'s
    refresh loop stays where it is as the ts-morph-side signal.
  - **Dropping the cached service is guarded on a parse actually being evicted**, or every
    `.md`/`.json` write in the workspace throws away a program for nothing. The guard belongs in
    `DiagnosticServiceCache`, not in an extension filter at the write site: an earlier attempt
    put it in the daemon and missed `.mts`/`.cts`, which the program parses but the
    importer-rewrite extension set does not name. Which paths carry a parse is the cache's to
    know.
  If `FileSystem` grows a fifth mutating verb, the decorator fails to compile rather than silently
  going stale — that asymmetry is why the port is the seam rather than the dispatcher.

## Security

- **Workspace boundary:** N/A — no new file reads or writes. The compiler host reads the same
  paths it reads today, through the same `FileSystem` port, and no new path is constructed.
- **Sensitive file exposure:** the cache retains parsed content in memory for longer than it does
  today. It does not widen *what* is read: entries are created only for files the compiler
  requests, which are TS/JS sources reachable from the tsconfig roots. `.env` and similar are not
  program roots and are never parsed, so `isSensitiveFile` is not reached by this path.
- **Input injection:** N/A — no new string parameters; cache keys are absolute paths the engine
  already resolved.
- **Response leakage:** N/A — the change alters when a `ts.SourceFile` is reused, not what any
  diagnostic contains. Diagnostics are still mapped by the existing `toDiagnostic`.

## Edges

- Retention makes correctness depend on every content change producing a signal. The watcher's
  `add`/`unlink` path calls `invalidateAll`, which sets `tsMorphEngineSingleton = undefined` and
  takes the cache with it, so structural changes on disk are already covered.
  **Corrected during implementation — this bullet originally read "the exposure is an edit that
  produces no watcher event *and no weaver write*", which assumed weaver's own writes emit a
  signal. Most do not.** `rename.ts` emits none; `applyRenameEdits`,
  `rewriteImportersOfMovedFile`, `rewriteMovedFileOwnImports` and `persistSourceFile` all write
  through `scope.writeFile` and evict nothing. Only `set-export`, `delete-file`,
  `extract-function` and `move-symbol` signal at all, and they use the blunt `invalidateProject`.
  With parses retained, that gap produces a **fabricated diagnostic**: after a move, an importer
  is served from its pre-move parse and reports `TS2307` against a specifier the file no longer
  contains. Weaver's own write is the exposure, not the thing that closes it.
- `refreshFile` must keep refreshing the ts-morph source file as it does now
  (`engine.ts:272-273`); this change only alters what happens to the diagnostic half after it.
- One write must still cost at most one program rebuild. `post-write-diagnostics.ts` refreshes
  every file before querying any, and that ordering is what guarantees it — it must not be
  interleaved.

## Done-when

- [ ] All four criteria above verified by tests — three unit, one scenario
- [ ] A post-write check on this repository is measurably faster than the recorded 747–831 ms
      baseline, observed on the real CLI path rather than in a test
- [ ] `move-file` calls the eviction signal for the source path, and the third criterion's test
      fails without it
- [ ] A rewritten importer is not served from its pre-move parse — verified by the `TS2307`
      reproduction failing before the change and passing after, on the `checkTypeErrors: false` path
- [ ] The `.js`-importer gap is measured at HEAD and either closed or recorded as out of scope
- [ ] The `moveFile` scenario *two out-of-project files move in turn* still passes
- [ ] The stale-cache comment at `diagnostic-service.ts:22-26` is rewritten — its stated invariant
      ("the only thing that invalidates a file is `invalidateProject`") is no longer true
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] `docs/internals/get-type-errors.md` updated: the cache's lifetime and the two signals that
      evict from it
- [ ] handoff.md entry removed; the daemon-memory entry gains the note that this cache is the
      first candidate for idle eviction
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Shipped** in 13 commits, `222348b..d431fb9`. 14 files, +603/-125.

### Verification

Driven on the real CLI path against this repository, timing `weaver rename` with and
without `checkTypeErrors` and taking the difference as the cost of the post-write check.
The same command, before and after, with the daemon warm:

| | check off | check on | cost of the check |
|---|---|---|---|
| Retention removed (the old behaviour) | 333 ms | 873 ms | **~540 ms** |
| Shipped | 331 ms | 379 ms | **~45 ms** |

The correctness half was verified by comparing the program's parse against disk after a move.
A warm cache also returns a clean result, so the parse text is what separates the two:

```
eviction OFF | parse: "import { helper } from './utils.js';"     | disk: "…'../lib/utils.js';" | match: false
eviction ON  | parse: "import { helper } from '../lib/utils.js';" | disk: "…'../lib/utils.js';" | match: true
```

Tests: 1439 unit/integration + 531 eval, `pnpm check` green. Mutation on touched files —
`recording-filesystem.ts` 100%, `self-write-state.ts` 100%, `diagnostic-service.ts` 76.54%
(from 74.36; the remaining survivors are compiler-host arms recorded at the line, needing
a failing real filesystem or a `node_modules` tree the harness has neither of).

### What this cost, and why

**Three correctness regressions came out of the change**, all surfaced by review passes, and all
of one shape: retention converts an unsignalled write into a confidently wrong answer.

1. `move-directory` emitted no eviction at all — a check on a moved-away path returned clean.
2. Importers rewritten during a move kept their pre-move parses, producing a **fabricated
   TS2307** naming a specifier the file no longer contained. The check exists so a caller can
   trust the workspace after a refactor, and this made it report a fault that was not there.
3. The first fix for (2) filtered on an extension set borrowed from the importer rewrites,
   which silently missed `.mts`/`.cts`.

(3) repeated the mistake it was fixing: a whitelist kept in step with something it did not own.
The shape to distrust is any place that answers "which files matter here?" away from the thing
that knows.

### Decisions worth keeping

**The eviction belongs at the `FileSystem` port, not the dispatcher and not a freshness
check.** `RecordingFileSystem` already observed every daemon mutation, to tell weaver's own
writes apart from external ones; the seam existed and only needed a second observer. Two
alternatives were priced and rejected:

- *Split the dispatcher's post-write block.* Puts an engine invariant in a transport adapter,
  and would not have closed it anyway — `post-write-diagnostics` filters to `.ts`/`.tsx`
  while importer rewrites cover `.js`/`.jsx`.
- *Validate each parse against mtime+size on read.* Costs almost nothing (~1.4 ms per rebuild
  for 753 files, measured) and closes external edits too, which the port seam does not. Rejected
  because it turns a missed eviction from a deterministic bug into an intermittent one, which
  costs more to find and leaves less confidence once fixed.

**Which paths carry a parse is the cache's question.** `DiagnosticServiceCache` drops a
service only when a parse was actually evicted, so callers can offer every mutation without
knowing anything about extensions. That one guard fixed the `.mts` gap and deleted the filter.

**Eviction spans every tsconfig.** A file can be a root of two programs; resolving the nearest
config left the other stale.

### Reflection

**What worked.** Every claim in this document is a before/after on the same command, and
insisting on the red half caught two false greens. One was mine — a probe that came back clean because *nothing was evicting*, so it
returned a warm pre-move answer. A green result whose mechanism you have not confirmed is not
evidence.

**What did not.** Two failures of process, both mine:

- I wrote a scenario requirement into an execution agent's prompt straight from the spec,
  without reading `scenario-tests`, which owns test-layer decisions. The spec's stated layer
  was wrong — its criterion described a failure no caller can produce — and discovering that
  empirically cost a 197k-token agent run. The rule this produced lives in `CLAUDE.md` under
  *Delegating to subagents*.
- I then wrote an end-to-end test that asserted nothing, because `getTypeErrors` throws
  `FILE_NOT_FOUND` on its own existence check before the engine is consulted. It passed with
  the fix reverted. Caught only because the deviation had already made me suspicious, which is
  not a reliable trigger.

**For the next agent.** Retention is a hazardous change class: each surviving cache is a new
staleness surface, and the failure mode is a plausible wrong answer rather than a crash. Budget
for review on this kind of change — all three regressions above came from review passes, while
the tests written alongside the change stayed green. Four further staleness gaps were reproduced
and queued in handoff.md; all four predate this work, and the ts-morph one (read operations
answering from pre-write text after a `checkTypeErrors: false` write) is the most user-visible.
