---
name: slice
description: Execute the next vertical slice from handoff.md — confirms the task, writes failing tests first, implements, runs tests + lint, commits, and updates docs.
---

# Next Slice Workflow

1. Read docs/handoff.md — identify the FIRST uncompleted task
2. Confirm the exact task with the user BEFORE writing any code
3. Write failing tests first that define the expected behaviour
4. Implement the minimum code to make each test pass, one at a time
5. Run `pnpm check` (this runs biome check + build + test all together) — all must pass before continuing
6. Remove the completed slice from docs/handoff.md and update the "Current state" section (test count, layout changes)
7. Update docs/agent-memory.md with any architectural decisions made
8. Commit with a conventional commit message
9. Do NOT proceed to the next slice without explicit user approval
