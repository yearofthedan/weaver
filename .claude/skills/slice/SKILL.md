---
name: slice
description: Pick up the next task — if it needs a spec, create one first; if it has a spec, implement it. The default entry point for getting work done.
---

# Slice Workflow

## Agent model

This workflow delegates to two custom subagents defined in `.claude/agents/`:

- **`spec-agent`** (Opus) — reasoning work: creates specs, reviews architecture, security, and documentation.
- **`execution-agent`** (Sonnet) — implementation work: writes code against a spec, runs tests, commits.

Delegate steps 1-2 to `spec-agent`. Steps 3-6 are dispatched **one AC at a time** to `execution-agent` — see details below. Steps 7-9 go to `spec-agent`.

---

1. **Find the task.** Read `docs/handoff.md` — identify the first task by priority.
   - **Has a spec link** → go to step 2.
   - **`[needs design]` (no spec)** → switch to the `/spec` workflow: create a spec file from the appropriate template, walk through ACs with the user, update handoff.md with the spec link. Then return here at step 2.
   - **Legacy inline ACs (no spec file, no `[needs design]` tag)** → ask the user: create a spec first, or proceed with inline ACs?

2. **Read the spec.** Open the linked spec file. Confirm the task and its ACs with the user BEFORE writing any code.

3. **Implement one AC at a time.** For each AC in the spec's Fix/Behaviour section, dispatch a **single** `execution-agent` call with:
   - The spec file path
   - Which AC to implement (quote the AC text)
   - Explicit instruction: "Write failing tests, implement, run `pnpm check`, run `pnpm test:mutate` on the source files you changed (add tests if below threshold), commit, then stop."
   - Any context from previous ACs (e.g. files already created, patterns established)

   **Do NOT batch multiple ACs into one agent call.** Each call produces one commit. After each call, verify the commit exists and `pnpm check` passes before dispatching the next AC.

4. **Complete the spec's Done-when checklist.** Delegate to `spec-agent`. Walk through every item in the spec's Done-when section (defined by the template — see `docs/specs/templates/change.md` or `bug.md`). Additionally:
   - [ ] **Remove** the handoff.md task entry entirely — handoff.md is a work queue, not a history. Do not mark it shipped, do not leave a link to the archive. Just delete the line. Update the "Current state" section (test count, layout changes) if needed.
   - [ ] If public surfaces changed, update the corresponding docs (the spec's Done-when checklist specifies which)

5. **Archive the spec.** Move the spec file from `docs/specs/` to `docs/specs/archive/`. Append an `## Outcome` section with:
   - Actual test count added
   - Mutation score for touched files
   - Any architectural decisions or discoveries worth preserving
   - Anything surprising that came up during implementation

6. **Update `docs/agent-memory.md`** with any non-obvious gotchas discovered.

7. **Commit** docs changes with a conventional commit message (see `CLAUDE.md`).

8. Do NOT proceed to the next slice without explicit user approval.
