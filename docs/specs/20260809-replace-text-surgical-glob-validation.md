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

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag defined in `docs/code-standards.md`. If implementation pushes a file past threshold, extract per the test refactoring hierarchy (push down to units → decompose source) before marking this item done.
- [ ] Docs updated:
      - `docs/commands/replace-text.md` — note in the surgical-mode section (or the `Limitations` list) that combining `edits` with `glob`/`excludeGlob` is rejected with `VALIDATION_ERROR`, replacing the current "has no effect there" framing for `excludeGlob`
      - `docs/reference/error-codes.md` — no new code; `VALIDATION_ERROR` row already covers this, no edit needed unless the row's description should mention the new case
      - `docs/internals/replace-text.md` — if it documents the refine's XOR check, extend that description with the new condition
      - README.md — no change (no new command, no new top-level surface)
      - `.claude/skills/weaver-search-and-replace/SKILL.md` — no change unless the skill currently suggests combining `edits` with `glob` (verify during implementation; if it doesn't, no edit needed)
      - handoff.md current-state section — no change (no new file, no layout change)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc, or `CLAUDE.md` if a cross-cutting process rule (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
