---
name: slice
description: Pick up the next task — if it needs a spec, create one first; if it has a spec, implement it. The default entry point for getting work done.
---

# Slice Workflow

1. **Find the task.** Read `docs/handoff.md` — identify the first task by priority.
   - **Has a spec link** → go to step 2.
   - **`[needs design]` (no spec)** → switch to the `/spec` workflow: create a spec file from the appropriate template, walk through ACs with the user, update handoff.md with the spec link. Then return here at step 2.
   - **Legacy inline ACs (no spec file, no `[needs design]` tag)** → ask the user: create a spec first, or proceed with inline ACs?

2. **Read the spec.** Open the linked spec file. Confirm the task and its ACs with the user BEFORE writing any code.

3. **Write failing tests first.** For each AC in the spec's Behaviour/Fix section:
   - Structure labels as `describe(capability) > describe(logical grouping) > it(behaviour)`. Never reference AC numbers or spec identifiers — specs are changesets that get archived; test labels are permanent.
     ```
     // ✗ copies the spec's task-tracking structure into permanent code
     describe("AC1 — in-project cleanup") { ... }

     // ✓ describes the operation's natural shape
     describe("deleteFile") {
       describe("in-project TS/JS files") {
         it("removes named imports and type-only import declarations")
         it("removes re-export declarations (export * and named re-exports)")
       }
       describe("out-of-project TS/JS files") {
         it("removes imports from files outside tsconfig include")
       }
     }
     ```
   - Ask: "What would have to be wrong in the implementation for this test to still pass?" Add at least one assertion that answers that — pin exact values, boundary conditions, or the absence of something
   - A test that only verifies a result exists is incomplete — assert the shape, a boundary case, and at least one error/edge path
   - Use the spec's **Interface** section to inform bounds testing and the **Edges** section for regression tests
   - Before moving to implementation: review the test file as a whole. Would a logic inversion (`>` → `>=`, `+` → `-`, a null guard flipped) survive undetected? If yes, add a test that would catch it.

4. **Implement** the minimum code to make each test pass, one at a time.

5. **Run `pnpm check`** (biome check + build + test) — all must pass before continuing.

6. **Run `pnpm test:mutate`** scoped to the files changed in this slice. If the score is below threshold, add tests — do not adjust the threshold or add survivors to `docs/quality.md` without explaining why the gap is accepted.

7. **Complete the spec's Done-when checklist.** Walk through every item in the spec's Done-when section (defined by the template — see `docs/specs/templates/change.md` or `bug.md`). Additionally:
   - [ ] **Remove** the handoff.md task entry entirely — handoff.md is a work queue, not a history. Do not mark it shipped, do not leave a link to the archive. Just delete the line. Update the "Current state" section (test count, layout changes) if needed.
   - [ ] If public surfaces changed, update the corresponding docs (the spec's Done-when checklist specifies which)

8. **Archive the spec.** Move the spec file from `docs/specs/` to `docs/specs/archive/`. Append an `## Outcome` section with:
   - Actual test count added
   - Mutation score for touched files
   - Any architectural decisions or discoveries worth preserving
   - Anything surprising that came up during implementation

9. **Update `docs/agent-memory.md`** with any non-obvious gotchas discovered.

10. **Commit** with a conventional commit message (see `CLAUDE.md`).

11. Do NOT proceed to the next slice without explicit user approval.
