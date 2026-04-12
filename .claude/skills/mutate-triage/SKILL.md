---
name: mutate-triage
description: Triage surviving mutants after a Stryker run — classify each as known, noise, or fixable, then open GitHub issues for noise and fix branches for fixable gaps.
metadata:
  internal: true
---

# Mutation Triage

You are triaging surviving mutants after a Stryker mutation test run that fell below the 75% break threshold. Your job: classify each survivor and take the right action for each one.

## Step 1 — Verify the report exists

Check that `reports/mutation/mutation.json` exists. If it does not:
- Print: `ERROR: Stryker JSON report not found at reports/mutation/mutation.json. The mutation run may have crashed before writing output.`
- Stop here. Do not create any issues or branches.

## Step 2 — Read the report and quality baseline

1. Read `reports/mutation/mutation.json`. Parse the top-level `metrics.mutationScore` field.
   - If `mutationScore >= 75`, print "Score is above threshold — no triage needed." and stop.
2. Collect all mutants where `status` is `"Survived"` or `"NoCoverage"`. Ignore `"Killed"`, `"Timeout"`, and `"CompileError"`.
3. Read `docs/quality.md` — specifically the "Known surviving mutants", "Accepted / low-risk", and "Hard-won mutation lessons" sections. You will use these as your classification reference.

Each relevant mutant has these fields:
- `sourceFilePath` — e.g. `src/providers/ts.ts`
- `location.start.line` — 1-indexed line number
- `mutatorName` — e.g. `ConditionalExpression`, `ArithmeticOperator`, `NoCoverage`
- `replacement` — the mutated code snippet; may be empty string for `NoCoverage`

## Step 3 — Classify each survivor

For each surviving mutant, assign one of three classifications:

**known** — The mutant's file, line, and operator semantically match an entry already listed in the "Known surviving mutants" or "Accepted / low-risk" tables in `docs/quality.md`. No action needed.

**noise** — The mutant is NOT explicitly listed in quality.md, but it matches a pattern described in the "Hard-won mutation lessons" section (examples: caching guard like `if (!project) → if (true)`, equivalent arithmetic, defensive null guard where the TS LS never returns null, `NoCoverage` in a subprocess-only code path). These should be accepted but aren't documented yet.

**fixable** — Anything that doesn't fit "known" or "noise". A new surviving mutant where the mutated code path CAN be exercised by a test.

If you are uncertain between noise and fixable, prefer **fixable** — let tests decide.

## Step 4 — Act on noise survivors

For each group of noise survivors (group by: same file + same noise pattern type):

Create one GitHub issue:

```
gh issue create \
  --title "Mutation survivors: <file> — <pattern-type>" \
  --body "<body>"
```

Issue body format:
```markdown
## Surviving mutant(s): <sourceFilePath>

| Line | Operator | Replacement | Rationale |
|------|----------|-------------|-----------|
| 17 | ConditionalExpression | `if (true)` | Caching guard — always rebuilding is slower but produces identical results. |

**Suggested action:** add to "Accepted / low-risk" table in `docs/quality.md`.
```

## Step 5 — Act on fixable survivors

If there are fixable survivors:

1. Determine today's date (run `date +%Y%m%d`).
2. Choose a slug from the most-affected source file's basename (e.g. `ts-project` from `src/utils/ts-project.ts`).
3. Pick a branch name: `fix/mutation-<yyyymmdd>-<slug>`. If that branch already exists, append `-2`, `-3`, etc.
4. Create the branch: `git checkout -b <branch-name>`
5. For each fixable survivor, read the source file around the surviving line to understand what the code does. Write new tests in the corresponding test file that exercise the mutated code path and would fail if the mutant were introduced.
   - Follow the test patterns established in `docs/quality.md` (the "Test design patterns" section).
   - One test per survivor is the minimum — add boundary cases where relevant.
6. Run `pnpm check`. If it fails, read the error output, fix the issue, and re-run. Iterate until it passes. Do not open a PR with failing tests.
7. Once `pnpm check` passes, commit: `git add -A && git commit -m "test: kill surviving mutants in <slug>"`
8. Push: `git push -u origin <branch-name>`
9. Open a draft PR:

```
gh pr create --draft \
  --title "fix: kill surviving mutants — <slug>" \
  --body "<body>"
```

PR body format:
```markdown
## Mutation triage: fix surviving mutants

Score before: XX.X% · Break threshold: 75%

### Survivors addressed

| File | Line | Operator | Test added |
|------|------|----------|------------|
| src/utils/ts-project.ts | 42 | ConditionalExpression | `it("returns null when tsconfig walk reaches root")` |

Run `pnpm test:mutate` to confirm score improvement.
```

## Step 6 — Report summary

After all actions are complete, print a summary:
```
Triage complete.
  Known (no action):   <N>
  Noise → issues:      <N> (issues: #..., #...)
  Fixable → PR:        <N> (branch: fix/mutation-..., PR: #...)
```

## Constraints

- Never push to `main` or `master`.
- Never create issues for `"Killed"`, `"Timeout"`, or `"CompileError"` mutants.
- If you run out of turns before addressing all fixable survivors, commit what you have, push, open the PR, and note the remaining unaddressed survivors in the PR body under a "Not addressed in this run" section.
- Do not modify `docs/quality.md` directly — the issue you create is the signal that a human should update it.
- After any mutation run, commit the updated `reports/stryker-incremental.json` cache file. This is committed to the repo so future runs (local and CI) reuse results for unchanged mutants. Use `pnpm test:mutate:file <path>` for targeted runs — results accumulate across runs.
