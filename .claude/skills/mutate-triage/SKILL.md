---
name: mutate-triage
description: Triage surviving mutants after a Stryker run — classify each as known, refactor (dead branch), noise, or fixable, then remove dead branches, open issues for noise, and create fix branches for fixable gaps.
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

For each surviving mutant, assign one of four classifications:

**known** — The mutant's file, line, and operator semantically match an entry already listed in the "Known surviving mutants" or "Accepted / low-risk" tables in `docs/quality.md`. No action needed.

**refactor** — The mutant survives because the branch it mutates cannot be triggered by any realistic input (e.g. a null guard on a value the type system already guarantees non-null, a boundary condition at a position no real input ever reaches). The code itself is the problem, not the test gap. See `docs/code-standards.md` §"Defensive code vs. dead branches" — remove the branch and the mutant disappears. Prefer this over **noise** whenever the code can be restructured.

**noise** — The mutant is NOT explicitly listed in quality.md, and the guarded branch genuinely CAN be triggered in production but not in test infrastructure (example: `NoCoverage` in a subprocess-only code path, caching guard where bypassing would still produce correct results). Distinct from **refactor**: the code is load-bearing in production; the test harness just can't reach it. Match against patterns in the "Hard-won mutation lessons" section of quality.md.

**fixable** — Anything that doesn't fit the above. A new surviving mutant where the mutated code path CAN be exercised by a test.

If you are uncertain between noise and fixable, prefer **fixable** — let tests decide. If you are uncertain between refactor and noise, prefer **refactor** — restructuring the code is almost always the better fix than documenting an accepted survivor.

## Step 4 — Act on refactor survivors

Refactor survivors indicate dead code. Do NOT open an issue; do NOT document them in quality.md. Remove the guard, run the tests, confirm the mutant disappears.

For each refactor survivor:

1. Read the source around the surviving line.
2. Identify the unreachable branch. Common shapes:
   - Null guard on an API return that the types already guarantee non-null
   - Boundary check (`>=` vs `>`) at a position no real input reaches
   - `decl[0]` after a `decl.length === 0` check (merge with destructuring)
3. Restructure — prefer APIs that return narrower types, identity equality over position equality, destructuring over index access.
4. Run `pnpm check` and rerun the mutation test on the file. The mutant should no longer appear.
5. Commit as `refactor: remove dead branch in <file>` — not a test commit.

If after restructuring you still can't make the branch reachable AND the production code genuinely needs it (not just a type-level appeasement), reclassify as **noise** and proceed to Step 5.

## Step 5 — Act on noise survivors

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

## Step 6 — Act on fixable survivors

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

## Step 7 — Report summary

After all actions are complete, print a summary:
```
Triage complete.
  Known (no action):      <N>
  Refactor → committed:   <N> (commits: <sha>, <sha>)
  Noise → issues:         <N> (issues: #..., #...)
  Fixable → PR:           <N> (branch: fix/mutation-..., PR: #...)
```

## Constraints

- Never push to `main` or `master`.
- Never create issues for `"Killed"`, `"Timeout"`, or `"CompileError"` mutants.
- If you run out of turns before addressing all fixable survivors, commit what you have, push, open the PR, and note the remaining unaddressed survivors in the PR body under a "Not addressed in this run" section.
- Do not modify `docs/quality.md` directly — the issue you create is the signal that a human should update it.
- After any mutation run, commit the updated `reports/stryker-incremental.json` cache file. This is committed to the repo so future runs (local and CI) reuse results for unchanged mutants. Use `pnpm test:mutate:file <path>` for targeted runs — results accumulate across runs.
