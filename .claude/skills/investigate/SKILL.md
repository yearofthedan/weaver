---
name: investigate
description: Use when a bug's root cause is not yet confirmed — a failing test, a flake, a crash, or wrong output tagged [needs investigation] in handoff.md. Triggers before a spec or a fix exists, when the question is "what is actually causing this?"
metadata:
  internal: true
---

# Investigate Workflow

Find a *confirmed* root cause for a bug — not design or implement the fix.
Distinct from `/spec` (design discipline) and `/slice` (execution discipline).
Output: a bug spec with a recorded reproduction and a root cause backed by
evidence, with the **fix** routed to `/slice` (unambiguous) or `/spec` (needs
design).

## The discipline

1. **Reproduce the EXACT bug before claiming a cause.** "Red" means the same
   failure *mechanism* the report describes — not merely the same test or case
   going red for some reason. If the target fails a different way (a different
   trail, a different symptom) than described, that is **not a reproduction**.
   It is a new, separate observation — do not write it into this bug's Root
   cause, do not treat the rate/pass-fail number alone as confirmation. No
   diagnosis begins until the *described* failure is on the screen. For a flake
   or race, one green run proves nothing; loop the real trigger until you have
   seen the exact failure.
2. **Verify the cause; instrument when it's hidden.** Once red is reproduced,
   confirm *why* it fails. When the reproduction pins it, reading the source to
   find the line is enough — don't manufacture ceremony. When the mechanism is
   hidden (ordering, timing, mutated state), stop inferring and instrument the
   real path — logging, counters, breakpoints — until you watch it fail. Scale
   the effort to how hidden the mechanism is.
3. **One hypothesis at a time.** State it, run the observation that confirms or
   kills it, settle it — then form the next. Never ship a fix on an unconfirmed
   hypothesis.
4. **Prove the harness before trusting its silence.** A reproduction that "shows
   nothing" may be a harness exercising nothing — a load harness applying no
   load, a stale build, a log that never prints. An unverified harness produces
   no evidence, not negative evidence.

## Steps

"Do NOT proceed" lines are stops.

1. **Find the task.** First `[needs investigation]` entry in `docs/handoff.md`
   (or the bug the user named). Create a bug spec from
   `docs/specs/templates/bug.md` at `docs/specs/YYYYMMDD-short-slug.md`; fill
   **Symptom**, leave Root cause and Fix blank.
2. **Reproduce** (principle 1). Smallest command/test that fails; record it and
   its output in the spec's `input/actual/expected` block. If the exact bug
   does not reproduce — including the target failing a different way than
   described — stop the workflow, say so in the spec, and report it to the
   user before doing anything else. Do not proceed to Step 3.
3. **Confirm the cause** (principles 2–3). Pin it to the responsible line(s) from
   evidence, not a story that feels right.
4. **Write the Root cause** — specific to the line(s) and grounded in what you
   observed, e.g. "lockfile written before the signal handler is registered
   (`daemon.ts:159` vs `:223`), per-PID logs show `LOCKFILE_WRITTEN` then no
   `SHUTDOWN_ENTER`" — not "the validation is wrong".
5. **Route the fix.** Unambiguous → complete the spec's **Fix** section, hand to
   `/slice`. Has architectural forks (multiple viable approaches with different
   correctness/risk) → leave Fix blank, re-tag the handoff entry `[needs
   design]`, hand the populated spec to `/spec`. Don't design the fix here.
6. **Commit and report.** Commit the spec + handoff (`docs(specs): add spec for
   [short-title]`); tell the caller which route and what runs next. Don't
   implement the fix — that is `/slice`.
