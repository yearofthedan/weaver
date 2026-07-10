# Spike: skill shape and text vs shell habit on the agentic rate lane

**type:** spike (research — no ACs; findings and decisions only)
**date:** 2026-07-09 / 2026-07-10
**tracks:** handoff.md # Skill trigger-description redesign for the shell-habit-losing cases

---

## Question

Four agentic-lane cases were stable never-touch reds under a verified provider
(`AkashML`, `meta-llama/llama-3.3-70b-instruct`, 3 trials/case): the model applies its
shell habit (`sed`/`grep`/`tsc`) and never loads any skill. Can reshaping the skills
(merge, regroup) or rewriting their text fix this — and does the frontier audience have
the problem at all?

## Method

`pnpm eval trigger-agentic` (clutter prompt + grep-primed seed + competing `Grep`/
`Glob`/`Read` tools), reds + green controls, 3 trials/case unless noted. Each arm is an
uncommitted working-tree variant; harness `SKILL_NAMES` repointed per arm. Frontier arms:
`anthropic/claude-haiku-4.5` via the same OpenRouter transport (no provider pin) — no
transport shim was needed, which also unblocks the queued frontier cold-context probe.

## Arms and results — 70B (AkashML)

| Case | baseline (shipped text) | merged skill | split + new descriptions | + tsc in STOP | + tsc contrast block |
|---|---|---|---|---|---|
| find-references | 0/3 | 2/3 | 2/3 | 3/3 | — |
| find-references-delete-intent (control) | 3/3 | **1/3** | 3/3 | 3/3 | — |
| get-type-errors | 0/3 | 2/3 | 0/3 | 0/3 | 3/6 |
| todos-grep-tempting | 0/3 | 0/3 | 0/3 | — | — |
| sed-tempting | 0/3 | 0/3 | 0/3 | — | — |

A fourth shape — read/write cut (`weaver-code-questions` read-only ops /
`weaver-code-changes` mutations incl. replace-text) — regressed the entire read side
(find-references 0/3, delete-intent 0/3, get-type-errors 0/3; renames held 3/3) and was
discarded.

## Arms and results — Haiku 4.5

| Case | original (shipped) text | tuned text |
|---|---|---|
| find-references | 3/3 | 3/3 |
| find-references-delete-intent | 3/3 | 3/3 |
| get-type-errors | 3/3 | 3/3 |
| todos-grep-tempting | 2/3 | 3/3 |
| sed-tempting | 2/3* | 3/3 |

*One "miss" was a matcher false-negative (`cd … && weaver replace-text …`; fixed, see
Findings 8).

## Findings

1. **Description wording is the trigger lever; shape is not.** Quoting the losing task
   phrasings in the frontmatter description ("where is X used / who calls X?", "any
   TypeScript errors?") flipped find-references from never-touch 0/3 to 3/3 on the 70B.
   The same gain appeared under the merged shape — the rewrite, not the merge, did the
   work.
2. **Conversion (post-load) is won by "Instead of: `<habit>`" contrast blocks.** The
   body section with a grep contrast (find-references) converted reliably; the
   type-errors section without one lost to `tsc` even after the model read the body
   (0-for-4 post-load). Adding a `tsc` contrast block made every subsequent load convert
   (3-for-3). A passing mention in the STOP line was not sufficient.
3. **Merging is harmful:** it introduced load-then-stall (model loads the ~2× body, then
   answers with prose instead of acting — e.g. "I'll use bash." — captured verbatim by
   the new `abandonedText` instrumentation) and regressed a 3/3 control to 1/3.
4. **Read/write regrouping is harmful:** a capability-named read skill
   (`weaver-code-questions`) induced an oracle-loop — the model repeatedly calls the
   *skill itself* as a query tool (`{"query": "find references to authenticate"}`),
   ignores the loaded body, and burns the step budget. Skill names that sound like
   endpoints invite invocation instead of instruction-following. Matches real-world
   OpenCode stuck-in-loop reports (anomalyco/opencode #31646, #13317).
5. **`todos-grep` and `sed-tempting` are text-immune on the 70B** — 0 skill touches in
   30+ trials across four text/shape variants, including variants quoting the exact task
   phrasing. Mechanism: the host's declared `Grep` tool (or seeded `sed` momentum) *is*
   the task shape; a second-class skill (load hop required) loses the trigger no matter
   its text. Evidence for a forcing mechanism (hooks entry), scoped to sub-frontier
   hosts (see 6).
6. **The reds are an OSS-model-audience problem, not a frontier problem.** Haiku 4.5 —
   the weakest Claude — passes all five cases with the *original* text under full
   adversarial pressure, and goes 15/15 with the tuned text. The tuned text is
   strictly better or equal on both audiences; the hooks case is correspondingly
   weakened for Claude-family hosts and remains an OSS-host argument.
7. **YAML frontmatter trap:** a `description:` whose value *starts* with a double quote
   is truncated by real hosts' YAML parsers (observed live in Claude Code); the eval
   harness's regex parser masks the breakage. Descriptions must start with a plain word.
8. **Matcher false-negative fixed:** `extractBashCommands` did not split `&&` chains,
   so `cd X && weaver <cmd> …` could never match the `^`-anchored `isWeaverInvocation`.
   Now splits like the text path (unit-tested).

## Decisions

- **Keep the shipped three-skill structure.** Merged and read/write shapes rejected on
  the evidence above.
- **Ship the tuned text** for `weaver-search-and-replace` and `weaver-code-inspection`
  (task-phrasing descriptions; `tsc` in code-inspection's STOP; `get-type-errors`
  contrast block), gated on the full-suite guard run (boundary over-trigger, command
  lane, agentic lane).
- **Keep the `abandonedText` instrumentation** in `runAgenticLoop` (unit-tested): it
  turns "why did the trial abandon" from inference into evidence.
- **Residual on the 70B:** get-type-errors trigger is coin-flip (never-touch in half
  the trials); todos-grep/sed-tempting remain never-touch. Do not chase these with more
  wording; they are the hooks-entry evidence.

## Follow-ups (applied to handoff in the same change series)

- Trigger-redesign entry and the subsumed skill-text-tuning entry: removed (done).
- Frontier cold-context probe (P5): removed — it ran here (no transport shim needed;
  OpenRouter serves Anthropic models on the same OpenAI-compatible endpoint); the
  Haiku-primary / 70B-on-demand lane roles are documented in `docs/eval-design.md`.
- Habit-momentum primer entry: removed — its "see who calls" trigger sharpening shipped
  via the description rewrite; seed deepening folded into the Haiku pressure-ladder
  entry (former scenario-matrix entry, retargeted).
- Hooks entry: deprioritized with the Haiku evidence.
- `two-step-search-then-rename` reproducible red (pre-existing, text-independent):
  folded into the grader/assertion-audit entry, which is now Haiku-scoped.
- Qwen-family robustness check: only relevant if the 70B stress lane is used for tuning
  again; noted in the audit entry's scope rather than as standalone work.
