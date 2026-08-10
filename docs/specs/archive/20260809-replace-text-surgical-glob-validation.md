# `replace-text` rejects `glob`/`excludeGlob` combined with `edits`

**type:** change
**date:** 2026-08-09
**tracks:** handoff.md # `replace-text` silently ignores `glob` in surgical mode → docs/commands/replace-text.md, docs/reference/error-codes.md

---

## Context

`applySurgicalEdits` (`src/operations/replaceText.ts`) never enumerates files — it operates only on the exact files named in each `edit.file`. `glob`/`excludeGlob` are file-enumeration filters that pattern mode applies via `walkWorkspaceFiles`; in surgical mode they have nothing to filter and are silently ignored. An agent that supplies both plausibly believes the glob constrains which edits apply — it does not, and nothing signals that. The `excludeGlob` spec ([archived](archive/20260807-exclude-glob-search-replace.md)) explicitly deferred this: *"Widening that to a validation error is a separate change that should cover `glob` too."*

## User intent

*As a developer using weaver, I want `replace-text` to reject a call that combines `edits` with `glob`/`excludeGlob`, so that a misunderstanding about scoping fails loudly instead of silently doing something other than what I asked.*

## Relevant files

- `src/adapters/schema.ts:214` — `ReplaceTextArgsSchema`'s `.refine()` already enforces the `pattern`+`replacement` vs. `edits` XOR. This is the same seam; the new check is an additional condition on the same refine.
- `src/adapters/schema.test.ts:337-370` — `describe("ReplaceTextArgsSchema (exactly-one-mode invariant)")` is the existing test block for this refine; new cases join it.
- `src/daemon/dispatcher.ts:218` — the boundary where `ReplaceTextArgsSchema` (the refined schema, not the base) is actually enforced. No change needed here — the refine already runs at this point.
- `src/adapters/cli/operations.ts:69` — the CLI's own pre-flight validation uses the unrefined `ReplaceTextBaseSchema`, so it does not catch this locally; the payload is forwarded to the daemon and rejected there. This is the existing behaviour for the pattern/edits XOR too — out of scope to change here (see Edges).
- `src/operations/replaceText.ts:43-48` — the operation-level guard that duplicates the schema's XOR check for callers that bypass the schema (e.g. tests). Not extended by this change: `glob`/`excludeGlob` are accepted parameters of the function signature regardless of mode, and the function has no equivalent "second line of defence" need here since nothing in `applySurgicalEdits` reads them — the field is inert there, not dangerous if unchecked. The schema is the only enforcement point.

### Red flags

- `schema.test.ts` is 371 lines. Per `docs/code-standards.md`, length alone isn't a split trigger, and this file is one cohesive block of schema/refine assertions (test count grows with schema count, not with mixed responsibility). No prep split.

**Layer-fit:** both ACs are pure function of input (Zod schema validation, no I/O). Unit-test directly against `ReplaceTextArgsSchema.safeParse()`, no fixture or workspace needed.

## Value / Effort

- **Value:** An agent that combines `edits` with `glob`/`excludeGlob` today gets a `success` response that quietly did not apply the scoping it believed it asked for — the kind of silent-wrong-result `CLAUDE.md`'s diagnose-before-acting rules exist to prevent. Rejecting turns that into an immediate, correctly-coded failure the agent can react to instead of trusting a result that isn't what was asked.
- **Effort:** One additional condition in an existing `.refine()`, two new test cases in an existing describe block, one doc line. No new error code, no new file, no protocol change.

## Behaviour

- [ ] Given `{ edits: [<valid edit>], glob: "**/*.ts" }` (no `pattern`/`replacement`), `ReplaceTextArgsSchema.safeParse(...)` returns `success: false`, with an issue message naming `glob`. *(unit)*
- [ ] Given `{ edits: [<valid edit>], excludeGlob: "docs/**" }` (no `pattern`/`replacement`), `ReplaceTextArgsSchema.safeParse(...)` returns `success: false`, with an issue message naming `excludeGlob`. *(unit)*

**Type matrix check:** the refine operates on the parsed object's shape, not on file content or engine path — there is no `.ts`/`.vue` distinction to test. The two fields (`glob`, `excludeGlob`) are the only distinct inputs, and both are covered above. `edits` + both `glob` and `excludeGlob` together is not a third AC — it's the same OR condition already exercised by each AC individually; assert it as a regression case, not a spec criterion.

## Structural criteria

- (none)

## Interface

No new field, no new error code. The existing `.refine()` on `ReplaceTextArgsSchema` gains a second condition; its `message` becomes conditional on which rule failed (mode XOR vs. glob-with-edits) so the two failure reasons stay distinguishable in the response.

- **What does it contain?** The refine's failure message is a string explaining which fields conflict — e.g. `"glob/excludeGlob only apply in pattern mode; do not combine with edits"` for this case, vs. the existing `"Provide either 'pattern'+'replacement' or 'edits', not both"` for the mode XOR. Both surface as `VALIDATION_ERROR` with this message in `error.message` — no new error code.
- **Realistic bounds:** N/A — no new parameter, no new bound.
- **Zero/empty case:** `glob`/`excludeGlob` absent (the common case) is unaffected — the refine's new condition only fires when `edits` and at least one of the two glob fields are both present.
- **Adversarial case:** N/A — this is a presence check on already-validated fields, not a new string parameter reaching the filesystem or shell.

Against `docs/agent-users.md`: the error is unambiguous (names the exact fields in conflict), uses the error code agents already branch on for bad input (`VALIDATION_ERROR`), and requires no new schema knowledge — an agent that already handles `VALIDATION_ERROR` from the mode XOR handles this for free.

## Open decisions

**Resolved — reject with `VALIDATION_ERROR`, not silent-ignore-and-document.**

Options were (a) extend the refine to reject the combination, or (b) leave the silent ignore and strengthen the field descriptions to state it explicitly (matching how `excludeGlob`'s command-doc row already notes "surgical mode does not enumerate files, so this has no effect there").

Chosen: reject. No valid workflow combines `edits` with `glob`/`excludeGlob` — surgical edits already name their exact target files, so the glob has nothing left to filter. Because no working call depends on the combination, rejecting cannot break an existing correct caller; it can only convert a silently-wrong-looking-successful call into a loud, correctly-coded one. This matches the `agent-users.md` bar of unambiguous parameters over a footgun that only a doc read prevents.

Consequences: an agent that was (incorrectly) relying on `glob` to scope surgical edits now gets `VALIDATION_ERROR` instead of a quiet no-op — this is the intended behaviour change. Watch for: the CLI's local pre-flight schema (`ReplaceTextBaseSchema`, unrefined) still won't catch this before sending to the daemon, same as the pre-existing mode-XOR gap — not fixed here.

## Security

- **Workspace boundary:** N/A — no new file read/write path; the refine runs before any file is touched.
- **Sensitive file exposure:** N/A — no change to which files are read.
- **Input injection:** N/A — no new string parameter; this only adds a presence check on existing validated fields.
- **Response leakage:** N/A — the error message names field identifiers only (`glob`, `excludeGlob`), never file content or user-supplied string values.

## Edges

- **`edits` alone (no `glob`/`excludeGlob`) still succeeds unaffected.** Already covered by the existing `"accepts surgical edits mode alone"` test — this change must not touch that path. Regression, not a new AC.
- **`pattern`+`replacement`+`glob` (pattern mode) still succeeds unaffected.** Already covered by existing pattern-mode tests — the new refine condition is scoped to `edits` being present, so pattern mode's use of `glob` is untouched. Regression, not a new AC.
- **`edits` + both `glob` and `excludeGlob` together** also rejects — same underlying OR condition as the two ACs, assert as a regression case alongside them rather than a third AC.
- **CLI-level validation gap is pre-existing and unchanged.** `operations.ts`'s use of the unrefined `ReplaceTextBaseSchema` means a bad CLI call still round-trips to the daemon before failing — identical to today's behaviour for the pattern/edits XOR. Out of scope.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score ≥ threshold for touched files (scoped run — see Outcome)
- [x] `pnpm check` passes (lint + build + test)
- [x] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md` (`schema.test.ts` 399 lines, cohesive, no split)
- [x] Docs updated:
      - `docs/commands/replace-text.md` — `excludeGlob` row and a new Limitations bullet updated to state the combination is rejected with `VALIDATION_ERROR`
      - `docs/reference/error-codes.md` — no edit needed, existing `VALIDATION_ERROR` row already covers it
      - `docs/internals/replace-text.md` — no edit needed, it didn't document the refine
      - README.md — no change
      - `.claude/skills/weaver-search-and-replace/SKILL.md` — no change, no example combined `edits` with `glob`
      - handoff.md current-state section — no change
- [x] Tech debt discovered during implementation added to handoff.md as [needs design] (`schema.ts`'s refine logic invisible to the default mutation run)
- [x] Non-obvious gotchas — none warranted a doc update beyond the mutation-testing survivor table entry (see Outcome)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Shipped:** 2026-08-09/10, two commits (`b971821`, `d36081e`).

### Verification

Exercised on the real path — built CLI (`pnpm build`), real daemon, real workspace — using sentinel content (`zqxvwSentinel`) so no result could pass by coincidence:

| Call | Observed |
|---|---|
| `edits` + `glob` | `{"status":"error","error":"VALIDATION_ERROR","message":"glob/excludeGlob only apply in pattern mode; do not combine with edits"}` |
| `edits` + `excludeGlob` | same `VALIDATION_ERROR` |
| `edits` alone | `{"status":"success","filesModified":[...],"replacementCount":1,...}` — file correctly edited, unaffected |
| `pattern`+`replacement`+`glob` | `{"status":"success","filesModified":[...],"replacementCount":1,...}` — pattern mode unaffected |

### Tests and mutation

4 tests added to `schema.test.ts`'s existing `describe("ReplaceTextArgsSchema (exactly-one-mode invariant)")` block: `edits`+`glob`, `edits`+`excludeGlob`, `edits`+both, plus the two pre-existing regression cases (`edits` alone, pattern+glob) verified unaffected without duplication.

Scoped mutation run (`pnpm test:mutate:file src/adapters/schema.ts` — the file is excluded from the default `mutate` array, see the handoff entry this spec added): 100% kill rate on both conditions of the new `.refine()`. File-level aggregate score (58.97%) is dragged down entirely by 31 pre-existing survivors on unrelated schemas' field declarations, never previously measured because the file was wholly out of scope before this run — out of scope for this change, not a regression.

### Reflection

**What went well.** The prior `excludeGlob` spec had already named this exact decision and deferred it explicitly ("a separate change that should cover `glob` too") — that made the Open decision section nearly free to resolve: no valid workflow combines `edits` with a glob, so rejecting couldn't break a working caller. The fix landed as a single-batch dispatch with no interface drift, matching the spec's own Effort estimate.

**What did not go well.** Running the four `/review-changes` agents in parallel hit a background-agent session limit mid-review (the architecture-review agent failed with "session limit · resets 11pm"); the other three completed fine. Recovered by doing the architecture review directly in the main conversation against `docs/design-principles.md` rather than retrying the subagent — worth remembering that a failed background review agent doesn't mean the review can't happen, just that it needs to happen inline.

**Shared working-directory hazard, again.** A concurrent session was working in this same (non-worktree) directory on an unrelated fix (the `dispatcher.test.ts` tautological-assertion pattern, itself discovered during the earlier Vue `getTypeErrors` spec). Their uncommitted changes to `reports/stryker-incremental.json`, `docs/tech/mutation-testing.md`, and `src/daemon/dispatcher.test.ts` appeared staged in this session's `git status` at commit time — likely from a shared `git add -A` moment rather than any action taken here. Unstaged those three files (`git restore --staged`) before committing anything, and the other session committed its own work moments later. No data was lost, but it came within one careless `git commit` of attributing someone else's fix to this spec's commit. **Confirm `git status` shows only files this session's diff actually touched, immediately before every commit — not just before destructive commands** — whenever another agent might be sharing the working directory.

**For the next agent.** `schema.ts` now holds real branching logic (two chained `.refine()`s) but stays outside `stryker.config.mjs`'s default `mutate` array; only an explicit `--mutate src/adapters/schema.ts` run measures it. Tracked in handoff.md as a `[needs design]` entry — worth resolving before a third refine is added to this file without anyone noticing coverage never ran.
