# Next Slice Workflow

1. Read docs/handoff.md — identify the FIRST uncompleted task
2. Confirm the exact task with the user BEFORE writing any code
3. Write failing tests first that define the expected behaviour
4. Implement the minimum code to make each test pass, one at a time
5. Run `pnpm test` — all tests must pass before continuing
6. Run `pnpm lint`
7. Commit with a conventional commit message
8. Mark the task complete in docs/handoff.md
9. Update .claude/MEMORY.md and docs/agent-memory.md with any architectural decisions made
10. Do NOT proceed to the next slice without explicit user approval
