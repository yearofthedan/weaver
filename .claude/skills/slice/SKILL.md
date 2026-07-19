---
name: slice
description: Pick up the next task — if it needs a spec, create one first; if it has a spec, implement it. The default entry point for getting work done.
metadata:
  internal: true
---

# Slice Workflow

## Agent model

Steps 1-2 and 4-10 run in the main conversation (interactive spec and review work). Step 3 dispatches ACs to `execution-agent` (defined in `.claude/agents/`), grouped by neighbourhood — ACs that touch the same files go in one call — and **reviews each batch in the main conversation before dispatching the next**.

---

1. **Find the task.** Read `docs/handoff.md` — identify the first task by priority. Do not skip items or search `docs/specs/` for existing specs; the first item in the queue is the task, whatever its state.
   - **Has a spec link** → go to step 2.
   - **`[needs investigation]` (no confirmed root cause)** → switch to the `/investigate` workflow: reproduce the failure, observe the mechanism, record a confirmed root cause in a bug spec, then route the fix back here (`/slice`) or to `/spec`. Do not begin implementation until the root cause is confirmed.
   - **`[needs design]` (no spec)** → switch to the `/spec` workflow: create a spec file from the appropriate template, walk through ACs with the user, update handoff.md with the spec link. After the spec is created, **commit the spec file and updated handoff.md** with message `docs(specs): add spec for [short-title]`. Do not begin implementation with an uncommitted spec. Then continue to step 2.
   - **Legacy inline ACs (no spec file, no `[needs design]` tag)** → ask the user: create a spec first, or proceed with inline ACs?

   **Reclassification guard.** A `[needs investigation]` or `[needs design]` task cannot be downgraded to a direct fix because you *believe* you already know the root cause or the design. The tag is lowered only by running the discipline (`/investigate` or `/spec`) and recording its result — never by asserting the answer to skip the step.

2. **Read the spec.** Open the linked spec file. Confirm the task and its ACs with the user BEFORE writing any code.

3. **Resolve open decisions and implement.** Before dispatching any execution agent, capture the current HEAD: `git rev-parse HEAD`. Store this as `<baseline-sha>` — the per-batch reviews below and the final pass (step 4) compare against it. Also note HEAD before each individual batch, so you can review just that batch's commits. Then check the spec for an `## Open decisions` section or any language deferring implementation choices (e.g. "the executor should choose", "either approach works"). These are architectural forks that must be resolved before dispatching to the execution agent.

   For each unresolved decision:
   - Read the relevant source files to understand the current architecture
   - Evaluate the approaches against the system's existing patterns and constraints
   - If the user is in the loop, present the tradeoffs and get their call
   - If autonomous, choose the approach that prioritises correctness over convenience

   **Document the decision** in the spec file: replace the open question with the chosen approach, the reasoning, and the consequences (what this enables, what it rules out, what to watch for). This becomes the implementation instruction for the execution agent. Never forward an unresolved architectural fork to the execution agent — it is optimised for mechanical code changes, not design judgment.

   **Changes: group ACs by neighbourhood.** Look at which files each AC touches. ACs that modify the same area of the codebase (same directory, same source+test pair) go in one dispatch. ACs that jump to a different area start a new dispatch.

   For each batch, dispatch one `execution-agent` call with:
   - The spec file path
   - Which ACs to implement (quote the AC text for each)
   - Explicit instruction: "Use `/implementation-context` before writing code. Implement each AC in order — write failing tests, implement, run `pnpm check` (this includes coverage — check that lines touched by this AC are covered before committing), commit, then move to the next AC. Stop after the last AC in this batch. Do not reference AC numbers, spec slugs, or task identifiers in code or comments — describe behaviour, not the changeset. Only add a comment when the code cannot speak for itself; do not narrate what the code obviously does."
   - Any context from previous batches (e.g. files already created, patterns established)

   Each AC still gets its own commit. The agent reads the neighbourhood once and carries context across ACs in the batch.

   **Bugs: dispatch the fix as a single unit.** Bug specs have a Fix section (not ACs) and verification in Done-when. Dispatch one `execution-agent` call with:
   - The spec file path
   - Explicit instruction: "Apply the fix described in the Fix section. Write a regression test for the reproduction case. Verify Done-when criteria. Run `pnpm check`, commit, then stop."

   After each batch, before dispatching the next:
   - **Read the agent's notes file** from `.claude/agent-notes/` — the file itself, not the completion summary the agent hands back (that summary is lossy and buries self-review catches). It logs deviations, assumptions, surprises, and self-corrections as they happen. Mine it for batch-specific issues *and* generalisable learnings to promote in step 8
   - Verify the batch's commits exist and `pnpm check` passes
   - **Review the batch.** Run `/review-changes <this-batch-start-sha>..HEAD` on just this batch's commits and apply the fixes before moving on. Reviewing per batch — not once at the end — catches issues while they are cheap: before later batches build on them, and especially before a destructive or irreversible batch (deletions, migrations, dependency removal) runs against a problem the build-up introduced. It also surfaces problems through interactive follow-up that a single end-of-slice pass misses. Scrutinise anything the execution agent did beyond the batch's stated scope.
   - If the agent reported assumptions or spec mismatches, decide whether to adjust the next batch's instructions, fix something, or ask the user

4. **Final cross-batch review pass.** The per-batch reviews in step 3 do the heavy lifting; this pass catches interactions *between* batches that no single batch review could see (e.g. a late batch deletes something an early batch still depends on). Run `/review-changes <baseline-sha>..HEAD` over the whole task, apply any fixes, and commit. For a single-batch task the per-batch review already covered this — the final pass is then redundant. Skip entirely for `[chore]` tasks.

5. **Run mutation testing on every new or significantly modified source file.** This step is not optional and cannot be deferred to a follow-up task.
   ```bash
   pnpm test:mutate:file src/path/to/changed.ts
   ```
   The threshold is an alarm that quality is failing — it is not a target to coast to. For each survivor, ask: what does this tell me about the code? Then classify: (a) real gap — write the missing test and commit, (b) noise — the mutant is structurally unreachable, document exactly why, or (c) dead code — remove the branch. "We hit 75%" is not a classification. Every survivor gets one. Commit the updated `reports/stryker-incremental.json` after the run.

6. **Verify the behaviour — the gate before anything else.** Not "unit tests pass" and not "`pnpm check` is green": drive the change on its real path (CLI, daemon, live-model eval, host) and observe it does what the spec says. If that path can't run in-session (missing credential, unavailable service), the task is **BLOCKED** — it stays in the queue, nothing is archived, no Outcome is written, you surface the blocker. Verification is yours; never delegate it to a human "later". No step past here runs until this passes.

7. **Complete the spec's Done-when checklist.** Walk through every item in the spec's Done-when section (defined by the template — see `docs/specs/templates/change.md` or `bug.md`). Additionally:
   - [ ] **Standards check.** For every file you extended, walk through `docs/code-standards.md`. Apply the refactoring hierarchy if needed. This is the checkpoint that catches implementation-time bloat; do NOT defer it to a future task.
   - [ ] **Remove** the handoff.md task entry entirely — handoff.md is a work queue, not a history. Do not mark it shipped, do not leave a link to the archive. Just delete the line. Update the "Current state" section (test count, layout changes) if needed.
   - [ ] If public surfaces changed, update the corresponding docs (the spec's Done-when checklist specifies which)

8. **Archive the spec with reflection.** Move the spec file from `docs/specs/` to `docs/specs/archive/`. Append an `## Outcome` section with:
   - **Verification:** the real path you exercised and what you observed (actual result / rates / output)
   - **Reflection:** What went well? What did not go well? What took longer than it should have? What would you recommend to the next agent picking up related work?
   - Actual test count added
   - Mutation score for touched files
   - Any architectural decisions or discoveries worth preserving

   **Do NOT proceed to step 9 until the Outcome section — including the Reflection — is written in the archived spec file.**

9. **Harvest learnings and capture gotchas.** Read the batch's notes under `.claude/agent-notes/` *and* any entries the agent wrote under `.claude/agent-memory/`. Neither path is git-tracked — a "durable" learning left there is lost on the next container rebuild, so it must be promoted here or it is lost. For each finding: put a non-obvious *gotcha* in the relevant `docs/internals/` or `docs/tech/` doc (add a code comment if it is visible at the call site); fold a generalisable *discipline* into the doc that already owns that topic (e.g. a test-writing lesson → `docs/code-standards.md`) rather than adding a new standalone rule. Do this every slice, not only when prompted — agents generate learnings continuously and the default path drops them on the floor.

9. **Commit** docs changes with a conventional commit message (see `CLAUDE.md`).

10. Do NOT proceed to the next slice without explicit user approval.
