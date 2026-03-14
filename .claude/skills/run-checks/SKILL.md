---
name: run-checks
description: Use this skill when running pnpm check, pnpm test, or any long-running command. Captures output with tee so you never re-run a command just to see different parts of the output.
---

# Running checks and tests

## Golden rule: capture once, read many

Long-running commands (`pnpm check`, `pnpm test`, `pnpm build`) produce large output. **Never re-run a command just to see a different section of the output.** Every re-run wastes minutes and tokens.

Always capture with `tee` on the first run:

```bash
pnpm check 2>&1 | tee /tmp/check.log
```

Then use the `Read` tool on `/tmp/check.log` to inspect any section — failures, summary, specific lines. No second run needed.

## Scoped test runs first

When working on a specific file, run only the relevant tests before running the full suite:

```bash
pnpm test tests/path/to/relevant.test.ts 2>&1 | tee /tmp/test.log
```

Only run the full `pnpm check` once, after all code changes are complete and scoped tests pass.

## What NOT to do

- `pnpm test 2>&1 | grep "FAIL" | head -50` — runs the full suite, discards most output, then you need to re-run to see details
- `pnpm test 2>&1 | tail -20` — same problem: runs everything, keeps 20 lines
- Running `pnpm check` multiple times in sequence hoping for different output
- Running `pnpm test` without `tee` and then re-running to read a different section
