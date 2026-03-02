# [Short title]

**type:** change
**date:** YYYY-MM-DD
**tracks:** handoff.md # entry-name → docs/features/relevant.md

---

## Context

Why this change exists. One paragraph max — the feature doc has the background.

## Value / Effort

> **Prompt:** Use this to decide whether the task is worth doing *now*.
> If value is low or effort is high, consider deferring or splitting.

- **Value:** What does this save the caller from having to do themselves?
  What failure mode does it prevent? ("Saves a round-trip" is weak;
  "agents catch type errors at the point of change instead of discovering
  them three steps later" is strong.)
- **Effort:** What's the implementation surface? Count the files touched,
  new concepts introduced, and interactions with existing code. Flag anything
  that requires new infrastructure vs. plumbing through existing patterns.

## Behaviour

Acceptance criteria as concrete **input → output** statements.

> **Prompt:** For each criterion, ask: "what's the laziest wrong implementation that
> would still satisfy this line?" If you can think of one, the criterion is too vague.
> Tighten it or add another.

- [ ] Given [input], produces [exact expected output] (not just "returns a result")
- [ ] Given [empty/zero case], produces [specific handling]
- [ ] Given [boundary input], produces [specific outcome]

> **If you have more than 5 ACs, split the spec.** Each spec should deliver in a
> single slice. Too many criteria means the scope is too wide or the criteria are
> too granular. The Edges section handles constraints that aren't ACs.

## Interface

What changes on the public surface. Sketch the types — parameter names, return shape, error codes.

> **Prompt:** Review [`docs/agent-users.md`](../../agent-users.md) before filling this section.
> Agents are our primary users — run through the design checklist there:
> defaults on, structured responses, capped output, unambiguous parameters,
> distinct error codes, discoverable from the tool description alone.

For every field and parameter, answer:

- **What does it contain?** "string" is not enough. What information does it hold?
  What's an example value?
- **What are the realistic bounds?** Length, numeric range, collection size.
  If unbounded, is that intentional? What would a 10× input look like?
- **What's the zero/empty case?** Empty array, blank string, missing optional.
  Is the distinction between "absent" and "empty" meaningful?
- **What's the adversarial case?** Huge input, special characters, concurrent
  calls, paths with spaces or symlinks.

If a parameter or field has no answer here, the spec isn't ready.

## Edges

Constraints that aren't acceptance criteria but bound the implementation.
These become regression tests or guard assertions, not features.

Examples of what belongs here:
- Security boundaries ("must not touch files outside workspace")
- Performance expectations ("must handle 500-export files")
- Compatibility constraints ("must work with both resolved and unresolved tsconfig paths")
- Interactions with existing operations ("rename after moveFile must still work")

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - README.md (tool table, CLI commands, error codes, project structure)
      - Feature doc created or updated
      - handoff.md current-state section
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
