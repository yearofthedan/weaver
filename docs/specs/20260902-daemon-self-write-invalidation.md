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

- [ ] Given the daemon runs a write operation, then the watcher reports the resulting `change`,
      `add` and `unlink` events, `invalidateFile` and `invalidateAll` are not called for any path
      the operation wrote. Observed at the registry: the counts stay at zero across the whole
      event burst.
- [ ] Given a `.ts` file edited by something other than the daemon, a `change` event for it still
      calls `invalidateFile`, and the next query reflects the new content. Same for a `.vue` file
      — the watcher covers `VUE_EXTENSIONS` and `invalidateAll` drops both engines, so neither
      extension may be suppressed by extension alone.
- [ ] Given the daemon wrote a file and an external editor then writes it again before the
      watcher event arrives, the event is *not* suppressed: the file's `mtimeMs` no longer matches
      the recorded stamp, so `invalidateFile` runs and the external content is picked up.
- [ ] Given the daemon deleted a file (a move's source path), the `unlink` event for it does not
      call `invalidateAll`; given a file deleted externally, the `unlink` event does.

Type matrix: `.ts` and `.vue` as inputs, across all three event types (`change`, `add`, `unlink`),
against both callbacks (`invalidateFile` for change, `invalidateAll` for add/unlink).

## Structural criteria

- [ ] `src/ts-engine/move-directory.ts` contains no `node:fs` import.
- [ ] `src/daemon/dispatcher.ts` contains no `new NodeFileSystem()`.

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

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `/review-changes` run over the whole change and its findings applied — a green `pnpm check` does not stand in for it
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`. If implementation pushes a file past threshold, extract per the test refactoring hierarchy (push down to units → decompose source) before marking this item done.
- [ ] The latency claim is re-measured on a real Vue workspace through the real daemon: warm
      baseline, then the two queries following a write, before and after the change. Record the
      numbers in the Outcome.
- [ ] Docs updated if public surface changed:
      - `docs/internals/watcher.md` — owns the invalidation strategy, so it owns this. Three things
        are wrong there once this ships: the Problem section frames the watcher as detecting
        "out-of-band file changes" when the defect is that it cannot tell those from the daemon's
        own; the event-flow diagram and the invalidation-strategy table describe every event
        reaching a callback; and the table's last row claims a Volar "service rebuild is fast",
        measured here at 330–490ms on a real project. Add how a self-write is recognised, and why
        mtime rather than a time window (a later reader will not infer that).
      - `docs/internals/daemon.md:68` — one line, currently pointing at watcher.md for the full
        invalidation strategy. Check it still reads correctly.
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
