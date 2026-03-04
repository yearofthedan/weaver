# Eval: realistic prompts and competing-tool tests

**type:** change
**date:** 2026-03-04
**tracks:** handoff.md # eval-realistic-tests

---

## Context

The eval suite (`eval/promptfooconfig.yaml`) checks that Claude picks the right light-bridge tool for a given task. The current test prompts are over-specified — they contain domain jargon ("barrel files", "re-exports") and step-by-step workflow instructions that effectively hand the model the answer. There are no tests for ambiguous tasks (symbol name only, no coordinates), no two-step flow coverage, and no check that the model prefers light-bridge tools when generic shell alternatives (bash, grep, sed) are also available.

The `replaceText` tool description compounds this: it opens with an unconditional "Use searchText first to locate targets" instruction that causes the model to always detour through searchText even when pattern mode needs no prior search.

## Value / Effort

- **Value:** Tests that pass because the prompt telegraphs the answer give false confidence. Realistic prompts catch regressions in tool descriptions — if a description stops being compelling enough, the model drifts to a worse tool or a shell fallback. The competing-tool provider tests this for the first time.
- **Effort:** Config-only changes (one YAML file, one description string). No new infrastructure. The competing-tool provider reuses the existing MCP server — it just adds three stub tool definitions alongside it.

## Behaviour

- [ ] **AC1 — Natural prompts.** Every test prompt reads like a message a developer would type. No domain terms such as "barrel files", "re-exports", "compiler-aware". No instructions that name or imply a specific tool or workflow step.

- [ ] **AC2 — Two-step replace.** A test exists with a prompt such as *"I need to replace all occurrences of 'v1' with 'v2' across the project, including in comments."* The assertion checks that both `searchText` AND `replaceText` appear in the tool calls (F1 ≥ 0.8 for the set `{searchText, replaceText}`). Order does not matter.

- [ ] **AC3 — Rename without coordinates.** A test exists with a prompt that gives only the symbol name, e.g. *"Rename the `userId` variable to `accountId` everywhere in the project. I only know the name, not the file."* The assertion checks that both `getDefinition` AND `rename` appear in the tool calls (F1 ≥ 0.8 for the set `{getDefinition, rename}`).

- [ ] **AC4 — Find dependents by intent.** A test exists with a prompt such as *"I want to delete the `parseToken` function. What's using it?"* The assertion checks that `findReferences` is called (F1 ≥ 0.8) and that `searchText` is NOT called.

- [ ] **AC5 — Competing-tool avoidance.** A second provider entry in `promptfooconfig.yaml` includes the light-bridge MCP server plus three stub tools: `bash` (run a shell command), `grep` (search files for a pattern), and `sed` (text substitution). At least two tests target this provider — one search task, one replace task. Each asserts: (a) the expected light-bridge tool is called (F1 ≥ 0.8), and (b) none of `bash`, `grep`, or `sed` appear in the serialised tool-call output.

## Interface

This spec changes two files only:

**`eval/promptfooconfig.yaml`**

- Existing test `vars.task` strings are replaced with natural-language equivalents. Assertions (`type`, `value`, `threshold`) may change where two-step flows replace single-tool checks.
- A new `providers` entry (`label: with-shell-alternatives`) adds `tools:` alongside the existing `mcp:` block. Tool stubs:
  - `bash` — `{ command: string }` — "Run a shell command"
  - `grep` — `{ pattern: string, path?: string }` — "Search files for a text pattern"
  - `sed` — `{ expression: string, file?: string }` — "Stream editor for text substitution"
- Tests targeting the competing-tool provider set `providers: [with-shell-alternatives]`.
- The negative assertion uses `type: javascript` checking `!JSON.stringify(output).includes('"name":"bash"')` etc. (promptfoo serialises tool calls into the output string).

**`src/mcp.ts` (or wherever the `replaceText` description is defined)**

- Remove the unconditional preamble "Use searchText first to locate targets, then replaceText to apply changes." Scope that guidance to surgical mode only. Pattern mode description should make clear it can be called directly with `pattern` + `replacement` + optional `glob`.

## Edges

- The fixture server returns pre-recorded responses; adding new test scenarios does not require new fixture files unless a new tool name is introduced. The stub `bash`/`grep`/`sed` tools are never actually called by the fixture server — the eval measures tool *selection* only, not execution.
- The `tool-call-f1` metric in promptfoo scores against the expected set. For two-tool assertions (AC2, AC3), precision and recall are both computed over the full set — a model that calls only one of the two tools will score 0.5 F1 (below the 0.8 threshold).
- The negative assertion in AC5 is string-based (`JSON.stringify(output)`). If promptfoo changes its serialisation format this may need updating — acceptable risk at current version.
- Existing single-tool tests that are *not* replaced (findReferences, getTypeErrors, moveFile, getDefinition, moveSymbol) keep their current `tool-call-f1` assertions; only their prompt text changes under AC1.

## Done-when

- [x] All ACs verified by running `pnpm eval` (8 → 13 tests, 0 failures at time of write — competing-tool tests need a live eval run to confirm)
- [x] `replaceText` description updated — "use searchText first" guidance scoped to surgical mode
- [x] `pnpm check` passes (415 tests, 0 failures)
- [x] handoff.md current-state section updated (eval test count)
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

- **13 tests** total (up from 9): 7 single-tool positive, 2 two-step flow, 2 negative, 2 competing-tool
- AC3 implemented as `{searchText, rename}` rather than `{getDefinition, rename}` as originally specced — the prompt gives file-but-no-line, which makes searchText the natural first step; getDefinition requires a position to resolve from, so it doesn't fit the no-coordinates scenario
- searchText fixture enriched with userId (line 12, col 9) and v1 (line 1, col 21) matches so two-step tests get actionable results from the fixture server
- Competing-tool provider uses YAML anchor merge (`<<: *mcp_config`) to avoid repeating the MCP server config
- The competing-tool negative assertions use `output.indexOf('"name":"grep"')` — relies on Anthropic compact JSON format; flag if promptfoo changes serialisation
- `pnpm check` passes; competing-tool tests require a live `pnpm eval` run against the Anthropic API to verify E2E
