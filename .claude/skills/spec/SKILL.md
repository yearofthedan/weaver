---
name: spec
description: Create or refine a task specification from a handoff.md entry — picks the right template, walks through design decisions with the user, and produces a ready-to-implement spec file.
metadata:
  internal: true
---

# Spec Workflow

The workflow holds the *procedure*; the template holds the *section guidance*. When you fill a section, follow that section's prompt in the template — this skill does not restate them.

**Hard rule: steps 1–10 are checkpoints, not suggestions.** When a step says "confirm with the user", "ask the user", or "do NOT proceed" — STOP. Output what you have and wait for the user's response. Do not write the spec file, update handoff.md, or commit until the user has agreed to the ACs at step 3. The Behaviour draft (step 3) is discussed in the conversation; steps 4–8 write to disk only after that confirmation.

1. **Identify the task.** Read `docs/handoff.md` — find the entry the user wants to spec. If no entry is specified, show the `[needs design]` entries and ask which one.

2. **Pick the template and name the file.** Read the spec templates in `docs/specs/templates/`. Choose:
   - `change.md` — new capability, enhancement, refactoring, or tech debt
   - `bug.md` — something is broken and needs fixing
   - (per-command reference docs live in `docs/commands/`/`docs/internals/`; they are reference, not spec templates)

   Name the file `docs/specs/YYYYMMDD-short-slug.md` using today's date and a 2-4 word slug (lowercase, hyphens). Do not write it yet — draft in the conversation until the ACs are agreed at step 3.

3. **Draft the Behaviour / Fix section with the user.** This is the core of the spec, drafted interactively before anything is written to disk.
   - **Changes:** Write concrete ACs as input → output pairs wherever possible. For each AC, apply the template prompts: "what's the laziest wrong implementation?", "what's the narrowest fix that leaves siblings broken?" Then apply the **type matrix check**: enumerate the distinct input types (file extensions, parameter combinations, engine paths) that exercise different code paths. If a feature applies to both `.ts` and `.vue` files, test both as inputs *and* outputs — don't assume symmetry. If different combinations flow through different engine methods or translation layers, they need separate ACs. Apply the split test: if the ACs contain two independently-shippable slices of user value, split into separate specs with the user (a high AC count is a hint to run this test, not a limit — see template guidance). Splitting is about size, not over-build — check the shape against the minimal-shape principle in `docs/design-principles.md`.
   - **Bugs:** Describe the fix — what to change and where. Bugs don't have ACs; the Expected section defines the target behaviour. Verification criteria go in Done-when ("reproduction case now produces expected output", "regression test covers the failing case"). The fix is dispatched as a single unit to the execution agent.
   - Do NOT proceed past this step without user agreement.

4. **Write the file and fill the remaining template sections per their prompts.** Copy the chosen template, drop in the agreed Behaviour/Fix content, and fill every other section by following its prompt in the template: Context/Symptom, User intent, Value/Effort, Relevant files + Red flags, Interface, Open decisions, Security, Edges, Done-when. Change-only sections (User intent, Interface) are marked `N/A` for bugs. The template prompts are the authority on each section's content — do not restate them here. Two things carry across all of them:
   - **Raise blockers, don't bury them.** If filling a section surfaces a blocker — low value against high effort, an internal contradiction, an architectural fork with different correctness/risk profiles that belongs in Open decisions — stop and raise it with the user before finalizing. Never write "the executor should choose": Open decisions must be resolved before the spec can be picked up.
   - **Populate from what you already read.** Relevant files, Red flags, and Interface bounds come from the code you explored while drafting the ACs — it's nearly free. If an operation wraps a compiler/external API, read the API source to answer the Interface questions rather than guessing.

5. **Cross-cutting checks.** These span sections and need active judgment, so they run as their own pass rather than folding into a section fill. They are three separate checks — record an outcome for **each** before moving on, because a step that reads as done after one of them is how the other two get skipped:
   - **Test hotspot.** Check the test files this spec will touch. If any are at or near the threshold in `docs/code-standards.md`, assess them with its test refactoring hierarchy and add a prep step to refactor them before adding new tests. Name the file each new test lands in — "a new scenario file" or "beside the existing cases" is a decision, not a detail.
   - **Layer-fit.** For each *unit of verification* — an AC on a change spec, an **adjacent input in the Fix section on a bug spec** — decide whether the behaviour is a pure function of its inputs (extract a helper, unit-test it directly) or needs real I/O / project graph / workspace state (one smoke test per wiring path), and record that next to the unit so the execution agent doesn't default to the existing test style. Bug specs have no ACs; running this check against the adjacent inputs instead is what keeps it from silently no-opping on the bug template.
   - **Design-shape.** Check the Interface against `docs/design-principles.md`: a new CLI action / socket handler / transport entry point stays thin (translate input, call one named function, format output) with the logic behind a seam testable with `InMemoryFileSystem`; export the entry point, not its helpers; new file reads/writes go through the `FileSystem` port, not `node:fs`.

6. **Subtractive review — cut to the minimal shape.** Every other step adds structure; this one removes it. Review the whole drafted spec against the **Minimal shape** principle in `docs/design-principles.md`.
   - **Write the skeleton first.** State the smallest change that satisfies the User intent — the fewest ACs, types, modules, and commands that deliver it. Anchor on this *before* judging what you drafted, so you argue up from minimal rather than down from what you built.
   - **Diff the spec against the skeleton.** List every element beyond it: each new type, module, builder, classification, AC, and extra command or engine path.
   - **Justify or cut each surplus element.** Keep it only if a *present* force requires it — instances that exist now, or consistency with a pattern the codebase already uses. "A future matrix", "we'll want it later", or "for symmetry" is not a force: cut the element, or defer it to a follow-on `[needs design]` handoff entry (step 8).
   - **Produce a cut-list** of what you removed or deferred, and carry it to step 9. Do NOT write it into the spec file — it is transient. If the cut-list is empty on a spec that introduces new structure, you have not run the review; run it again.

7. **Prose-versus-executed check — the spec's own review pass.** Every claim about behaviour must be executed by something, or it is decoration. Prose in a spec is read and agreed with; only the units something runs are enforced. This repo has already paid for the difference: the same defect shipped three times because a behavioural guarantee ("the two engines give the same answer") lived in prose the executor read, agreed with, and then shipped the violation of.

   Walk the drafted spec and, for **every** behavioural claim in Behaviour/Fix, Edges, and any decision record, name the AC, adjacent input, or Done-when line that would fail if the claim were false. Write the gaps into the spec — as a new unit of verification, or a Done-when item — rather than leaving them as sentences.

   Three recurring shapes, all of which have shipped defects here:
   - **A claim with no case.** "X keeps using the old path", "the other engine is untouched" — asserted in prose, checked by nothing.
   - **A list Done-when undercounts.** Adjacent inputs or ACs enumerate five, Done-when says "the three cases above". The remainder is prose.
   - **An uncovered cell.** Build the matrix of behaviours × the paths that can serve them (engines, file types, parameter combinations). Every cell holds a unit of verification or a written reason it is empty. An empty unexplained cell is where the defect lands — that is where all three instances of the repeat defect landed.

8. **Update handoff.md.** Change the entry from `[needs design]` to a link to the new spec file. Remove inline ACs or description that moved to the spec — the handoff entry becomes one line. Add any elements the subtractive review deferred as new `[needs design]` entries.

9. **Confirm with the user.** Show a summary of the spec before finishing:
   - **Changes:** Number of ACs, key interface decisions
   - **Bugs:** Fix approach summary, verification criteria in Done-when
   - Any open decisions surfaced while filling the spec
   - The subtractive-review cut-list from step 6, and the gaps step 7 closed — what you removed or deferred and why, or note the spec was already minimal
   - Ask: "Ready to implement, or want to revise?"

10. **Report for commit.** Tell the caller that the spec file and the updated handoff.md are ready to commit with message `docs(specs): add spec for [short-title]`. **Do NOT commit until the user has explicitly signed off on the spec.** The spec agent does not commit directly — the orchestrator or user handles the commit. A premature commit forces amends or reverts when the user requests changes, which is wasteful and error-prone.
