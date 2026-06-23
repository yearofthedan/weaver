# /investigate skill + [needs investigation] tag

**type:** change
**date:** 2026-06-23
**tracks:** handoff.md # /investigate skill for bug diagnosis (+ [needs investigation] tag)

---

## Context

Bug diagnosis has no disciplined home. `/spec` drafts a skeleton and hands off;
`/slice` demands a *finished* plan — but the bug template's `Root cause` is
*completed by* the research, so empirical diagnosis falls in the gap between them
and gets done ad hoc. The 2026-06-22 daemon-SIGTERM session
([archived spec](archive/20260621-daemon-sigterm-registration-race.md)) burned
hours thrashing unverified hypotheses — and shipped two fixes on a "confirmed"
cause that was declared from reasoning plus a *green* isolation run — before
instrumenting the real path. The missing discipline is *debugging* discipline,
distinct in kind from `/spec`'s design discipline and `/slice`'s execution
discipline: reproduce the red state before claiming a cause, observe the
mechanism rather than infer it, one hypothesis at a time, and never trust a green
run as evidence about a race.

## User intent

*As an engineer or agent fixing a bug, I want a disciplined investigation
workflow — triggered by a `[needs investigation]` tag — that forces me to
reproduce the red state and observe the failure mechanism before claiming a root
cause, so that diagnosis stops thrashing through unverified hypotheses and lands a
confirmed cause plus a recorded reproduction before any fix is designed or built.*

## Relevant files

- `.claude/skills/spec/SKILL.md` — sibling discipline skill; mirror its
  structure (numbered checkpoint steps, "do NOT proceed" stops, internal
  frontmatter). `/investigate` is its debugging-side counterpart.
- `.claude/skills/slice/SKILL.md` — step 1 routing table (`[needs design]` →
  `/spec`, spec link → step 2) gains a `[needs investigation]` → `/investigate`
  branch; also gains the reclassification guard.
- `docs/specs/templates/bug.md` — the artifact `/investigate` fills (Symptom,
  reproduction block, Root cause) and routes (Fix). Gains an ownership note.
- `CLAUDE.md` — Rule 10 (tag taxonomy) and Rule 14 (failing-state-first) are the
  two rules edited.
- `docs/handoff.md` — "Picking up a task" tag list (lines ~21-26) gains the new
  tag.
- `docs/specs/archive/20260621-daemon-sigterm-registration-race.md` — the
  exemplar that motivated this; its Outcome/Reflection is the source material for
  the skill's discipline content.
- `eval/skill-file.test.ts` — confirms only the three *shipped* `weaver-*` skills
  are test-gated; internal workflow skills (`/slice`, `/spec`, `/investigate`)
  are not. No automated test surface for this change.

### Red flags

- (none) — all touched files are markdown/process docs. No source, no test
  hotspots. The risk is *consistency* across five edits, not code quality.

**Layer-fit check:** N/A — no code, no units to place. Verification is a
read-through (AC-by-AC below), not test execution.

## Value / Effort

- **Value:** Closes a structural gap that has already cost real hours. A
  `[needs investigation]` task today either stalls (no finished spec, so `/slice`
  won't take it) or gets force-fit through `/spec` (which drafts and hands off
  before the cause is known). The skill gives bug diagnosis a home with the one
  discipline that was missing — observe the mechanism, don't infer it — and the
  tag makes `/slice` route to it automatically instead of an agent improvising.
- **Effort:** Low. Five markdown/process files, no code, no new tests. The work
  is writing the skill clearly and keeping the five edits mutually consistent.

## Behaviour

Acceptance criteria. These are documentation/process edits; each is verified by a
read-through, not a test run. Verification notes are inline.

- [ ] **AC1 — `/investigate` skill exists and carries the debugging discipline.**
      `.claude/skills/investigate/SKILL.md` exists with internal frontmatter
      (`name: investigate`, a "Use when..." description naming bug diagnosis /
      root-cause / `[needs investigation]` triggers, `metadata: internal: true`),
      under 200 lines. Its body states the four load-bearing principles —
      (1) reproduce the red state before claiming a cause, (2) instrument and
      *observe* the mechanism, don't infer it, (3) one hypothesis at a time,
      (4) a green test is not evidence about a race — and warns about
      silently-broken harnesses (the load harness that applied no load). Its
      numbered workflow: (a) find the `[needs investigation]` task and create a
      bug spec from `bug.md`, filling Symptom; (b) reproduce the red state and
      record the exact command/test + observed output in the spec — no
      root-cause claim before red is seen; (c) instrument the real path and
      observe the failure, one hypothesis at a time; (d) write the confirmed Root
      cause, specific to the line(s) and backed by the observed mechanism;
      (e) branch on the **fix** — unambiguous → complete the spec's Fix section
      and route to `/slice`; needs design → hand the populated spec to `/spec`.
      It does **not** implement the fix (that is `/slice`).
      *Verify:* read the file; confirm frontmatter, line count, all four
      principles, and the create→reproduce→observe→root-cause→branch flow are
      present and the fix branch names both `/slice` and `/spec`.
      *Laziest wrong impl:* a skill that says "find the root cause and fix it"
      without the reproduce-before-claim and observe-don't-infer gates — it would
      not prevent the thrashing this exists to stop. The principles must be
      explicit, stated as stops.

- [ ] **AC2 — `[needs investigation]` added to the tag taxonomy and `/slice`
      routes it.** The tag appears in three places with consistent meaning
      ("problem reported, root cause not yet confirmed; run `/investigate`"):
      CLAUDE.md Rule 10's tag list, handoff.md's "Picking up a task" list, and
      `/slice` SKILL.md step 1 as a routing branch (`[needs investigation]` →
      switch to `/investigate`, mirroring the existing `[needs design]` → `/spec`
      branch).
      *Verify:* grep the three files for the tag; confirm `/slice` step 1 has a
      branch that hands off to `/investigate` parallel to the `[needs design]`
      branch.
      *Laziest wrong impl:* adding the tag to Rule 10 only, leaving `/slice` with
      no route — the tag would exist but `/slice` would not know what to do with
      it. All three edits are required.

- [ ] **AC3 — CLAUDE Rule 14 sharpened so a root-cause *claim* needs reproduction
      + observed mechanism.** Rule 14 currently mandates a failing state before a
      fix and verification after. The edit adds that a *claim of root cause* is
      only confirmed when backed by a reproduced red state **and** an observed
      mechanism (instrumentation/logging of the real path) — reasoning about why
      the code should behave a certain way, or a single green run of a flaky/race
      case, is not a confirmed cause.
      *Verify:* read Rule 14; confirm it distinguishes "verified the fix" (its
      existing scope) from "confirmed the cause" (the new clause) and names
      observed-mechanism-not-inference.
      *Laziest wrong impl:* re-wording the existing post-fix-verification
      sentence without adding the cause-confirmation clause — the rule must
      newly constrain *claims*, not just fixes.

- [ ] **AC4 — `/slice` reclassification guard.** `/slice` SKILL.md states that a
      `[needs investigation]` or `[needs design]` task cannot be downgraded to a
      direct fix by an agent *claiming* it already knows the root cause or the
      design; the tag is lowered only by completing the discipline (running
      `/investigate` or `/spec`).
      *Verify:* read the guard; confirm it explicitly forbids "I already know the
      answer" as grounds for skipping, and names both tags.
      *Laziest wrong impl:* a soft "prefer to run the workflow" suggestion — the
      guard must be a hard "cannot", since the SIGTERM session's original sin was
      exactly this self-authorised downgrade.

- [ ] **AC5 — bug template ownership note.** `docs/specs/templates/bug.md` notes
      that the Root cause and Fix sections are owned by `/investigate` (and by
      `/spec` when the fix needs design) — so a reader knows these are filled by
      the investigation discipline, not guessed at spec-creation time. Minimal
      change: a note near the Root cause section; no structural restructuring of
      the template (the existing `input/actual/expected` block stays as the
      reproduction record).
      *Verify:* read the template; confirm the note names `/investigate` for Root
      cause + Fix and `/spec` for the needs-design fix path.

> **Type matrix:** N/A — no input-type fork (file extensions, engine paths). The
> only "types" are the three tag values, covered by AC2/AC4.
>
> Re-read for contradictions: AC2 (route `[needs investigation]` → `/investigate`)
> and AC4 (no self-downgrade) must agree — `/slice` routes the tag *and* refuses
> to skip it; AC1's fix-branch (`/slice` vs `/spec`) must not contradict AC4's
> guard — `/investigate` decides the *fix path* after confirming the cause, which
> is not a self-downgrade of an unstarted investigation.

## Interface

No code interface. The "public surface" is the workflow contract:

- **`[needs investigation]` tag** — a handoff.md task state. Contains: a reported
  problem whose root cause is not yet confirmed. Realistic example: "Flaky daemon
  SIGTERM cleanup integration test". Zero case: a problem with an obvious cause is
  a `[chore]` or a spec-linked bug, not this. Adversarial case: an agent asserting
  it knows the cause to skip investigation — blocked by AC4.
- **`/investigate` output** — a bug spec file in `docs/specs/` with Symptom, a
  recorded reproduction (command/test + observed red output), and a confirmed
  Root cause; plus either a completed Fix section (→ `/slice`) or a handoff to
  `/spec` (→ fix design). Empty/zero case: if the red state cannot be reproduced,
  investigation is not complete — there is no confirmed cause to record, and the
  skill must say so rather than fabricate one.

**Design-shape check:** N/A — no transport entry point, no FileSystem port, no
helpers. Process docs only.

## Open decisions

**Resolved (2026-06-23, with user): `/investigate` owns bug-spec creation.**
`/investigate` creates the bug spec from `bug.md` itself, fills Symptom /
reproduction / Root cause, then routes the fix — handing the *already-populated*
spec to `/spec` only when the fix needs design. Chosen over having `/spec` create
a skeleton first because that re-introduces the exact "drafts a skeleton and hands
off before the cause is known" seam this task exists to remove; making
investigation self-contained mirrors how `/spec` owns spec creation. Consequence:
`/investigate` and `/spec` both create spec files — acceptable, since they own
disjoint spec states (unconfirmed-cause vs ready-to-implement design). Watch for:
the two skills must agree on file naming (`YYYYMMDD-slug.md`) and not both try to
create the same file — `/spec` picks up an existing `/investigate`-authored spec
when designing a needs-design fix rather than creating a second one.

## Security

- **Workspace boundary:** N/A — no file reads/writes by code; the skill is
  process guidance authored as markdown.
- **Sensitive file exposure:** N/A — no code path reads file content.
- **Input injection:** N/A — no new string parameters reach the filesystem or
  shell.
- **Response leakage:** N/A — no error messages or response fields change.

## Edges

- **Must NOT change:** the `[chore]` / `[needs design]` / spec-link tag semantics
  (only *added* to); `/spec`'s and `/slice`'s existing routing branches; the
  `bug.md` template structure beyond the ownership note; Rule 14's existing
  failing-state-first mandate (the cause-confirmation clause is additive).
- **Assumption:** internal workflow skills are not test-gated by
  `eval/skill-file.test.ts` (verified — it lists only the three shipped skills),
  so no test must be added or updated.
- **Consistency constraint (becomes the verification):** the tag's meaning is
  identical across CLAUDE Rule 10, handoff.md, and `/slice`; the `/slice` route
  (AC2) and guard (AC4) do not contradict; `/investigate`'s fix-branch references
  to `/slice` and `/spec` match those skills' actual entry expectations.

## Done-when

- [x] All five ACs verified by read-through (no test run — process/docs change).
- [x] `/investigate` skill is under 200 lines (59) with valid internal
      frontmatter (`name`, `description`, `metadata: internal: true`).
- [x] The `[needs investigation]` tag has identical meaning in CLAUDE Rule 10,
      handoff.md "Picking up a task", and `/slice` step 1; `/slice` routes it to
      `/investigate` and refuses self-downgrade (reclassification guard).
- [x] CLAUDE Rule 14 distinguishes confirmed-cause (reproduction + observed
      mechanism) from fix-verification.
- [x] `bug.md` template marks Root cause / Fix as filled by investigation
      (self-contained wording — see Outcome for the deviation from the drafted AC).
- [x] `pnpm check` passes (build + lint + tests still green — no new tests
      expected; this guards against an accidental break, not new coverage).
- [x] No touched file exceeds the hard flag in `docs/code-standards.md` (the skill
      stays <200 lines per the test convention for skills).
- [x] handoff.md entry removed.
- [x] Spec moved to `docs/specs/archive/` with an Outcome section appended.

## Outcome

**Shipped.** Five coupled process edits landed: the new `/investigate` skill
(`.claude/skills/investigate/SKILL.md`, 59 lines), `[needs investigation]` added
to the tag taxonomy in CLAUDE Rule 10 + handoff.md + `/slice` step 1 routing,
CLAUDE Rule 14 sharpened to hold root-cause *claims* to a reproduce-plus-observe
bar, a `/slice` reclassification guard (also stated in Rule 10), and the bug
template marking Root cause / Fix as investigation-owned.

- **No code, no tests.** Pure docs/process. `pnpm check` ran green via the
  pre-commit hook (1081 main + 145 eval tests, unchanged). Mutation testing N/A.
- **AC5 changed shape mid-flight.** The drafted AC said the bug template should
  *name* `/investigate` (+`/spec`) as the owners of Root cause / Fix. During
  implementation the user pushed back: a template is copied into specs that get
  archived and outlive the things around it, so any outward reference — a skill
  command *or* a CLAUDE rule number — is a pointer that rots. The template now
  states the discipline inline ("filled only after the failure is reproduced and
  its mechanism observed firsthand"; "complete only after the Root cause is
  confirmed") with no outward references. Routing (which skill fills it) lives
  only in the routing docs. Captured as a general rule in `.claude/MEMORY.md`
  ("Templates must be self-contained — no outward references").
- **The skill itself nearly shipped with two of its own anti-patterns.** First
  draft over-corrected on the SIGTERM lesson — it demanded instrumentation
  ceremony for *every* bug; revised so the reproduce-red gate is universal but the
  observe-the-mechanism bar is proportional (escalate to instrumentation only when
  the mechanism is hidden). It also carried narrative storytelling ("it did, twice,
  in the daemon SIGTERM session"), the exact anti-pattern `writing-skills` warns
  against — cut on a brevity pass that roughly halved the file (108 → 59 lines, the
  discipline was stated three times).

**Reflection.**

- *What went well:* the spec's interface/edges framing of "the consistency
  constraint *is* the verification" held up — the final check was a single grep
  confirming the tag means the same thing in all four places and the route/guard
  don't contradict.
- *What did not:* I authored the skill without invoking `writing-skills`, despite
  having read it during exploration — so the anti-patterns went in and only came
  out under user prompting, not discipline. The lesson mirrors the skill's own
  thesis: reading the guidance is not running it. When creating or editing a
  skill, invoke `writing-skills` *first*. The Iron Law (RED baseline pressure test
  before writing) was consciously skipped with user sign-off; this skill therefore
  has methodology debt — its rationalization table and red-flags list are empty
  because no baseline run has surfaced real rationalizations. If `/investigate`
  proves leaky in use, run the RED-GREEN pressure loop and populate those.
- *Recommendation to the next agent:* the next bug task is the place to dogfood
  `/investigate` end-to-end — it has never actually been driven against a live
  bug. Watch whether the create-bug-spec → reproduce → observe → route flow is
  smooth in practice, especially the `/investigate` ↔ `/spec` handoff for a
  needs-design fix (they both create spec files; the Open decision above says
  `/spec` must pick up the existing file, not create a second).
