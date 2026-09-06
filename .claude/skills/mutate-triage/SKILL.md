---
name: mutate-triage
description: Triage surviving mutants from a Stryker run — classify each as known, refactor (dead branch), noise, or fixable, then remove dead branches, record noise, and write the tests that close real gaps. Use after any mutation run, whether it covered one file or the whole project.
metadata:
  internal: true
---

# Mutation Triage

Classify every surviving mutant in scope and take the right action for each. The classification, and what it demands of you, are the same whoever called this skill; only *where the record goes* and *how the work is delivered* differ, and the caller supplies those.

## What the caller supplies

Three things. If the caller did not say, ask — do not guess.

- **Scope.** Which mutants to triage: one file's survivors (a change in flight), or every survivor in the report (a project-wide sweep).
- **How to record a noise survivor.** A comment at the line, or a tracking issue. See Step 5.
- **How to deliver the work.** A commit on the current branch, or a branch and a PR. See Step 6.

**There is no score threshold here.** A project-wide score says nothing about the file you just wrote — a new module can sit at 54% while the project reports 79%, because the rest of the codebase carries the average. Triage the scope you were given whatever any score says. Deciding *whether* to run at all belongs to the caller.

## Step 1 — Verify the report exists

Check the Stryker JSON report exists (`reports/mutation/mutation.json` for the src lane, `reports/mutation-eval/mutation.json` for the eval lane). If it does not:

- Print: `ERROR: Stryker JSON report not found at <path>. The mutation run may have crashed before writing output.`
- Stop here. Take no other action.

## Step 2 — Read the report and the quality baseline

1. Read the report. Collect mutants whose `status` is `"Survived"` or `"NoCoverage"`, restricted to the scope you were given. Ignore `"Killed"`, `"Timeout"` and `"CompileError"`.
2. Read `docs/quality.md` — the "Known surviving mutants", "Accepted / low-risk" and "Hard-won mutation lessons" sections. These are your classification reference.

Each relevant mutant carries `sourceFilePath`, `location.start.line` (1-indexed), `mutatorName` (e.g. `ConditionalExpression`), and `replacement` (the mutated snippet; empty for `NoCoverage`).

## Step 3 — Classify each survivor

Every survivor gets exactly one of four classifications. "The score is high enough" is not a classification.

**known** — File, line and operator semantically match an entry already in `docs/quality.md`'s "Known surviving mutants" or "Accepted / low-risk" tables. No action.

**refactor** — The branch cannot be triggered by any realistic input (a null guard on a value the types already guarantee, a boundary at a position no input reaches). The code is the problem, not the test gap. See `docs/code-standards.md` §"Defensive code vs. dead branches".

**noise** — Not listed in quality.md, and the branch genuinely *can* be triggered in production but not from test infrastructure (a subprocess-only path; a compiler-host method invoked only during dependency discovery). Distinct from **refactor**: the code runs in production, the harness just cannot reach it.

**fixable** — Anything else. A survivor whose mutated path a test *can* exercise.

Tie-breaks: uncertain between noise and fixable, prefer **fixable** — let a test decide. Uncertain between refactor and noise, prefer **refactor** — restructuring beats documenting an accepted survivor.

## Step 4 — Act on refactor survivors

Dead code. Do not record it anywhere; remove it.

1. Read the source around the surviving line.
2. Identify the unreachable branch. Common shapes: a null guard on an API return the types already narrow; `>=` vs `>` at a position no input reaches; `decl[0]` after a `decl.length === 0` check.
3. Restructure — prefer APIs returning narrower types, identity over position equality, destructuring over index access.
4. Run `pnpm check`, then re-run mutation on the file. **The mutant must be gone.** If it is not, the branch was reachable after all — reclassify.
5. Commit as `refactor: remove dead branch in <file>` — not a test commit.

If you cannot make the branch reachable and production genuinely needs it, reclassify as **noise**.

## Step 5 — Act on noise survivors

A noise survivor needs a durable record of *why* it cannot be killed. Without one the next run re-triages it from scratch, and a real gap hiding among them stays invisible.

Whatever form the caller asked for, the record names the file, the line, the operator, and the reason the harness cannot reach the path. Write that reason in terms of the code's behaviour — a reader should learn why the method exists and who calls it, not that a mutant survived. Group survivors sharing one cause into one record.

Do not edit `docs/quality.md` directly; a human curates those tables.

## Step 6 — Act on fixable survivors

For each, read the source around the surviving line, then write tests in the corresponding test file that exercise the mutated path.

- Follow the test patterns in `docs/quality.md` ("Test design patterns").
- One test per survivor minimum; add boundary cases where relevant.
- **Verify the kill, don't assume it.** A test written against a survivor has no red phase — the code it targets already works, so it goes green the moment you write it and tells you nothing. Before counting a survivor closed, make it fail: apply the mutant by hand, or revert the line it targets, and confirm *that specific test* reds. One that stays green is not reaching the line.
- **If the re-run still shows the mutant, the report is right.** When a survivor or `NoCoverage` entry persists after you added a test claiming to exercise it, that contradiction *is* the finding. Resolve it by fixing or deleting the test — never by reclassifying the mutant as unreachable. A test asserting it drives a path, sitting beside a report saying nothing does, is precisely the shape of coverage that is not there.

Then run `pnpm check` and iterate until it passes. Deliver the work in the form the caller asked for.

## Step 7 — Report

```
Triage complete (scope: <what you triaged>).
  Known (no action):    <N>
  Refactor → removed:   <N> (commits: <sha>...)
  Noise → recorded:     <N> (<where>)
  Fixable → tests:      <N>
  Score: <before> → <after>
```

State any survivor you could not classify, and why. An unclassified survivor is an open question, not a rounding error.

## Constraints

- Never create issues or records for `"Killed"`, `"Timeout"` or `"CompileError"` mutants.
- Do not modify `docs/quality.md` directly — the record you create is the signal that a human should update it.
- After any mutation run, commit the updated incremental cache (`reports/stryker-incremental.json`, or `reports/stryker-eval-incremental.json` for the eval lane). It is committed so later runs reuse results for unchanged mutants. `pnpm test:mutate:file <path>` gives targeted runs whose results accumulate.
