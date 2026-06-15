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

- [ ] Both behaviour ACs verified by a full `pnpm eval` trigger-lane run (re-run once for stability).
- [ ] Command lane re-run green (deferred `/TODO/` finding re-checked).
- [ ] `pnpm check` passes (biome + build + test:eval invariants — no LLM lane).
- [ ] Docs updated: the eval-design.md "skill-editing loop" already describes this workflow; no command/internals doc changes (skill descriptions are the only public surface). Update handoff.md — remove the P2 "Skill-description findings" entry (or trim to just the deferred `/TODO/` re-check if it resurfaces).
- [ ] Spec moved to docs/specs/archive/ with Outcome section (record the before/after eval results and the final description wording).
