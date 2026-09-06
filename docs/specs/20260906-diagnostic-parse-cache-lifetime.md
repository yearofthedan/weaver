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
  `buildDiagnosticService` takes an injectable `fs: FileSystem`, and the throwing helper is the
  precedent for a wrapper that observes port calls.

### Red flags

- `src/ts-engine/engine.test.ts` is 415 lines — under the hard flag but close enough that new
  cases should not land there by default. New tests belong in `diagnostic-service.test.ts`
  (222 lines, ample room), which already owns this module's behaviour.
- No prep refactor needed.

**Layer-fit:** AC1, AC2 and AC4 are pure functions of file content and call sequence — unit
tests against `InMemoryFileSystem`, driving `buildDiagnosticService` directly. AC3 needs the
real move path (physical rename plus importer rewrite), so it is one scenario in
`moveFile.scenarios.yaml`.

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
- [ ] Given `move-file` moves `a.ts` → `b.ts` while another file still imports `a.ts`, the
      post-write check reports the unresolved module rather than resolving `a.ts` from a
      retained parse. *(scenario, `moveFile.scenarios.yaml`)*
- [ ] Given `invalidateProject` is called for a tsconfig, the next check re-reads **every** file
      through the `FileSystem` port. *(unit, counting `FileSystem` wrapper)*

**Type matrix.** The diagnostic service serves the ts-morph path only, so `.ts`/`.tsx` are the
input types. `.vue` is out of scope with a reason rather than a case: SFCs are answered by
`VolarEngine`, whose own `refreshFile` (`src/plugins/vue/engine.ts:95`) shares no code with
`diagnostic-service.ts`.

The second criterion is what makes the caching claim falsifiable. An implementation that keeps
dropping everything satisfies the first, third and fourth and fails only that one.

## Structural criteria

- (none — the cache's new ownership is the mechanism of the criteria above, not a separate deliverable)

## Interface

No public surface change: no new CLI action, socket handler, parameter, or error code. The
change is behind `Engine`, whose `refreshFile(path: string): void` signature is unchanged.

Two internal seams move:

- The parse cache becomes a per-tsconfig `Map<string, ts.SourceFile>` owned alongside
  `DiagnosticServiceCache` rather than captured in `buildCompilerHost`'s closure. Contents:
  one entry per source file the compiler has asked for, keyed by absolute path. Bounds: the
  project's file count — 753 here, ~130 MB. Empty case: a cold cache, which is exactly today's
  behaviour on every check. Adversarial case: a workspace large enough that retention matters,
  which is the resident-memory tradeoff recorded under Open decisions.
- `buildDiagnosticService` takes that cache instead of creating one. It already accepts an
  injectable `fs: FileSystem`, so no new parameter is needed to make the criteria testable.

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
  takes the cache with it, so structural changes on disk are already covered. The exposure is an
  edit that produces no watcher event and no weaver write.
- `refreshFile` must keep refreshing the ts-morph source file as it does now
  (`engine.ts:272-273`); this change only alters what happens to the diagnostic half after it.
- One write must still cost at most one program rebuild. `post-write-diagnostics.ts` refreshes
  every file before querying any, and that ordering is what guarantees it — it must not be
  interleaved.

## Done-when

- [ ] All four criteria above verified by tests — three unit, one scenario
- [ ] A post-write check on this repository is measurably faster than the recorded 747–831 ms
      baseline, observed on the real CLI path rather than in a test
- [ ] `move-file` calls the eviction signal for the source path, and the scenario in the third
      criterion fails without it
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
