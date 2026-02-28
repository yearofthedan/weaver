---
name: slice
description: Execute the next vertical slice from handoff.md — confirms the task, writes failing tests first, implements, runs tests + lint, commits, and updates docs.
---

# Next Slice Workflow

1. Read `docs/handoff.md` — identify the FIRST uncompleted task
2. Confirm the exact task with the user BEFORE writing any code. If the task has no acceptance criteria, draft them with the user before proceeding.
3. **Write failing tests first.** For each test:
   - State in the `it`/`describe` label what specific behaviour is being specified
   - Ask: "What would have to be wrong in the implementation for this test to still pass?" Add at least one assertion that answers that — pin exact values, boundary conditions, or the absence of something
   - A test that only verifies a result exists is incomplete — assert the shape, a boundary case, and at least one error/edge path
   - Before moving to implementation: review the test file as a whole. Would a logic inversion (`>` → `>=`, `+` → `-`, a null guard flipped) survive undetected? If yes, add a test that would catch it.
4. Implement the minimum code to make each test pass, one at a time
5. Run `pnpm check` (biome check + build + test) — all must pass before continuing
6. Run `pnpm test:mutate` scoped to the files changed in this slice. If the score is below threshold, add tests — do not adjust the threshold or add survivors to `docs/quality.md` without explaining why the gap is accepted.
7. **Doc sync** — run through this checklist before committing:
   - [ ] Remove the completed slice from `docs/handoff.md`; update the "Current state" section (test count, layout changes)
   - [ ] **MCP tool added/renamed/removed** → update `README.md` tool table and `docs/features/mcp-transport.md` tool table
   - [ ] **CLI command added/renamed/removed** → update `README.md` CLI Commands section and `docs/features/cli.md`
   - [ ] **Error code added/removed** → update `README.md` Error codes section
   - [ ] **Source layout changed** (new file, renamed/moved file) → update `README.md` Project structure and `docs/handoff.md` "Current state" layout
   - [ ] **Any other feature doc** that references changed code: update it
8. Update `docs/agent-memory.md` with any architectural decisions or non-obvious gotchas discovered
9. Commit with a conventional commit message (see `CLAUDE.md`)
10. Do NOT proceed to the next slice without explicit user approval
