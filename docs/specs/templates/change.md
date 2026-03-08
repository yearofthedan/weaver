# [Short title]

**type:** change
**date:** YYYY-MM-DD
**tracks:** handoff.md # entry-name → docs/features/relevant.md

---

## Context

Why this change exists. One paragraph max — the feature doc has the background.

## User intent

> **Prompt:** State the core intent — not the edge case, not the mechanism.
> Write it as: *As a [user type], I want [action], so that [outcome].*
> This must describe what the user is trying to achieve, not how the
> implementation handles a particular scenario. Edge cases are handled
> by ACs in service of this intent. Every design decision in the spec
> should trace back to this statement — if a proposed behaviour contradicts
> the intent, the behaviour is wrong.

*As a …, I want …, so that …*

## Relevant files

> Files the executor should read before starting. The spec agent populates
> this during exploration — it's nearly free since you already read these files.
> Include files with reusable logic, similar patterns, shared types, or code
> that will be directly modified.

- `path/to/file.ts` — why it matters

### Red flags

> Code smells in the target area that should be fixed before or during this work,
> not extended. Examples: oversized files, duplicated logic, missing abstractions.
> The spec agent can dispatch cleanup as a sub-slice before the feature ACs.
>
> **Test hotspots:** Check the test files that will be touched. If any are at or
> near threshold, assess using the test refactoring hierarchy in
> `docs/code-standards.md` (push down to units → decompose source → extract
> fixtures → parameterise → split by area as last resort). Include a prep step
> if refactoring is needed before adding new tests.

- (none, or list smells found during exploration)

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

## Open decisions

> **Prompt:** If the implementation has a meaningful fork — multiple viable
> approaches with different correctness, risk, or maintainability profiles —
> list each one here. Do NOT write "the executor should choose" or defer the
> decision. Each entry needs:
>
> - **Decision:** The question, framed as a choice (e.g. "AST parsing vs regex")
> - **Options:** The viable approaches (2-3 max)
> - **Tradeoffs:** What each option risks or enables — focus on correctness and
>   maintainability, not just effort
> - **Recommendation:** Your pick and why, or "needs user input" if the tradeoffs
>   are genuinely balanced
>
> Implementation cannot start until every decision here is resolved. Once
> resolved, replace the open question with the chosen approach, the reasoning,
> and the consequences (what it enables, what it rules out, what to watch for).
> This record persists in the archived spec so future readers understand *why*,
> not just *what*.

(none, or list decisions found during exploration)

## Security

> **Prompt:** Review [`docs/security.md`](../../security.md) for the full threat model.
> Every change must explicitly state whether it affects these surfaces.
> Write "N/A" with a one-line reason when a category does not apply —
> a blank section means the analysis was skipped, not that the change is safe.

- **Workspace boundary:** Does this change read or write files? Could any new
  code path bypass `isWithinWorkspace`? Are all output paths boundary-checked
  before write?
- **Sensitive file exposure:** Does this change read file content that could
  include secrets (`.env`, private keys, credentials)? Does it need to call
  `isSensitiveFile`?
- **Input injection:** Does the change introduce new string parameters that
  reach the filesystem, shell, or are interpolated into paths? Could a crafted
  value escape the intended scope?
- **Response leakage:** Does the change put file content or user-controlled
  strings into error messages or response fields? Could an agent receive
  secrets or prompt-injection payloads through the response?

## Edges

Constraints that aren't acceptance criteria but bound the implementation.
These become regression tests or guard assertions, not features.

Examples of what belongs here:
- Performance expectations ("must handle 500-export files")
- Compatibility constraints ("must work with both resolved and unresolved tsconfig paths")
- Interactions with existing operations ("rename after moveFile must still work")

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - README.md (tool table, CLI commands, error codes, project structure)
      - Feature doc created or updated (use `docs/features/_template.md` for new docs)
      - handoff.md current-state section
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
