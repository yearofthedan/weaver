---
name: spec
description: Create or refine a task specification from a handoff.md entry — picks the right template, walks through design decisions with the user, and produces a ready-to-implement spec file.
---

# Spec Workflow

1. **Identify the task.** Read `docs/handoff.md` — find the entry the user wants to spec. If no entry is specified, show the `[needs design]` entries and ask which one.

2. **Pick the template.** Read both templates in `docs/specs/templates/`. Choose:
   - `change.md` — new capability, enhancement, refactoring, or tech debt
   - `bug.md` — something is broken and needs fixing

3. **Create the spec file.** Name it `docs/specs/YYYYMMDD-short-slug.md` using today's date and a 2-4 word slug (lowercase, hyphens). Copy the template content.

4. **Fill in the Context / Symptom section.** Pull from the handoff entry and any linked feature docs. Keep it to one paragraph — if you need more, the background belongs in the feature doc.

5. **Fill in the Value / Effort section.** Articulate why this is worth doing now and what the implementation surface looks like. Use the template prompts. If value is low or effort is high relative to alternatives, flag this to the user before continuing.

6. **Draft the Behaviour / Fix section with the user.** This is the core of the spec.
   - Write concrete ACs as input → output pairs wherever possible
   - For each AC, apply the template prompts: "what's the laziest wrong implementation?", "what's the narrowest fix that leaves siblings broken?"
   - If you have more than 5 ACs, stop and discuss splitting with the user (see template guidance)
   - Do NOT proceed past this step without user agreement on the ACs

7. **Fill in Interface (change only).** See `docs/specs/templates/change.md` for the full walkthrough. For every parameter and return field, answer:
   - What does it contain? (not just the type — the actual information)
   - What are the realistic bounds? What's an example value?
   - What's the zero/empty case? The adversarial case?
   - If the operation wraps a compiler/external API, read the API source to answer these — don't guess

8. **Fill in Edges.** Ask: "what must NOT change?" and "what assumptions are we making?" These become regression tests during implementation.

9. **Review the Done-when checklist.** Add any task-specific verification steps (e.g., "works via both MCP and CLI", "mutation score for this file specifically").

10. **Update handoff.md.** Change the entry from `[needs design]` to a link to the new spec file. Remove inline ACs or description that moved to the spec — the handoff entry becomes one line.

11. **Confirm with the user.** Show a summary of the spec before finishing:
    - Number of ACs
    - Key interface decisions
    - Anything flagged for the Edges section
    - Ask: "Ready to implement, or want to revise?"

12. **Commit.** Use `docs(specs): add spec for [short-title]` as the commit message.
