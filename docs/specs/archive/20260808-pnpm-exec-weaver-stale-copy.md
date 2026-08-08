# `pnpm exec weaver` runs a stale copy, not the local build

**type:** bug
**date:** 2026-08-08
**tracks:** handoff.md # `pnpm exec weaver` runs a stale copy, not the local build

---

## Symptom

`pnpm exec weaver <command>` executes a packed snapshot of the repo, not the
current `dist/`. Code shipped in this working tree is invisible to it, so any
change "verified" through `pnpm exec weaver` is verified against old code.

`CLAUDE.md`'s *Dogfood the CLI* rule tells agents to use `pnpm exec weaver`, so
every dogfooding session has been exercising a snapshot rather than the build
under test.

```
input:    pnpm exec weaver search-text '{"pattern":"ZZQX_SENTINEL_NOT_PRESENT","excludeGlob":"[abc]**"}'
actual:   {"status":"success","matches":[],"truncated":false}
expected: {"status":"error","error":"INVALID_GLOB","message":"Unsupported glob syntax: \"[abc]**\" ..."}
```

The invalid `excludeGlob` is silently dropped because the snapshot predates the
parameter — Zod strips the unknown key and the call succeeds.

## Value / Effort

- **Value:** High, and it is a correctness-of-verification bug rather than a
  runtime one. It produces *false green*: an agent runs the documented
  dogfooding command, sees success, and reports a feature working that is not
  in the binary it ran. The workaround (`node dist/adapters/cli/cli.js`) is
  cheap but only works if you already know the trap exists — and, per Root
  cause B below, is not sufficient on its own.
- **Effort:** Root cause is confirmed and the mechanism is fully understood.
  The fix is not mechanical: there are several viable approaches with different
  blast radius (packaging change, build hook, documentation change, daemon
  identity change), and the daemon half needs a design call. Routed to `/spec`.

## Expected

```
input:    pnpm exec weaver search-text '{"pattern":"...","excludeGlob":"[abc]**"}'
          (immediately after `pnpm build`, with no `pnpm install`)
expected: {"status":"error","error":"INVALID_GLOB","message":"Unsupported glob syntax: ..."}
```

`pnpm exec weaver` must execute the code currently in `dist/`. A build is the
only step that should be required to make a source change observable through
the dogfooding command.

## Root cause

Two independent mechanisms, both confirmed by observation. Either one alone
produces a stale result; the report in `handoff.md` described only the first.

### A — the self-dependency is a packed copy that only `pnpm install` refreshes

`package.json:86` declares `"@yearofthedan/weaver": "file:."`. pnpm resolves
`file:` to a **packed hard copy**, not a symlink:

```
node_modules/@yearofthedan/weaver
  -> ../.pnpm/@yearofthedan+weaver@file+/node_modules/@yearofthedan/weaver   (real directory)
```

The lockfile records it with no version and no content hash
(`pnpm-lock.yaml:828-829`: `'@yearofthedan/weaver@file:'` /
`resolution: {directory: '', type: directory}`), so pnpm has nothing to detect
a source change by and treats the dependency as satisfied on every install.

`pnpm build` is `rm -rf dist && tsc` (`package.json:43`) — it writes the repo's
`dist/` and never touches the copy. Observed directly with a sentinel appended
to `src/adapters/cli/cli.ts`, then `pnpm build`:

| | occurrences of `ZZQX_STALE_PROBE_SENTINEL` |
|---|---|
| `dist/adapters/cli/cli.js` | 1 |
| `node_modules/@yearofthedan/weaver/dist/adapters/cli/cli.js` | 0 |

The copy refreshes **only** on `pnpm install`. Observed on the `excludeGlob`
parameter: occurrences in the copy's `dist/` went `0` → `29` across a single
`pnpm install` (which reported `Packages: +1`), with no source change between.

Two traps worth recording:

- **Directory mtime is not a staleness signal.** The `handoff.md` report said
  the copy was "dated 20 Jul 2026". At investigation time the copy's directory
  and `package.json` were dated 7 Aug 19:07 while its contents were still
  pre-`excludeGlob`. Timestamps on the copy tracked unrelated dependency
  activity, not its own content.
- **`version` does not disambiguate.** Repo and copy both report `0.1.8`;
  the version is only bumped at release, so it is constant across the many
  builds within a session.

### B — the stale CLI spawns a stale daemon, and the version gate cannot see it

This is the compounding half, and it falsifies the report's claim that
"running `node dist/adapters/cli/cli.js` directly showed correct behaviour on
every case". That holds only when no daemon is already running.

`pnpm exec weaver` auto-spawns the daemon from **its own** location. Confirmed
from the running process's argv:

```
node /Users/dan/Projects/weaver/node_modules/.pnpm/@yearofthedan+weaver@file+/
     node_modules/@yearofthedan/weaver/dist/adapters/cli/cli.js daemon --workspace ...
```

`ensureDaemon` decides whether to reuse a live daemon by comparing its `ping`
response against `PROTOCOL_VERSION` (`src/daemon/ensure-daemon.ts:43`), and
`PROTOCOL_VERSION` is a hand-bumped constant fixed at `1`
(`src/daemon/daemon.ts:23`). A daemon built from any older commit still answers
`1`, so the mismatch branch never fires and the stale daemon is reused.

The consequence, observed in sequence:

| step | command | result |
|---|---|---|
| 1 | `pnpm exec weaver search-text …` (spawns stale daemon) | `{"status":"success"}` — wrong |
| 2 | `node dist/adapters/cli/cli.js search-text …` (stale daemon still up) | `{"status":"success"}` — **wrong** |
| 3 | `node dist/adapters/cli/cli.js stop`, then re-run step 2 | `{"status":"error","error":"INVALID_GLOB"}` — correct |

So the documented workaround silently inherits the stale result if a stale
daemon is live. The comment above `PROTOCOL_VERSION` claims "stale daemons are
never silently reused", which is exactly what happens here.

## Fix

Two changes. Both are required — the mechanisms were shown to bite
independently, so either alone leaves a stale-artifact path open.

### 1. Packaging: `file:.` → `link:.`

Change the self-dependency in `package.json` devDependencies. pnpm resolves
`link:` to a symlink at the repo root, so `node_modules/.bin/weaver` runs the
live `dist/`.

Verified in the working tree: after a rebuild with no `pnpm install`,
`pnpm exec weaver` served the new code, the daemon spawned from
`/Users/dan/Projects/weaver/dist/adapters/cli/cli.js` rather than the packed
copy, and `pnpm install --frozen-lockfile` succeeded.

The packed copy was the only thing exercising the `files` allowlist. Nothing
consumed it, so no working check is lost, but a wrong `files` entry would still
reach a publish undetected. That gap predates this change.

### 2. Daemon reuse: build fingerprint replaces `PROTOCOL_VERSION`

In `daemon.ts`, stat the daemon's own entry at startup and record `mtimeMs`.
Return it from `ping` as `buildId`. Delete the `PROTOCOL_VERSION` constant.

In `ensure-daemon.ts`, stat the CLI's own entry and compare against the
daemon's `buildId`, reusing the existing stop-and-respawn branch at lines
43–47 on mismatch. Rename `versionVerified` for what it now caches.

Use mtime, not a content hash. `pnpm build` is `rm -rf dist && tsc`, so every
build recreates every file and moves every mtime. Hashing the entry file would
miss a change confined to a non-entry module, because `cli.js` stays
byte-identical when only `globs.ts` changes. The comparison is for equality,
never for "newer", so clock skew and timezone are irrelevant.

The failure modes are asymmetric in the same direction: a false positive costs
one daemon restart, a false negative is this bug.

A stat failure on one side only is a mismatch. Both sides failing is a match —
corrected during implementation, see Outcome.

This also covers the published-package case that `PROTOCOL_VERSION` was meant
to handle. A reinstall or upgrade rewrites `dist/`, which moves the mtime,
which forces the respawn — with no constant to remember to bump.

Known and accepted: two separate weaver installs pointed at one workspace have
different mtimes for identical code, so they would restart each other's daemon
on alternating calls.

### 3. Documentation

Update `CLAUDE.md`'s *Dogfood the CLI* rule, since `pnpm exec weaver` becomes
correct again, and record the stale-daemon symptom. Update
`docs/internals/daemon.md` for the changed `ping` contract.

### Adjacent inputs

A daemon left running from an earlier commit of the repo itself, which has the
same shape as the packed-copy case once packaging is fixed.

## Security

- **Workspace boundary:** N/A — no change to how files are read or written;
  the bug is in which build of the CLI executes, not in path handling.
- **Sensitive file exposure:** N/A — no code path that reads file content is
  involved.
- **Input injection:** N/A — no change to how user-supplied strings are
  handled.
- **Response leakage:** No. `ping` gains a `buildId` field carrying an mtime in
  milliseconds — a number, not a path. Keep it that way: do not put the
  resolved entry path in the ping response or in a mismatch error, since both
  are agent-visible and the path is absolute.

## Edges

- Any operation with a parameter added since the copy was last packed shows the
  same silent-drop behaviour, not just `excludeGlob` — Zod strips unknown keys,
  so new parameters fail open as "success" rather than erroring.
- Removed or renamed operations behave the opposite way: the copy still offers
  a subcommand the current build has dropped.
- `pnpm check` runs `pnpm build`, so a fully green `pnpm check` still leaves the
  copy stale. Green checks are not evidence the dogfooding path is current.
- Regression risk in the happy path: if the fix reinstalls on every build, the
  build gets slower and `prepare`/`prepublishOnly` hooks may re-enter.

## Done-when

- [x] Reproduction case now produces expected output
- [x] Regression test covers the exact failing case, and drives the built
      `dist/` rather than `src/` via tsx — the built artifact is what goes
      stale, and no current test executes it
      (`src/__testHelpers__/process-helpers.ts:8-9`)
- [x] End-to-end case: start a daemon, rebuild, assert the next call is served
      by a new daemon. Replaces `protocol-version.integration.test.ts`, whose
      only assertion is that `PROTOCOL_VERSION` is a positive integer
- [x] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated if public surface changed (`docs/commands/<name>.md` for user-facing, `docs/internals/<name>.md` for implementation)
- [x] `CLAUDE.md`'s *Dogfood the CLI* rule updated to match whatever the fix decides
- [x] Tech debt discovered during investigation added to handoff.md as [needs design]
- [x] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Shipped:** `link:.` replaces `file:.`; `ping` returns `buildId` (entry mtime)
and `ensureDaemon` respawns on mismatch; `PROTOCOL_VERSION` deleted.

### Verification

Driven on the real path — `pnpm exec weaver`, both mechanisms, no `pnpm install`
between steps:

| Step | Action | `pnpm exec weaver` returned |
|---|---|---|
| 1 | baseline, spawns daemon | `Unsupported glob syntax: "[abc]**"` |
| 2 | edit source, `pnpm build`, daemon left running | `ZZQX_VERIFY_ONE glob syntax: ...` |
| 3 | edit again, `pnpm build`, daemon from step 2 still up | `ZZQX_VERIFY_TWO glob syntax: ...` |

Before the fix, step 2 returned the step-1 message (stale packed copy) and step
3 returned the step-2 message (stale daemon). Each step picking up its own build
is the fix working end to end.

The regression tests were also confirmed to fail against the old behaviour:
with `isSameBuild` forced to return `true` — simulating `PROTOCOL_VERSION`
always matching — both respawn tests failed on identical PIDs while the two
control tests still passed.

### Corrections to the spec

**Both stats failing is a match, not a mismatch.** The spec said "if either
stat fails, treat it as a mismatch". That broke `operations.test.ts` under
Stryker, whose sandbox ignores `dist`: both sides read null, the mismatch
forced a respawn, and the respawn ran an entry that does not exist there.

The corrected rule is plain equality. Two nulls mean neither side is running a
build, so there is nothing to be stale against. This cannot weaken the shipped
path: `CLI_ENTRY` resolves to exactly the `bin` field, so in an install that
file *is* the running process and null is unreachable.

**`isSameBuild` reduced to `daemonBuildId === localBuildId`.** Mutation testing
flagged both branches of the original `typeof` guard as surviving. They were
redundant — `===` is already type-strict, so the guard could never change an
answer.

### Known limitation

A source-driven daemon is not fingerprinted. Start a daemon from `src` via tsx,
edit source, run the CLI from `src` again: both sides read null, the daemon is
reused, and it serves the older code. This predates the change —
`PROTOCOL_VERSION` matched unconditionally — and is out of scope here, which
concerns the built artifact. Closing it needs a different fingerprint, the
daemon's own loaded modules rather than the dist entry.

### Numbers

- **Tests added:** 12 net (1109 → 1121). New: `build-id.test.ts` (10, one
  parameterised block), `build-id.integration.test.ts` (4), one caching test in
  `ensure-daemon.test.ts`. Removed: `protocol-version.integration.test.ts`.
- **Mutation:** `build-id.ts` 100% (7 killed, 0 survived). `ensure-daemon.ts`
  73.7% before triage; the two survivors in changed code were fixed — one dead
  assignment removed, one caching gap covered by a test verified to fail
  without it. Remaining survivors are in `spawnDaemon`'s subprocess plumbing,
  untouched here.

### Reflection

**What went well.** Reproducing before designing paid for itself. The
investigation turned up a second mechanism the original report missed, and the
report's stated workaround — run `dist/` directly — was falsified by a
three-step experiment. Had the fix gone straight at packaging, the daemon half
would have shipped broken.

**What did not.** The `dist`-deleted case was reasoned about rather than tested,
and the reasoning was wrong; the test suite caught it, which is the cheap place
to be caught but is still a design error that a five-minute experiment would
have prevented. Mutation testing then found redundant branches in the same
function, so that function was over-thought twice.

**For the next agent.** Do not trust `pnpm check` as evidence that a CLI change
works — every integration test drives `src/` through tsx, so a green suite says
nothing about the built artifact. `runBuiltCliCommand` in `process-helpers.ts`
now exists for that; use it when the behaviour under test depends on `dist`.
Stryker's sandbox ignores `dist` entirely (`stryker.config.mjs` `ignorePatterns`),
so any code that stats the built entry must tolerate its absence.
