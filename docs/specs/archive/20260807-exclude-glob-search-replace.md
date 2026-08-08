# `excludeGlob` for search-text and replace-text

**type:** change
**date:** 2026-08-07
**tracks:** handoff.md # `search-text` / `replace-text` `excludeGlob` parameter → docs/commands/search-text.md, docs/commands/replace-text.md

---

## Context

`search-text` and `replace-text` can narrow which files they touch with `glob`, but there is no way to say "everywhere except here". Surfaced while dogfooding the skills-installer rename: a repo-wide `replace-text` hit `docs/specs/archive/**` and the archived specs had to be reverted by hand. Narrowing the `glob` to dodge the archive would have given up the find-everywhere guarantee that makes the tool worth using over `sed`.

## User intent

*As a developer using weaver, I want to exclude a subtree from a workspace-wide search or replace, so that I can run "change this everywhere" against the whole project without hand-reverting the directories that must not change.*

## Relevant files

- `src/utils/file-walk.ts` — `walkWorkspaceFiles()` is the single enumeration point both operations go through; the exclusion filter belongs here, next to the existing `glob` filter.
- `src/utils/globs.ts` — `compileGlob()` validates and compiles a glob into a `(relPath) => boolean` predicate. Reused as-is for the exclusion; brace expansion and `INVALID_GLOB` come free.
- `src/operations/searchText.ts` — `walkWorkspaceFiles` call at line 48; `opts` gains `excludeGlob`.
- `src/operations/replaceText.ts` — `walkWorkspaceFiles` call at line 70, inside `applyPatternReplace`. Surgical mode does not enumerate and is untouched.
- `src/adapters/schema.ts` — `SearchTextArgsSchema`, `ReplaceTextBaseSchema`; the `.describe()` text is what renders in `--help` and feeds the MCP tool description.
- `src/daemon/dispatcher.ts` — `searchText` (line 187) and `replaceText` (line 214) destructure params explicitly; both need the new key added or it is silently dropped.
- `src/adapters/cli/operations.ts` — `SUBCOMMANDS`; no change needed (`excludeGlob` is not a `pathParam` — it is a workspace-relative glob, not a path to resolve).

### Red flags

- `src/utils/file-walk.test.ts` is 435 lines and has ~15 `walkWorkspaceFiles` call sites that the signature change touches. It is at the length where `docs/code-standards.md` says to ask whether responsibilities are mixed — but they are not: the file tests one module and the call sites are cohesive. No prep split. Do not split it to hit a number.
- `src/operations/searchText.test.ts` (329) and `replaceText.test.ts` (260) both gain cases. Same judgment — cohesive, leave them.

**Layer-fit:** all three ACs are pure functions of their inputs. Test at the unit layer against `InMemoryFileSystem`; the `git ls-files` path is not involved in the filtering logic. No new integration test — the CLI and dispatcher wiring is a straight parameter pass-through, covered by the existing schema round-trip tests.

## Value / Effort

- **Value:** The user runs a project-wide rename and gets the compiler-aware find-everywhere guarantee *and* keeps their archive, vendored code, or generated output untouched — in one call, with no manual revert pass afterwards. Today the choice is between a narrowed `glob` that silently misses real hits and a full-workspace run that hits files that must not change. That is a correctness cliff, not a convenience gap: the hand-revert step is where a real mistake gets left behind.
- **Effort:** Small. One new optional parameter threaded through five files, reusing `compileGlob` end to end. No new concepts, no new error codes, no daemon protocol change. The only non-trivial edit is `walkWorkspaceFiles`'s signature and its test call sites.

## Behaviour

- [ ] **Exclusion removes matches.** `searchText("foo", scope, { excludeGlob: "docs/archive/**" })` against a workspace containing `foo` in both `docs/archive/old.md` and `src/a.ts` returns exactly one match, for `src/a.ts`. *(unit)*
- [ ] **Exclusion wins over inclusion.** `searchText("foo", scope, { glob: "**/*.md", excludeGlob: "docs/archive/**" })` against `foo` in `docs/archive/old.md`, `docs/guide.md`, and `src/a.ts` returns exactly one match, for `docs/guide.md`. Rules out applying the exclusion before the inclusion, and rules out dropping the exclusion when `glob` is set. *(unit)*
- [ ] **Pattern-mode replace honours it.** `replaceText(scope, { pattern: "v1", replacement: "v2", excludeGlob: "docs/archive/**" })` against `v1` in `docs/archive/old.md` and `src/a.ts` leaves `docs/archive/old.md` byte-identical, returns `filesModified: ["<abs>/src/a.ts"]`, and `replacementCount: 1`. Asserting all three rules out an implementation that skips the write but still counts the hit. *(unit)*

**Type matrix.** The parameter is a path filter — it acts on the relative path string, before any file is read. Content type (`.ts`, `.vue`, `.md`, binary) does not reach a different code path, so no per-extension ACs. The two distinct paths are the two operations, covered by AC 1 and AC 3; the two distinct parameter combinations are exclude-alone and exclude-with-glob, covered by AC 1 and AC 2. `replaceText`'s surgical mode does not enumerate files and is out of scope (see Edges).

## Interface

Both schemas gain one optional field, described identically so the two commands read the same in `--help` and in the MCP tool description:

```ts
excludeGlob: z
  .string()
  .optional()
  .describe(
    "Optional glob of files to exclude, applied after `glob` (e.g. 'docs/archive/**'). Exclude multiple trees with a brace group: '{docs/archive/**,dist/**}'. Same syntax and limits as `glob`.",
  )
```

`walkWorkspaceFiles` moves from positional parameters to an options object:

```ts
// before
walkWorkspaceFiles(workspace: string, glob?: string, fs?: FileSystem): string[]

// after
walkWorkspaceFiles(
  workspace: string,
  opts?: { glob?: string; excludeGlob?: string; fs?: FileSystem },
): string[]
```

`walkFiles` is a different function with a different job (extension filtering for the engines) and is not changed.

Answering the template's questions for the new field:

- **What does it contain?** A workspace-relative glob in the same dialect `glob` already accepts — `*`, `**`, `?`, and flat brace groups. Example: `"docs/specs/archive/**"`.
- **Realistic bounds?** A path pattern, tens of characters. Brace expansion is capped at 256 patterns by `BRACE_EXPANSION_CAP`, which the exclusion inherits — a `{a,b}{c,d}…` blow-up throws `INVALID_GLOB` during expansion rather than materialising the array.
- **Zero/empty case?** Absent means no exclusion — identical to today's behaviour. An empty string is rejected by nothing today and would compile to a predicate matching nothing, which is the same as absent; no special case is added for it, and no meaningful distinction exists between "absent" and "empty" here.
- **Adversarial case?** Unsupported syntax throws `INVALID_GLOB` before any file is read, via the same `compileGlob` validation `glob` uses. The value never reaches the filesystem or a shell — it is compiled to a `RegExp` and tested against already-enumerated relative paths, so it cannot widen the file set or escape the workspace. A pattern excluding everything returns zero matches, which is a correct answer, not an error.

Against the `docs/agent-users.md` checklist: the parameter is optional with the safe default (off, behaviour unchanged), its name states the direction of the filter, the error code for bad input is one the agent already handles for `glob`, and the description is self-contained enough to use from the tool description alone.

## Open decisions

**Resolved — `walkWorkspaceFiles` takes an options object rather than a fourth positional parameter.**

The alternatives were a positional `(workspace, glob, fs, excludeGlob)` (smallest diff, no test churn) and filtering inside each operation (no util change at all).

Chosen: the options object. The positional form splits the two glob parameters around `fs`, which is a test seam rather than a caller concern, and every future filter option makes that ordering worse. Per-operation filtering was rejected outright — it duplicates the workspace-relative path computation across `searchText` and `replaceText`, which `docs/code-standards.md` says to extract, so it argues its own way back to a shared helper.

Consequences: ~15 mechanical test call-site updates in `file-walk.test.ts`; a find-and-replace, not judgment. It enables further filter options without another signature change. Watch for: the two production callers currently always pass `scope.fs`, so `fs` staying optional in the options object preserves the existing default-to-`NodeFileSystem` behaviour for tests that omit it.

## Security

- **Workspace boundary:** No new file reads or writes. `excludeGlob` only *removes* files from an already-enumerated set, so it cannot widen the surface past `walkWorkspaceFiles`'s existing workspace root, and `replaceText`'s per-file `scope.contains()` re-check is untouched.
- **Sensitive file exposure:** N/A — no change to which files are read. `isSensitiveFile` filtering stays where it is, and the exclusion is strictly additive to it (a file can be skipped for either reason).
- **Input injection:** One new string parameter. It never reaches the filesystem or a shell — `compileGlob` validates it and compiles it to a `RegExp` tested against relative path strings. The existing `INVALID_GLOB` validation rejects character classes, nested braces, and unbalanced braces before compilation.
- **Response leakage:** N/A — the parameter is not echoed into results, and the only error it can produce is `INVALID_GLOB`, whose message already includes the glob the caller supplied.

## Edges

- **Surgical mode ignores it.** `replaceText` with `edits` does not enumerate files, so `excludeGlob` has no effect there — matching how `glob` already behaves in that mode. Document it; do not add an error. Widening that to a validation error is a separate change that should cover `glob` too.
- **`INVALID_GLOB` on unsupported syntax.** A mechanical consequence of reusing `compileGlob`, asserted rather than specified as an AC: `excludeGlob: "docs/[ab]/**"` throws `INVALID_GLOB`, not an empty result.
- **Brace groups expand.** `excludeGlob: "{docs/archive/**,dist/**}"` excludes both trees. This is why the parameter is a single string and not an array — assert it once so the reason stays visible.
- **Ordering.** The exclusion is applied after the inclusion, inside `walkWorkspaceFiles`, so both operations get identical semantics without either one restating the rule.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`. If implementation pushes a file past threshold, extract per the test refactoring hierarchy (push down to units → decompose source) before marking this item done.
- [ ] Docs updated:
      - `docs/commands/search-text.md` — `excludeGlob` row in Inputs, one example
      - `docs/commands/replace-text.md` — `excludeGlob` row in Inputs, noting it is pattern-mode only
      - `docs/internals/search-text.md` and `docs/internals/replace-text.md` — the filter order (glob, then excludeGlob, then sensitive/binary skips)
      - `.claude/skills/weaver-search-and-replace/SKILL.md` — **one line** in the existing "Scoping" section. No new section.
      - README.md and `docs/reference/error-codes.md` need no change — no new command, no new error code
- [ ] **No eval change, and the gate is not run.** The coverage invariants in `eval/cases/coverage.test.ts` key on `OPERATION_NAMES` and fixture filenames, so no operation is added and no case or fixture is required; `keyArgs` is a subset match, so a model that passes `excludeGlob` still grades `correct`. No new case is added — there is no observed failure to anchor one, and a task worded explicitly enough to force the parameter would measure instruction-following rather than the skill. **If the skill edit grows past one line, that is a dilution risk and the escape hatch applies:** run the Gemini 2.5 Flash sweep at n=10 (~$0.32, against ~$0.89 for the Haiku gate at n=3) before archiving, and record the rates in `docs/eval-baselines.md`.
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Shipped:** 2026-08-07, five commits (`8023e36`..`f30c29c`) plus docs.

### Verification

Exercised on the deployment path — compiled CLI, real daemon over a real socket, against this repository — using a sentinel (`ZQXVW-sentinel-9182`) seeded into `docs/specs/archive/` and `src/` so no result could pass by coincidence.

| Call | Observed |
|---|---|
| no `excludeGlob` | 2 matches (archive + src) — reproduces the original dogfooding pain |
| `excludeGlob: "docs/specs/archive/**"` | 1 match (src only) |
| `glob: "**/*.md"` + `excludeGlob` | 1 match — exclusion wins over inclusion |
| `excludeGlob: "docs/[ab]/**"` | `INVALID_GLOB` with the syntax hint |
| `excludeGlob: "{docs/specs/archive/**,src/**}"` | 0 matches — brace group excludes both trees |
| `replace-text` + `excludeGlob` | `filesModified: [src/…]`, `replacementCount: 1`; archive file byte-identical, src file replaced |

**The first verification attempt was a false red, and the reason matters more than the feature.** `pnpm exec weaver` reported `excludeGlob` as having no effect at all — including returning success for a deliberately invalid glob. The cause was not the code: `package.json` declares `"@yearofthedan/weaver": "file:."`, and pnpm resolves that to a *hard copy* under `node_modules/.pnpm/@yearofthedan+weaver@file+/`, dated 20 Jul 2026, which does not refresh on `pnpm build`. Invoking `node dist/adapters/cli/cli.js` gave correct results on every case. Logged as a P2 `[needs investigation]`, because `CLAUDE.md` tells every agent to dogfood via `pnpm exec weaver` — so any change "verified" that way since 20 July was verified against a July build.

### Tests and mutation

9 tests added: 4 in `file-walk.test.ts` (exclusion, ordering vs `glob`, `INVALID_GLOB`, brace group), 2 in `searchText.test.ts`, 1 in `replaceText.test.ts`, 2 schema-description round-trips.

| File | Score | Notes |
|---|---|---|
| `file-walk.ts` | 96.08% | 2 survivors, both equivalent mutants |
| `searchText.ts` | 91.78% | 6 survivors, all pre-existing |
| `replaceText.ts` | 78.13% | 17 survivors + 4 no-coverage, all pre-existing (surgical mode) |

No survivor falls on a line this change touched. The one new equivalent mutant is `file-walk.ts:83` — `if (globPred || excludePred)` → `if (true)`. With both predicates null the filter body returns `true` for every file, so the mutant is behaviourally identical; the guard exists to skip a `path.relative` per file on the common unfiltered search. Unkillable by construction, and worth keeping.

The `replaceText` no-coverage cluster revealed a pre-existing gap: the offset `reduce` (line 157) only fires when `lineIdx > 0` and the out-of-range `throw` (line 153) never runs, so every surgical test edits line 1 of its file. Filed as a `[chore]`.

### Reflection

**What went well.** Resolving the `walkWorkspaceFiles` signature fork *before* dispatch meant the executor had no design judgment to make; the implementation landed in one batch with no interface drift. Reusing `compileGlob` wholesale meant `INVALID_GLOB`, brace expansion, and the 256-pattern cap all came free and needed assertions rather than code.

**What did not go well.** The AC tests passed on first write with no red state, because step 1's signature change had already threaded `excludeGlob` through both operations. That is a real weakness in how the batch was ordered — the seam and its consumers landed together, so nothing ever failed. Mutation testing was the only thing that could confirm the tests discriminate, and it did, but the ordering should have put the operation tests before the seam wiring.

**What took longer than it should have.** The false-red verification cost the most time, and the instinct it produced was wrong twice over: first trusting `pnpm exec weaver`, then — after being wrong once — over-hedging the *correct* second result into a request for user sign-off it did not need. Stale-artifact failures look exactly like feature failures. Check what the binary resolves to before theorising about the code.

**For the next agent.** Do not verify a CLI change in this repo with `pnpm exec weaver` until the stale-copy item is resolved; use `node dist/adapters/cli/cli.js` and stop the daemon first (`ensureDaemon` only respawns on a version mismatch, and the version does not change between builds). When adding a filter option to `walkWorkspaceFiles`, it now takes an options object — extend that, do not add positionals.
