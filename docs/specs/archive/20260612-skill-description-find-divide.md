# Divide the "find X" trigger space between inspection and search skills

**type:** change
**date:** 2026-06-12
**tracks:** handoff.md # Skill-description findings from the first eval run → .claude/skills/weaver-code-inspection/SKILL.md, .claude/skills/weaver-search-and-replace/SKILL.md

---

## Context

The 2026-06-10 eval run surfaced that `weaver-code-inspection` and `weaver-search-and-replace` compete for "find X" tasks. A re-run on 2026-06-12 confirms the live failure: for "find all TODO comments … file, line, and context" the model selects `weaver-code-inspection` (a symbol tool) instead of `weaver-search-and-replace` (the text tool). At trigger time only each skill's frontmatter `description:` is in context — the body's "When NOT to use" section never gets read — so the fix must live in the two description lines. (The companion `/TODO/` regex-delimiter finding from 2026-06-10 no longer reproduces — `command-search-text` passes today — so it is out of scope here; re-check it in the closing eval pass.)

## User intent

> *As an AI agent told to "find all TODO comments" (or any free-text/comment search), I want the skill descriptions to route me to `weaver-search-and-replace`, so that I reach for the text-search tool instead of the symbol-inspection tool.*

The two skills divide along one axis: **a named code symbol that resolves through the type system (has a position) vs. free text / a regex pattern (TODO, string literals, comments).** Every wording choice serves making that boundary unmistakable at trigger time.

## Relevant files

- `.claude/skills/weaver-code-inspection/SKILL.md` — frontmatter `description:` (line 3). Symbol side of the divide.
- `.claude/skills/weaver-search-and-replace/SKILL.md` — frontmatter `description:` (line 3). Text side of the divide.
- `eval/cases/cases.ts` — the trigger/command case table; `trigger-search-and-replace-todos-grep-tempting` is the regression case for this fix, the code-inspection trigger cases are the guard against over-correction.
- `eval/harness/tools.ts` / `eval/harness/context.ts` — confirm the trigger tool description is sourced from the frontmatter at run time (single source of truth).
- `docs/eval-design.md` — the edit→`pnpm eval`→read-what-flipped loop; "Interpreting results" (don't tune to the local-model score).

### Red flags

- (none — two single-line frontmatter edits; no source files touched, no test hotspots.)

## Value / Effort

- **Value:** An agent doing a text/comment search gets routed to the tool that actually does text search, instead of bouncing off a symbol tool that needs a line/col position it doesn't have. Prevents the most common "find" mis-route the eval can currently see.
- **Effort:** Two frontmatter line edits. Verification is the existing `pnpm eval` trigger lane — no new code, no new tests, no mutation surface.

## Behaviour

Verified by the existing `pnpm eval` trigger + command lanes (LLM, `qwen2.5:7b-instruct`, temp 0). The eval cases *are* the tests for this change — there is no unit-test or mutation surface.

- [ ] Given "find all TODO comments … file, line, and context" (`trigger-search-and-replace-todos-grep-tempting`), the model's first tool call selects `weaver-search-and-replace` (was `weaver-code-inspection`).
- [ ] No regression: in a full trigger-lane run, the three code-inspection cases (`trigger-code-inspection-find-references`, `-find-references-delete-intent`, `-get-type-errors`) and the two search-and-replace cases (`-pattern`, `-sed-tempting`) still select their expected skill. The new "free text vs named symbol" wording must not pull symbol tasks toward search-and-replace.
- [ ] No collateral: a full command-lane run stays green (this is also the re-check of the deferred `/TODO/` finding — `command-search-text` still emits `pattern: "TODO"`).

> Single-shot temp-0 results can flap on knife-edge cases. The acceptance bar is the *full* trigger lane passing on a clean `pnpm eval` run, re-run once to confirm stability — not a single case in isolation.

## Interface

Public surface = the two frontmatter `description:` strings (the trigger tool descriptions agents see). Proposed wording:

- **`weaver-code-inspection`:** anchors on "a named symbol (function, variable, type) at a position", and cross-references the sibling for the out-of-scope case ("For free-text, comment, or string search (e.g. TODO), use weaver-search-and-replace").
- **`weaver-search-and-replace`:** promotes the find clause to the front with concrete examples ("finding every occurrence (e.g. TODO comments, a literal string)"), and cross-references the sibling ("For usages of a named code symbol, use weaver-code-inspection").

Bidirectional cross-references are the mechanism: each description names the boundary and points elsewhere for the case it does not own. Exact wording is tuned against the eval in the change/test/learn loop — the above is the starting hypothesis, not a frozen string.

Bounds: descriptions stay to ~2 sentences (frontmatter; part of the ~3.2k-token skill budget noted in eval-design.md — keep total skill content under ~3.8k tokens or Ollama silently truncates).

## Open decisions

(none — axis and mechanism settled above; wording is tuned empirically, not a design fork.)

## Security

- **Workspace boundary:** N/A — edits documentation strings only; no code path, no file read/write changes.
- **Sensitive file exposure:** N/A — no file content is read.
- **Input injection:** N/A — no new parameters reach the filesystem.
- **Response leakage:** N/A — no change to error messages or response fields.

## Edges

- The cross-reference sentences name the sibling skill by its exact slug (`weaver-search-and-replace` / `weaver-code-inspection`); a typo would dangle. Verified by both slugs existing in `.claude/skills/`.
- Descriptions also surface in the host's available-skills list and CLAUDE.md Rule 18 context — the frontmatter is the single source, so those update automatically.

## Done-when

- [x] Both behaviour ACs verified by a full `pnpm eval` trigger-lane run (re-run once for stability).
- [x] Command lane re-run green (deferred `/TODO/` finding re-checked).
- [x] `pnpm check` passes (biome + build + test:eval invariants — no LLM lane).
- [x] Docs updated: eval-design.md (boundary cases, lane filtering, frontmatter-in-prompt gotcha); handoff.md entry removed; skill body documents `context`.
- [x] Spec moved to docs/specs/archive/ with Outcome section.

## Outcome

The scope grew well past the original divide-only fix through an interactive
change/test/learn session across two local models and a cold frontier agent.

**Shipped:**
- Reworded both descriptions for the symbol-vs-text divide with bidirectional
  cross-references. Fixed the original TODO mis-route on qwen2.5 (the AC).
- A qwen3 (thinking-model) run exposed a deeper failure the divide didn't touch:
  it skipped the skills entirely and reached for `grep` on "find TODO comments."
  Fixed by making the search-and-replace description **reasoning-aware** — lead
  with "use instead of grep" and state grep's concrete disadvantages (no
  structured coords, not workspace-scoped, no sensitive-file skipping). A passive
  "before using grep" mention is too weak for a model that *reasons* about tool
  choice; it needs the decision criterion, not a finger-wag.
- Final wording verified on qwen2.5 (trigger 9/9 → 14/14 with boundary, command
  12/12), qwen3 (target TODO case 4/4 stable), and a **cold fresh-Claude subagent
  with no design context (4/4)** — including a no-keyword generalization case
  ("find every hardcoded localhost URL") that proves the divide isn't overfit to
  the literal word "TODO."
- Promoted a bash over-trigger guard into permanent `boundary-*` trigger cases (5)
  + an invariant. The trigger lane previously had zero negative-boundary coverage;
  aggressive wording makes over-triggering a real risk. Both models hold 5/5.
- Documented search-text's `context` parameter in the skill body — surfaced by the
  cold agent's reasoning (it justified its choice on "surrounding context," which
  the description sells but the body never showed how to obtain).
- Renamed `expect.skill` → `expect.tool` (a trigger selection is a skill *or* bash)
  via `weaver rename`. Refactored context.test.ts from prose-pinning to structural
  assertions (the pins broke on every legitimate description edit — twice).

**Reflection — what went well:** the local two-model split worked as designed —
qwen2.5 as the fast regression lane, qwen3 as a reasoning-pressure probe that
surfaced a failure qwen2.5 structurally cannot (a keyword-matcher never reaches
for grep over a "text" tool). The cold-Claude subagent was the highest-value
single check: it validated on the real target-model class, and its *reasoning*
exposed the `context` doc gap.

**What didn't / for the next agent:** (1) Don't tune skill text to a single
local-model run — qwen3-over-Ollama's emission stalls confound its signal
(a move-file case flapped fail→pass with no relevant change); treat its failures
as hypotheses, validate on a cold frontier session. (2) After any description
edit, run **both** eval lanes — `skillContext` feeds frontmatter into the command
prompt, so a trigger-aimed edit ("TODO comments") regressed the command lane
("// TODO"). (3) I reached for `grep` to find references mid-session despite
Rule 18 and the skills being loaded — live evidence that descriptions and rules
don't reliably beat shell habit even for the target model, which is the core
argument for the queued agent-host hooks.

**Test count:** +6 (5 boundary cases, LLM lane only; +1 boundary invariant in the
`pnpm check` lane, 134→135). **Mutation:** N/A — no `src/` changes (skill markdown,
eval test/harness, docs only).
