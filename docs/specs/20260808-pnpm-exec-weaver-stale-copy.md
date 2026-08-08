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

*Left blank deliberately — the fix has architectural forks and is routed to
`/spec`. See the handoff entry, re-tagged `[needs design]`.*

The forks the design pass must settle:

1. **Packaging (mechanism A).** `link:.` instead of `file:.` (symlink, always
   current — but diverges from how the published package installs, so it stops
   exercising the real `files` allowlist); a `postbuild` hook that reinstalls
   the copy (keeps pack fidelity, slows every build, risks install recursion);
   or leave packaging alone and change `CLAUDE.md`'s *Dogfood the CLI* rule to
   invoke `dist/` directly (cheapest, but relies on every agent remembering).
2. **Daemon identity (mechanism B).** Whether daemon reuse should be keyed on
   something that actually varies per build — build hash, `dist/` mtime, or the
   daemon's own resolved entry path — rather than a hand-bumped
   `PROTOCOL_VERSION`. Note that whichever option (1) takes, a fix that leaves
   the daemon gate untouched still allows a stale daemon from a previous
   session to serve current requests.

Adjacent inputs the fix should be checked against: a stale daemon left running
from an *earlier commit of the repo itself* (not the packed copy) — same
`PROTOCOL_VERSION`, same staleness; and a workspace where `dist/` has been
removed but the copy still exists.

## Security

- **Workspace boundary:** N/A — no change to how files are read or written;
  the bug is in which build of the CLI executes, not in path handling.
- **Sensitive file exposure:** N/A — no code path that reads file content is
  involved.
- **Input injection:** N/A — no change to how user-supplied strings are
  handled.
- **Response leakage:** N/A for the bug itself. Flag for the design pass: if
  the fix surfaces a build hash or resolved binary path in a daemon-mismatch
  error, that message is agent-visible and should carry a path relative to the
  workspace, consistent with the logger's workspace-prefix stripping.

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

- [ ] Reproduction case now produces expected output
- [ ] Regression test covers the exact failing case
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (`docs/commands/<name>.md` for user-facing, `docs/internals/<name>.md` for implementation)
- [ ] `CLAUDE.md`'s *Dogfood the CLI* rule updated to match whatever the fix decides
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
