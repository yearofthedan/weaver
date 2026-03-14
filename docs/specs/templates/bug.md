# [Short title]

**type:** bug
**date:** YYYY-MM-DD
**tracks:** handoff.md # entry-name

---

## Symptom

What's happening. Exact error message or wrong output.

## Value / Effort

> **Prompt:** Use this to decide whether the fix is worth doing *now*.
> If the bug is cosmetic or the fix is high-risk, consider deferring.

- **Value:** How often does this bite users? What's the workaround cost?
  A bug with no workaround is higher value than one easily sidestepped.
- **Effort:** Is the root cause clear? Is the fix localised or does it
  ripple through many call sites? Flag anything that requires new
  infrastructure vs. a targeted patch.

Include a reproduction if possible — the most useful format is:

```
input:    [what was provided]
actual:   [what happened]
expected: [what should have happened]
```

## Expected

What should happen instead. Same concrete format: input → expected output.

## Root cause

*Filled in during investigation. Leave blank in the initial spec.*

When filled, be specific enough that someone could point to the line(s)
responsible. "The regex doesn't handle X" is better than "the validation
is wrong."

## Fix

> **Prompt:** If this bug affects a tool interface, response shape, or error path,
> review [`docs/agent-users.md`](../../agent-users.md) — the fix should respect
> agent-user constraints (structured errors, distinct codes, bounded output).

Acceptance criteria for the fix:

- [ ] [reproduction case] now produces [expected output]
- [ ] Regression test covers the exact failing case

> **Prompt:** For each criterion, ask: "what's the narrowest fix that passes this
> line but leaves a related case broken?" If you can think of one, add that case.

> **Prompt:** What are the **adjacent inputs** — variations of the failing input
> that might also be broken? A string with different length, a path with different
> depth, a collection with 0 or 1 elements instead of N. If the bug is in a
> boundary condition, the adjacent inputs often reveal siblings.

## Security

> **Prompt:** Review [`docs/security.md`](../../security.md) for the full threat model.
> Every fix must explicitly state whether it affects these surfaces.
> Write "N/A" with a one-line reason when a category does not apply —
> a blank section means the analysis was skipped, not that the fix is safe.

- **Workspace boundary:** Does the fix change how files are read or written?
  Could the fix bypass `isWithinWorkspace` or weaken an existing boundary check?
- **Sensitive file exposure:** Does the fix touch code that reads file content?
  Could it expose secrets that were previously blocked?
- **Input injection:** Does the fix change how user-supplied strings are handled?
  Could a crafted input reach the filesystem or shell through the new code path?
- **Response leakage:** Does the fix change error messages or response fields?
  Could file content or user-controlled strings leak into agent-visible output?

## Edges

Related cases to verify — the fix shouldn't be so narrow it only covers
the reported symptom.

- What are the sibling inputs? (same shape, different values)
- Does this bug exist in other code paths that share the same logic?
- Could the fix introduce a regression in the happy path?

## Done-when

- [ ] All fix criteria verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (use `docs/specs/templates/feature.md` for new feature docs)
- [ ] Tech debt discovered during investigation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
