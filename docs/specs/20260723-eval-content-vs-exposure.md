# Separate skill-content signal from host-exposure noise in the eval

**type:** change
**date:** 2026-07-23
**tracks:** handoff.md "Separate skill-content usability from host-exposure noise in the eval" → docs/eval-design.md

---

## Context

The agentic trigger lane collapses every trial into one bit — `matched` or not — so
its per-case rate (`matched / total`) blends three unlike misses: the body loaded but
didn't guide (weaver's content), the skill was never reached (weaver's description or
plain shell habit), and the model called the skill *as a tool* and dead-ended (host
exposure weaver can't fix). A cross-model run therefore reads a non-Claude model's
host-integration failures as skill-content failures — the exact conflation the
2026-07-23 baselines exhibited (`weaver_code_inspection({...})` crashing, then grading
as a plain miss). The harness already delivers the raw material (`skillMdRead`,
`matchedAtStep`) but never classifies or aggregates it.

## User intent

*As a developer whose refactoring skills are consumed by many agent hosts, I want the
eval to tell me whether my **skill content** is usable — separately from how a given
host exposes it — so that a cross-model run points me at the descriptions and bodies I
can actually improve, not at host-integration quirks I don't own.*

## Relevant files

- `eval/harness/agentic-loop.ts` — `runAgenticLoop` + `AgenticResult`; where the reach
  is detected (`isSkillMdRead`), the trail built, and `skillMdRead`/`readTurn` set. Gains
  `skillCalledAsTool`. `resolveCannedResult` is the current dead-end for a tool-style call
  (unknown-tool error).
- `eval/harness/context.ts` — `SKILL_NAMES`, `readSkillFile`, `skillLocation`. New home
  for `classifySkillReach` (skill-recognition, today inline+untested in the `.llm.test.ts`).
- `eval/harness/rate.ts` — `computeRate`; unchanged, still the gate. The new `outcome.ts`
  sits beside it.
- `eval/harness/grade.ts` — `SUBCOMMAND_MUTABILITY` completeness-guard pattern to mirror
  for the outcome truth table's exhaustiveness.
- `eval/cases/trigger-agentic.llm.test.ts` — the lane wiring: `skillNameFromLoad`,
  `cannedResultForCall`, the per-case console/trail summary, and the boundary block.
- `docs/eval-design.md` — the exposure model + interpreting-a-rate guidance to update.
- `docs/eval-baselines.md` — recording guidance to update with the composition.

### Red flags

- `skillNameFromLoad` / `skillNameFromRead` / `cannedResultForCall` live inline in
  `trigger-agentic.llm.test.ts` and are not unit- or mutation-tested. Moving the
  recognition core to `classifySkillReach` in `context.ts` (AC1) fixes this for the new
  logic; `cannedResultForCall` stays as thin glue that composes tested pieces.
- **Test hotspots:** none at threshold — the new logic lands in small dedicated files
  (`context.ts` +1 function, new `outcome.ts`) with colocated `*.test.ts`.
- **Layer-fit:** AC1, AC4, AC5 are pure functions of their inputs — unit-test directly,
  mutation-covered by `test:mutate:eval`. AC2, AC3, AC6 are loop/lane wiring — one
  harness unit test each where a pure seam exists (AC3 via `runAgenticLoop`'s scripted
  fake step), and the real behaviour verified by a paid `pnpm eval` run (see Done-when).

## Value / Effort

- **Value:** A cross-model eval run becomes *actionable*. Today a red on DeepSeek or
  Gemini could be a bad skill body or a host quirk the developer can't touch, and the
  single rate can't tell them apart — so the signal is ignored. After this, the
  composition names it: `content-fail` is a body to fix, `never-reached` is a description
  to fix, `warned-pass` is host noise to discount. Feeding the body on a tool-style reach
  also rescues the content signal from a model that *regularly* calls-as-tool, where pure
  classification would leave an empty content denominator.
- **Effort:** Eval-harness-internal. One new function in `context.ts`, one new file
  `outcome.ts` (two pure functions + a type), one field on `AgenticResult`, and lane
  wiring in one `.llm.test.ts`. No CLI, socket, schema, or engine surface. Doc updates to
  two eval docs. Verification is a paid two-model run.

## Behaviour

Acceptance criteria as concrete **input → output** statements.

- [ ] **AC1 — `classifySkillReach(call): { skill: SkillName; via: "load" | "tool" } | undefined`** (new, `eval/harness/context.ts`).
  - `Skill({ skill: "weaver-refactor" })` → `{ skill: "weaver-refactor", via: "load" }`
  - `Read({ file: "/abs/.claude/skills/weaver-refactor/SKILL.md" })` → `{ skill: "weaver-refactor", via: "load" }`
  - `weaver_code_inspection({ ... })` (undeclared tool; name lowercased + `_`→`-` equals a `SKILL_NAMES` entry) → `{ skill: "weaver-code-inspection", via: "tool" }`
  - `weaver-refactor({ ... })` → `{ skill: "weaver-refactor", via: "tool" }`
  - `bash`, `Grep`, `frobnicate({ ... })`, `Skill({ skill: "nonsense" })` → `undefined`

  Laziest wrong: matching only exact hyphenated names — misses the underscore variant, which is a distinct input in the matrix. Type matrix: {Skill-valid, Skill-invalid, Read-skill, Read-nonskill, tool-hyphen, tool-underscore, bash, competing-declared, unknown-nonskill} each exercise a branch.

- [ ] **AC2 — the trigger lane feeds the SKILL.md body on a `via: "tool"` reach.**
  A tool-style skill call resolves to that skill's SKILL.md body, not the unknown-tool
  error. A genuinely unknown tool (`frobnicate`) still resolves to the unknown-tool
  error; a declared competing tool (`Grep`) still resolves to its canned result; a
  `Skill` with an unknown name still resolves to the unknown-skill error. Laziest wrong:
  feeding the body for *any* undeclared tool — `frobnicate` must still error.

- [ ] **AC3 — `runAgenticLoop` records the reach and marks it loaded** (`AgenticResult` gains `skillCalledAsTool: boolean`).
  A turn containing a `via: "tool"` reach sets `skillMdRead = true` **and**
  `skillCalledAsTool = true`. A `via: "load"` reach sets `skillMdRead = true` and leaves
  `skillCalledAsTool = false`. The invariant `skillCalledAsTool ⟹ skillMdRead` holds.
  Tool-style reaches stay out of `trail` and the match / hard-fail checks — navigation,
  exactly like a proper load. Laziest wrong: setting `skillCalledAsTool` without
  `skillMdRead`, breaking the invariant and mis-tiering a warned pass.

- [ ] **AC4 — `classifyTrialOutcome({ matched, skillMdRead, skillCalledAsTool }): TrialOutcome`** (new, `eval/harness/outcome.ts`).

  | matched | skillCalledAsTool | skillMdRead | → |
  |---|---|---|---|
  | true | false | — | `"clean-pass"` |
  | true | true | (true by invariant) | `"warned-pass"` |
  | false | — | true | `"content-fail"` |
  | false | false | false | `"never-reached"` |

  Laziest wrong: `matched ? "pass" : "fail"` — ignores all four tiers. Every row is a test case.

- [ ] **AC5 — `computeOutcomes(outcomes: TrialOutcome[]): OutcomeTally`** (in `outcome.ts`).
  Returns `{ cleanPass, warnedPass, contentFail, neverReached, total }`. `[]` → all zero,
  `total: 0`. A mixed input tallies each tier independently. Laziest wrong: returning
  `total` without the per-tier counts, or double-counting.

- [ ] **AC6 — the trigger lane reports the composition.** Per-case console output prints
  the outcome tally (counts per tier) and each trial's tier in its trail line, alongside
  the unchanged `rate passed/total`. Verified on the real `pnpm eval` run (display wiring,
  not unit-asserted on the exact string).

## Interface

No public surface changes — CLI, socket protocol, schemas, and engines are untouched.
The changes are eval-harness-internal:

- **`classifySkillReach(call: ToolCall)`** → `{ skill: SkillName; via: "load" | "tool" } | undefined`.
  `skill` is one of the three `SKILL_NAMES`. `via` distinguishes a host-sanctioned load
  (`Skill`/`Read`) from a tool-style hallucination. Zero case: a non-skill call → `undefined`.
  Adversarial: an odd-separator or mixed-case skill name (`weaver_Code_Inspection`) —
  normalized (lowercase, `_`→`-`) before matching; a name that is a *superstring* of a
  skill name (`weaver-refactor-x`) does not match (exact post-normalization equality).
- **`AgenticResult.skillCalledAsTool: boolean`** — always present (defaults `false`),
  set once on the first tool-style reach. Bound: one boolean per trial.
- **`TrialOutcome`** = `"clean-pass" | "warned-pass" | "content-fail" | "never-reached"`.
  Four-value union; every trial maps to exactly one.
- **`OutcomeTally`** = `{ cleanPass; warnedPass; contentFail; neverReached; total }` —
  non-negative integers summing to `total`; bounded by trial count (default 3).

## Open decisions

(none — the exposure model, the tier set, and gate-unchanged were resolved with the user
before drafting.)

## Security

- **Workspace boundary:** N/A — no workspace file writes. `classifySkillReach` reads
  nothing; `readSkillFile` reads from the fixed `.claude/skills/` dir, as it already does.
- **Sensitive file exposure:** N/A — reads only shipped SKILL.md bodies (public product
  surface), never user content.
- **Input injection:** N/A — the only new string handling is normalizing a tool-call name
  (lowercase + `_`→`-`) for an equality check against a fixed allowlist; it reaches no
  filesystem or shell.
- **Response leakage:** N/A — new output is tier labels and integer counts into console
  logs, no file content or user-controlled strings.

## Edges

- **Boundary cases flip semantics.** The boundary lane's `isSkillMdRead` rewires to
  `classifySkillReach`, so a boundary trial that reaches a skill via a tool-style call now
  sets `skillMdRead` and reads as over-triggered (previously it slipped through). This is
  arguably more correct — reaching for a skill on a shell-only task *is* an over-trigger —
  but it can flip a boundary case, so no legitimate boundary case may regress on the real
  run.
- **Gate is unchanged.** `computeRate(matched[])` still gates on the selection rate;
  `clean-pass + warned-pass = matched`, so warnings count toward the gate but print
  distinctly. The tally is reporting-only and carries no assertion.
- **A tool-style call must never enter the trail or satisfy `matches`/`hardFails`** — it
  is navigation. Regression risk: a `weaver-refactor({...})` tool call being mistaken for
  a `weaver rename` bash match.
- **Harness change ⟹ verification is a paid run, not green unit tests** (eval discipline).

## Done-when

- [ ] All ACs verified by tests (AC1/AC4/AC5 unit + mutation; AC3 via scripted-fake loop test).
- [ ] Mutation score ≥ threshold for `context.ts`, `outcome.ts`, `agentic-loop.ts` via `pnpm test:mutate:eval:file`.
- [ ] `pnpm check` passes (lint + build + test).
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`.
- [ ] **Real-run verification (the gate before archive):**
      - **Haiku 4.5** (`anthropic/claude-haiku-4.5`): selection rate unchanged vs the
        2026-07-23 baseline, all boundary cases pass, passes classify as `clean-pass` with
        zero `warned-pass` (Haiku does not call-as-tool). This is the release-gate check.
      - **Gemini 2.5 Flash** (`google/gemini-2.5-flash`, cheapest ~$0.10): the tool-style
        reach reaches content — the `weaver_code_inspection` underscore call that used to
        dead-end now feeds the body and lands as `warned-pass` or `content-fail`, not a
        bare miss. Confirms the new path on the model that reproduces it.
      - Record both compositions in the archived Outcome.
- [ ] Docs updated:
      - `docs/eval-design.md` — the tool-style-reach-as-load exposure model, the four-tier
        taxonomy, and why (content vs exposure); update the "reading a rate" mechanism list.
      - `docs/eval-baselines.md` — recording guidance notes the composition alongside the
        per-case rate.
      - `docs/handoff.md` current-state harness bullet mentions the classification.
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`.
- [ ] Non-obvious gotchas added to `docs/eval-design.md` (or `CLAUDE.md` if cross-cutting).
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended.
