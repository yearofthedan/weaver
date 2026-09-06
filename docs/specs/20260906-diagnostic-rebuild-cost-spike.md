# Spike: what the post-write diagnostic rebuild actually costs

**Status:** Findings recorded — reframes the handoff entry; design not yet written
**Date:** 2026-09-06
**Related:** [handoff.md](../handoff.md) Must entry on the diagnostic rebuild,
[`src/ts-engine/diagnostic-service.ts`](../../src/ts-engine/diagnostic-service.ts),
[`src/ts-engine/engine.ts`](../../src/ts-engine/engine.ts),
[`src/daemon/post-write-diagnostics.ts`](../../src/daemon/post-write-diagnostics.ts)

## Question

The handoff entry asserts a cost — "the next check pays a cold `ts.createProgram` over the entire
project" — reasoned from code structure, with no measurement of the whole path. It also names two
things as blocking the fix: the `oldProgram` red, and the missing deletion signal.

Two questions before designing anything: is the cost real and large enough to justify designing an
invalidation contract, and are both named blockers actually in the way?

## Method

Drove the real `TsMorphEngine` against this repository (not a fixture), then replicated the
diagnostic service's host at the same root scale to price the candidate designs. The engine's
diagnostic service is built over 289 roots resolving to 753 source files — larger than the
tsconfig's own 87 roots, because `addWorkspaceFiles` adds the whole workspace before
`loadDiagnosticServiceEntry` reads the file list off the project.

Timings are single-run on one machine, reported as the range over three iterations. They are
order-of-magnitude evidence for a design decision, not a benchmark.

## Results

### The cost is real, and it is ~800 ms on every write

Driving `refreshFile` + `getTypeErrors` on one file through the real engine:

| Path | Per post-write check |
|---|---|
| Today — drop the whole service, re-parse 753 files, rebuild, typecheck | **747–831 ms** |
| Service left warm (stale parse — not a shippable option, shown as the floor) | **<1 ms** |

The comment in `post-write-diagnostics.ts` already limits this to one rebuild per write rather than
one per file, by refreshing every file before querying any of them. So ~800 ms is the cost of a
write, not of a file.

### The parse cache, not `oldProgram`, is where the money is

The host's `ts.SourceFile` cache is constructed inside `buildDiagnosticService`, so dropping the
service drops the parse cache with it. Retaining the host and evicting only the written file's
parse, at the engine's 289-root scale:

| Candidate | Per check | Files re-parsed |
|---|---|---|
| Today: full drop, fresh host | 747–831 ms | 753 |
| **A — evict one parse, keep host, rebuild without `oldProgram`** | **237–305 ms** | 1 |
| B — as A, but pass `oldProgram` | 183–186 ms | 1 |

**This contradicts the entry's framing.** Candidate A captures roughly 70% of the available win
(~800 ms → ~250 ms) and never touches `oldProgram`. Candidate B buys a further ~60 ms — about 7% of
the original path — in exchange for pinning a compiler-internal bug the entry itself records as not
isolated and not reproducible under minimal options.

So `oldProgram` is not a blocker on this work. It is a scope exclusion, and a cheap one: the
existing "`oldProgram` is deliberately NOT passed" comment in `diagnostic-service.ts` can stand
unchanged, and the moveFile scenario it protects stays green.

Note what candidate A does *not* remove: `ts.createProgram` still re-resolves and re-binds all 289
roots on every write. That re-bind is the ~240 ms floor. Getting below it means a version-based
document registry — i.e. `ts.createLanguageService` — which `diagnostic-service.ts` documents as
deliberately rejected, because it disagrees with `tsc` on this codebase. Out of scope; named so the
next agent does not rediscover it.

### The deletion signal is the one genuine blocker

Confirmed from source: `invalidateProject` is called by `delete-file.ts:26`,
`extract-function.ts:59`, `set-export.ts:82` and `move-symbol.ts:151`. `move-file.ts` is absent
from that list. The entry's claim holds.

This is what makes candidate A a design problem rather than a patch. Keeping the host alive across
a refresh keeps every cached parse alive, so a file that has moved away is still served from the
cache — and `moveFile`, the operation most likely to move one, is exactly the operation with no
invalidation call. The eviction contract has to say what a *move* signals, not just what a write
signals.

## What this means for the design

1. Design the invalidation contract — unchanged from the entry, and still the first step.
2. Scope `oldProgram` **out**, on the measurement above, rather than pinning it as the entry
   proposes. Revisit only if the ~240 ms floor turns out to matter.
3. `moveFile` needs a deletion signal regardless of whether the caching lands; it is the gap that
   makes retention unsafe.

## Reflection

The entry's structural claims were all accurate — the code does what it says. What it got wrong was
the *relative weight* of the two blockers it named, and that error pointed the design at the
expensive one. A single afternoon of timing turned "pin an unisolated compiler bug" into "exclude
it", which is the difference between a hard spec and a routine one.

The general lesson is the one CLAUDE.md already states and this confirms with numbers: an entry
that reasons from structure to a cost is a claim to re-measure, and the measurement is usually one
probe.
