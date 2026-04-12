---
name: spec
description: Create or refine a task specification from a handoff.md entry — picks the right template, walks through design decisions with the user, and produces a ready-to-implement spec file.
metadata:
  internal: true
---

# Spec Workflow

**Hard rule: steps 1–14 are checkpoints, not suggestions.** When a step says "confirm with the user", "ask the user", or "do NOT proceed" — STOP. Output what you have and wait for the user's response. Do not write spec files, update handoff.md, or commit until the user has agreed to the ACs at step 7. Skipping checkpoints to "save time" makes the workflow useless. Steps 3–6 and 8–13 produce draft content that is only written to disk AFTER step 7 confirmation.

1. **Identify the task.** Read `docs/handoff.md` — find the entry the user wants to spec. If no entry is specified, show the `[needs design]` entries and ask which one.

2. **Pick the template.** Read the spec templates in `docs/specs/templates/`. Choose:
   - `change.md` — new capability, enhancement, refactoring, or tech debt
   - `bug.md` — something is broken and needs fixing
   - (`docs/features/_template.md` is not a spec template — it's the template for feature reference docs, used when shipping, not when planning)

3. **Create the spec file.** Name it `docs/specs/YYYYMMDD-short-slug.md` using today's date and a 2-4 word slug (lowercase, hyphens). Copy the template content.

4. **Fill in the Context / Symptom section.** Pull from the handoff entry and any linked feature docs. Keep it to one paragraph — if you need more, the background belongs in the feature doc.

5. **Fill in User intent (change only).** Write the core intent as: *As a [user type], I want [action], so that [outcome].* This must describe what the user is trying to achieve — not an edge case, not a mechanism. Every design decision in the spec must trace back to this statement. If a proposed AC contradicts the intent, the AC is wrong.

6. **Fill in the Value / Effort section.** Articulate why this is worth doing now and what the implementation surface looks like. Use the template prompts. If value is low or effort is high relative to alternatives, flag this to the user before continuing.

7. **Draft the Behaviour / Fix section with the user.** This is the core of the spec.
   - **Changes:** Write concrete ACs as input → output pairs wherever possible. For each AC, apply the template prompts: "what's the laziest wrong implementation?", "what's the narrowest fix that leaves siblings broken?" Then apply the **type matrix check**: enumerate the distinct input types (file extensions, parameter combinations, engine paths) that exercise different code paths. If a feature applies to both `.ts` and `.vue` files, test both as inputs *and* outputs — don't assume symmetry. If different combinations flow through different engine methods or translation layers, they need separate ACs. If you have more than 5 ACs, stop and discuss splitting with the user (see template guidance).
   - **Bugs:** Describe the fix — what to change and where. Bugs don't have ACs; the Expected section defines the target behaviour. Verification criteria go in Done-when ("reproduction case now produces expected output", "regression test covers the failing case"). The fix is dispatched as a single unit to the execution agent.
   - Do NOT proceed past this step without user agreement

8. **Flag open implementation decisions.** As you explored the codebase, you may have found places where the implementation has a meaningful fork — e.g. AST vs regex, sync vs async, new abstraction vs inline. For each fork where the approaches have **different correctness or risk profiles**, add an `## Open decisions` section to the spec with:
   - The decision to make (framed as a question)
   - The viable approaches
   - The tradeoffs (especially correctness, maintainability, and risk — not just effort)
   - A recommendation if you have one, with reasoning

   These are **not** implementation details the executor can figure out. They are architectural forks that affect what gets built. The spec cannot be picked up for implementation until every open decision is resolved. Never write "the executor should choose" — that defers a design decision to an agent that isn't equipped to make it.

9. **Populate Relevant files and Red flags.** As you explored the codebase to draft ACs, you read files containing reusable logic, similar patterns, and shared types. List them in the `Relevant files` section with a brief note on why each matters. Also note any code smells in the target area — poor cohesion, duplication, missing abstractions, tangled responsibilities — under `Red flags`. Assess using the quality model in `docs/code-standards.md`, not just the size thresholds.

   **Test hotspot assessment:** Check the test files that will be touched by this spec. If any are at or near threshold, assess them using the test refactoring hierarchy in `docs/code-standards.md` and include a prep step in the spec to refactor them before adding new tests.

   If red flags are severe enough to warrant cleanup before feature work, note that a cleanup sub-slice should be dispatched to the execution agent first.

10. **Fill in Interface (change only).** See `docs/specs/templates/change.md` for the full walkthrough. For every parameter and return field, answer:
    - What does it contain? (not just the type — the actual information)
    - What are the realistic bounds? What's an example value?
    - What's the zero/empty case? The adversarial case?
    - If the operation wraps a compiler/external API, read the API source to answer these — don't guess

11. **Fill in Edges.** Ask: "what must NOT change?" and "what assumptions are we making?" These become regression tests during implementation.

12. **Review the Done-when checklist.** Add any task-specific verification steps (e.g., "works via both MCP and CLI", "mutation score for this file specifically"). Check `.claude/skills/` for any skill file that references the changed tool — skill files are the primary way agents discover tool capabilities. If the skill doesn't mention the new mode, agents won't use it. Add skill updates to Done-when.

13. **Update handoff.md.** Change the entry from `[needs design]` to a link to the new spec file. Remove inline ACs or description that moved to the spec — the handoff entry becomes one line.

14. **Confirm with the user.** Show a summary of the spec before finishing:
    - **Changes:** Number of ACs, key interface decisions
    - **Bugs:** Fix approach summary, verification criteria in Done-when
    - Any open decisions flagged in step 8
    - Ask: "Ready to implement, or want to revise?"

15. **Report for commit.** Tell the caller that the spec file and the updated handoff.md are ready to commit with message `docs(specs): add spec for [short-title]`. **Do NOT commit until the user has explicitly signed off on the spec.** The spec agent does not commit directly — the orchestrator or user handles the commit. A premature commit forces amends or reverts when the user requests changes, which is wasteful and error-prone.
