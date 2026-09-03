# The daemon invalidates its compilers in response to its own writes

**type:** change
**date:** 2026-09-02
**tracks:** handoff.md # the-watcher-drops-the-whole-volar-service-once-per-changed-file → docs/internals/daemon.md

---

## Context

The daemon watches the workspace so an external edit — someone saving in their editor — is
reflected in the next answer. It cannot tell those edits apart from the ones it makes itself, so
every write operation it performs comes back to it as watcher events and drops the compilers it
just used. The next one or two requests then rebuild the whole project from cold.

## User intent

*As a developer refactoring through weaver, I want a query straight after a refactor to answer as
fast as one straight after another query, so that a sequence of operations doesn't get slower for
no reason I can see.*

## Relevant files

- `src/daemon/daemon.ts:219` — `startWatcher` wiring; the three callbacks that must consult the
  ledger. Also holds `defaultFs` (line 33), the existing precedent for one shared `FileSystem`.
- `src/daemon/watcher.ts` — chokidar wrapper, per-path 200ms debounce. Unchanged by this work;
  read it to see why the add and unlink waves never merge (they are different paths, so they get
  independent timers).
- `src/daemon/language-plugin-registry.ts:72` — `invalidateFile` and `invalidateAll`, the two
  callbacks whose cost this change avoids. `invalidateAll` clears the ts-morph singleton *and*
  every plugin compiler.
- `src/daemon/dispatcher.ts` — constructs `new NodeFileSystem()` at ~20 sites; AC2 replaces them
  with one shared accessor.
- `src/ports/filesystem.ts` — the `FileSystem` port. `stat` currently returns only
  `{ isDirectory() }` and gains `mtimeMs`.
- `src/ports/node-filesystem.ts:45`, `src/ports/in-memory-filesystem.ts:65` — the two adapters.
  The in-memory one stores content only, so it needs a per-path stamp of its own.
- `src/ports/__testHelpers__/filesystem-conformance.ts:119` — the shared conformance suite; the
  `mtimeMs` contract is pinned here once for both adapters.
- `src/ts-engine/move-directory.ts:56` — `fs.mkdirSync` / `fs.renameSync`, the only workspace
  write that bypasses the port.

### Red flags

- `src/ts-engine/move-directory.ts` writes through `node:fs` directly, against the port rule in
  `docs/design-principles.md`. AC1 fixes it because nothing at the port level can otherwise
  observe a directory move — the largest source of self-inflicted events.
- `src/daemon/dispatcher.ts` (405 lines) repeats `new NodeFileSystem()` at ~20 sites. AC2 removes
  the duplication rather than adding a 21st.
- No test hotspot. `dispatcher.test.ts` (458 lines) is the largest file in the area but AC2 changes
  only how the filesystem is obtained, and AC3–AC4 add tests in new files.

**Layer-fit:** AC1 and AC2 are refactors covered by the existing suites. AC2's ledger and
AC3's recorder are pure functions of their inputs — unit-test them against `InMemoryFileSystem`
with an injected clock, no daemon. AC4 is the only wiring path and takes one integration smoke
per event type.

## Value / Effort

- **Value:** A refactor followed by a type check is the ordinary way weaver gets used, and today
  the check pays a full cold project build — measured at 1431ms and 1375ms against a 250ms warm
  baseline on a real 170-file Vue app, so about 2.3s per write operation. An agent chaining
  operations pays this on every step. The rebuild buys nothing: the operation has already updated
  the compilers with the content it wrote, and this was verified by running with watcher
  invalidation disabled entirely (see Edges).
- **Effort:** Four ACs across the daemon and the ports. One new concept (the ledger), one additive
  port field, one mechanical migration. No new infrastructure — the watcher, the debounce and the
  invalidation callbacks are all unchanged.

## Behaviour

- [x] Given the daemon runs a write operation, then the watcher reports the resulting `change`,
      `add` and `unlink` events, `invalidateFile` and `invalidateAll` are not called for any path
      the operation wrote. Observed at the registry: the counts stay at zero across the whole
      event burst.
- [x] Given a `.ts` file edited by something other than the daemon, a `change` event for it still
      calls `invalidateFile`, and the next query reflects the new content. Same for a `.vue` file
      — the watcher covers `VUE_EXTENSIONS` and `invalidateAll` drops both engines, so neither
      extension may be suppressed by extension alone.
- [x] Given the daemon wrote a file and an external editor then writes it again before the
      watcher event arrives, the event is *not* suppressed: the file's `mtimeMs` no longer matches
      the recorded stamp, so `invalidateFile` runs and the external content is picked up.
- [x] Given the daemon deleted a file (a move's source path), the `unlink` event for it does not
      call `invalidateAll`; given a file deleted externally, the `unlink` event does.

Type matrix: `.ts` and `.vue` as inputs, across all three event types (`change`, `add`, `unlink`),
against both callbacks (`invalidateFile` for change, `invalidateAll` for add/unlink).

## Structural criteria

- [x] `src/ts-engine/move-directory.ts` contains no `node:fs` import.
- [x] `src/daemon/dispatcher.ts` contains no `new NodeFileSystem()`.

## Interface

No CLI or socket surface changes. Two internal surfaces move.

`FileSystem.stat` gains a field:

```ts
stat(path: string): { isDirectory(): boolean; mtimeMs: number };
```

- **Contains:** milliseconds since the epoch for the file's last content modification, e.g.
  `1788368477901.24`. `NodeFileSystem` returns `statSync().mtimeMs` unchanged, so it carries the
  platform's sub-millisecond precision. `InMemoryFileSystem` has no clock, so it returns a
  monotonically increasing counter bumped on every `writeFile`, `rename` and `unlink` — ordering
  is the only property tests depend on.
- **Bounds:** a positive finite number. On a filesystem with coarse timestamps two writes inside
  one tick can produce equal values; that makes suppression slightly more eager, never less, so it
  cannot cause a stale answer to be served from an external edit that changed the file's size or
  content across a tick boundary.
- **Zero/empty:** not applicable — `stat` already throws for a missing path and keeps doing so.
- **Adversarial:** a path replaced by a symlink between the write and the event. `stat` follows
  symlinks, so the comparison reads the target; a mismatch falls through to invalidating, which is
  the safe direction.

The ledger, `src/daemon/self-write-ledger.ts`:

```ts
export interface SelfWriteLedger {
  recordWrite(path: string): void;
  recordRemoval(path: string): void;
  /** True when this event is the daemon's own write and should not invalidate. */
  shouldSuppress(path: string): boolean;
}
```

- **Contains:** absolute workspace paths mapped to the `mtimeMs` observed straight after the
  daemon wrote them, or a removal marker.
- **Bounds:** one entry per path per operation. A `move-directory` over a large tree is the
  realistic maximum; `filesModified` on the measured app was 22, and a 10× input is a few hundred
  entries of a path string and a number. `shouldSuppress` deletes the entry it matches, so the
  map drains as the events arrive; entries for events that never arrive are capped by size, oldest
  evicted first.
- **Directory renames must be recorded per file, not per directory.** `move-directory` calls
  `rename` once on the directory, but the watcher reports one `unlink` per child at the old path
  and one `add` per child at the new one — it never reports the directory itself. A ledger holding
  only the two directory paths would therefore suppress nothing on the operation with the largest
  burst. The recorder expands a directory rename into its files: a removal per old child path and
  a write per new child path. It can enumerate the subtree at the destination after the rename
  (`walkRecursive` from `src/utils/file-walk.ts` already does this over a `FileSystem`) and derive
  each source path by prefix substitution.
- **Zero/empty:** an unknown path returns `false` — never suppress what was not recorded.
- **Adversarial:** concurrent operations. The daemon serialises requests through the socket queue
  (`daemon.ts:199`), so writes from two operations cannot interleave.

## Open decisions

**Where self-writes are recorded.** Resolved: a shared `FileSystem` accessor in the dispatcher,
wrapped once in a `RecordingFileSystem` decorator.

The alternative was a write-observer hook inside `NodeFileSystem`, which touches one file instead
of twenty. It was rejected because it puts daemon-specific policy inside a port adapter, which
`docs/design-principles.md` rules against, and because it would fire for every `NodeFileSystem`
in the process including the CLI's. The decorator keeps the port a port. The consequence is AC2 —
a mechanical migration of ~20 call sites — and the thing to watch is a future write path that
constructs its own `NodeFileSystem` instead of taking the shared one, which would be invisible to
the ledger; the structural criterion on `dispatcher.ts` guards the current sites.

**How an event is recognised as the daemon's own.** Resolved: per-path `mtimeMs` stamp, compared
when the event arrives.

The alternative was a fixed suppression window after each write. It was rejected because the
window would have to exceed the ~1.2s watcher latency measured here, and any genuine external
edit landing inside it would be dropped silently, leaving a stale compiler serving wrong answers —
trading a latency bug for a correctness one. Comparing mtime instead means a stale ledger entry
cannot swallow a later edit, because that edit moves the file's mtime past the stamp. The
consequence is one `stat` per watcher event, on a path already doing file I/O.

**Writes that bypass the port.** Resolved: migrate them, in this spec.

Found during implementation. `src/ts-engine/move-symbol.ts:135` and
`src/ts-engine/remove-importers.ts:75` persist edits with ts-morph's `sf.save()`, which writes to
disk without going through the `FileSystem` port — so the recorder never sees them and
`move-symbol` and `delete-file` would keep paying the full cold-rebuild cost. That makes the first
acceptance criterion false for two of the seven write operations, which is why this is closed here
rather than deferred.

Both call sites move to `scope.writeFile(fp, sf.getFullText())`, matching
`src/ts-engine/apply-rename-edits.ts:22`, which already persists through the port. The text written
is identical. The consequence to watch is that ts-morph still marks those files dirty afterwards,
since nothing clears its internal saved flag; `isSaved()` has exactly one reader in the codebase —
the loop guard in `remove-importers.ts:74` — and each source file is visited once per pass, so the
flag going stale changes nothing today. A second reader of `isSaved()` would need to account for it.

The alternative considered and rejected as too large for this spec: backing the ts-morph `Project`
with a `FileSystemHost` derived from the port, so `save()` routes through the recorder by
construction and no call site needs migrating. Nothing constructs a `Project` with a custom host
today. That remains the cleaner end state if a third bypass ever appears.

## Security

- **Workspace boundary:** No new paths are written. The ledger only records paths the operations
  already wrote, all of which passed `WorkspaceScope.contains` in the dispatcher before the write.
  Suppression can only *skip* work, never widen what is reachable.
- **Sensitive file exposure:** N/A — the ledger stores a path and a number, never file content,
  and `stat` reads metadata only.
- **Input injection:** N/A — no new string parameter reaches the filesystem. Ledger keys come from
  paths the daemon itself produced, not from request input.
- **Response leakage:** N/A — the ledger is never serialised into a response, and this change adds
  no error messages.

## Edges

- An external edit must never be suppressed. Verified during the spike by running with watcher
  invalidation disabled: post-move diagnostics were identical to the control (297 → 300 errors in
  both arms) and a second operation in the same daemon session — a rename across the moved layout
  — modified the identical 6 files in both arms. That establishes the operation already leaves the
  engines correct; this change must not regress it.
- Do not widen or lengthen the watcher's debounce. It is per-path and 200ms, and the add and
  unlink waves are ~1.2s apart, so a debounce able to merge them would delay genuine external
  edits by the same amount.
- Do not add a per-file refresh to `VolarEngine` as part of this. The `change` path it would
  optimise was measured at 13 of 14 calls hitting an already-empty cache, so the work has no
  payoff. `refreshFile`'s existing comment about rebuilding whole projects stays accurate.
- `move-file` and `move-directory` report a source path in `filesModified` that no longer exists
  (separate handoff entry). The ledger is fed by the recorder, not by result fields, so it is
  unaffected — do not switch it to reading `filesModified`.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [x] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`. If implementation pushes a file past threshold, extract per the test refactoring hierarchy (push down to units → decompose source) before marking this item done.
- [x] The latency claim is re-measured on a real Vue workspace through the real daemon: warm
      baseline, then the two queries following a write, before and after the change. Record the
      numbers in the Outcome.
- [x] Docs updated if public surface changed:
      - `docs/internals/watcher.md` — owns the invalidation strategy, so it owns this. Three things
        are wrong there once this ships: the Problem section frames the watcher as detecting
        "out-of-band file changes" when the defect is that it cannot tell those from the daemon's
        own; the event-flow diagram and the invalidation-strategy table describe every event
        reaching a callback; and the table's last row claims a Volar "service rebuild is fast",
        measured here at 330–490ms on a real project. Add how a self-write is recognised, and why
        mtime rather than a time window (a later reader will not infer that).
      - `docs/internals/daemon.md:68` — one line, currently pointing at watcher.md for the full
        invalidation strategy. Check it still reads correctly.
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

Shipped 2026-09-03 across 17 commits (`895fff3`..`7bc530e`).

### Verification

Driven through the real daemon and real watcher against a `cp -Rc` clone of a real Vue app
(29 SFCs, 141 TS files, its own `node_modules`, type-clean under `vue-tsc`). The app's root
tsconfig is solution-style, which disables the Vue plugin entirely — a separate known defect — so
the clone gets a flattened `tsconfig.json` to make the plugin engage. The same
`get-type-errors` on `App.vue` throughout; the write is one `move-file`.

The baseline arm was built from `7e1c955` in its own worktree and confirmed not to contain the
suppression code, then the two arms were run alternately on fresh clones to control for machine
drift.

| | Before | After |
|---|---|---|
| Warm | ~275ms | ~264ms |
| 1st query after a write | 1515 / 1676 / 1600ms | 596 / 639 / 637ms |
| 2nd query after a write | 1419 / 273 / 1520ms | 273 / 259 / 259ms |

Re-confirmed against the final build after the review and mutation work: warm 249/243ms,
post-write 595ms then 247/245ms.

The second cold rebuild is gone entirely. The ~620ms that remains on the first query is the
operation's own invalidation doing real work — the file moved, so the project graph genuinely
changed. Honest figure: **~1.0s saved per write reliably, ~2.2s when the timing was unlucky
before.** The baseline was variable — in one rep of three only one query was cold, which fits the
two-wave shape: whether you pay once or twice depends on where your queries land relative to the
`unlink` and `add` waves.

### Tests and mutation

78 tests added net (1283 → 1361).

| File | Score | Survivors |
|---|---|---|
| `daemon/recording-filesystem.ts` | 100% | 0 |
| `daemon/self-write-state.ts` | 100% | 0 |
| `ts-engine/persist-source-file.ts` | 100% | 0 |
| `ports/in-memory-filesystem.ts` | 97.4% | 3 |
| `daemon/self-write-ledger.ts` | 90.7% | 4 |
| `ts-engine/move-directory.ts` | 75.8% | 8 |

Three survivors were real and are now covered: dropping the subtree prefix filter let a directory
rename move every key in the store; dropping the stamp on a carried file left it reporting mtime 0,
which matters precisely because the ledger compares mtimes; dropping the ledger's re-insert stopped
eviction tracking recency. Two more were dead code — the marker write after the rename loop is
unreachable, since a marker is itself a key under the prefix and an inferred directory needs none.

The rest are noise with reasons: `mtimes.delete` for a path that no longer exists (stat throws, so
a stale entry is unobservable, but the delete still bounds the map); `catch { return }` → `catch {}`
in both ledger branches (observably identical — one records an undefined stamp that never matches,
the other compares against undefined and returns false anyway); the `oldest !== undefined` guard
(the map is non-empty whenever size exceeds the cap; the check exists only because
`.keys().next().value` is typed `string | undefined`); and `move-directory`'s extension filter,
verified by probe — ts-morph accepts `.json` and `.css` without throwing, so filtering changes
nothing observable. Seven of `move-directory`'s eight are on lines this change never touched.

### What the measurement changed about the design

**The handoff entry's premise was wrong, and the spec exists because that was checked first.** The
entry attributed the cost to `VolarEngine` lacking a per-file refresh, with N changed files causing
N service builds, and proposed either a per-file refresh or coalescing the burst. Measured, one
`move-directory` produced 14 `change`, 8 `unlink` and 8 `add` events and cost **two** extra service
builds — 13 of the 14 `invalidateService` calls hit an already-empty cache. Invalidation is a
`Map.delete` and the rebuild is lazy, so a burst coalesces for free. The entry's own 8-builds figure
came from the post-write diagnostics path, which interleaved refresh and query and had already been
fixed.

Both proposed fixes were therefore aimed at the wrong path. A per-file Volar refresh would have
optimised the `change` path, which costs almost nothing; a debounce wide enough to merge the `add`
and `unlink` waves would have had to exceed 1.2s and would delay genuine external edits by the same
amount.

**Suppression was checked for safety before it was designed.** Running with watcher invalidation
disabled entirely produced diagnostics identical to the control (297 → 300 in both arms), and a
second operation in the same daemon session — a rename across the moved layout — modified the
identical 6 files in both arms. That established the operation already leaves the engines correct,
which is the premise the whole design rests on.

**Two things the spec got wrong and the work corrected.** The Interface section asserted `stat`
already threw for a missing path; `InMemoryFileSystem` did not, and was fixed to match. The
singleton was justified by citing `daemon.ts`'s `defaultFs` as precedent without reading it —
`defaultFs` is an overridable default *parameter*, so callers can still substitute
`InMemoryFileSystem`, and the new module had no such seam until review caught it.

### Reflection

**What went well.** Measuring before writing the spec. The entry was specific, confident and
carried a number, which is exactly the shape that gets designed against rather than checked; one
probe against the real daemon disproved it in a few minutes and redirected the whole change. The
four-lens review earned its cost three times over — it found a pre-existing BOM defect, a layering
weakness in a module I had specified, and a coverage gap that made the first acceptance criterion
unverified at the layer it describes.

**What did not go well.** Three failures were mine and all are already-written rules I did not
follow: I cited `defaultFs` as precedent without opening it, bundled unrelated review fixes into a
commit with `git add -A`, and wrote changelog content — dated clauses, before/after timings — into
living docs. The last needed the user to catch it.

**What took longer than it should have.** Building a trustworthy reproduction. The obvious
candidate app has a solution-style root tsconfig, so the Vue plugin never engages there; the first
synthetic workspace symlinked `node_modules` and had degraded type resolution, which produced a
`find-importers` result I nearly reported as staleness caused by the missing invalidation. A
control run with the watcher *enabled* returned the same wrong answer, which is what caught it. Two
probes were spent before the workspace could answer anything.

**For the next agent.** The `.claude/agent-notes/` and `.claude/agent-memory/` paths are not
git-tracked and this repo runs in a container, so anything left there is gone on rebuild — the
harvest step is not optional bookkeeping. Two of this task's most useful findings (ts-morph's BOM
behaviour, the coverage table collapsing two files to one row) reached a durable doc only because
that step ran. Also: `handoff.md` held **two** entries for this one defect in different tiers,
describing it from different angles, which is part of how a wrong causal story survived long enough
to reach a spec. When picking up an entry, grep the queue for the same subsystem before trusting
the framing in front of you.
