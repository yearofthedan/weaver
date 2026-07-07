# Agentic rate lane: hosted model never invokes the weaver CLI

**type:** bug
**date:** 2026-07-07
**tracks:** handoff.md # Framing investigation: get the hosted model to actually invoke the weaver CLI

---

## Symptom

The hosted trigger-rate lane's first baseline (OpenRouter Llama 3.3 70B, temp 0.7, 3 trials/case) scored **0/9** twice: no scenario ever completed the two-hop chain (Read SKILL.md → bash `weaver <cmd>`). The two runs took opposite wrong paths:

- Run 1: hallucinated tool calls named after the skills (`weaver-refactor`, `weaver-search-and-replace`) — names that are not in the declared tool set (`bash`/`Glob`/`Grep`/`Read`).
- Run 2: raw shell via the declared tools (`grep`/`sed`/`tsc`-shaped bash, `Grep`, `Glob`).

```
input:    pnpm eval trigger-agentic (9 skill-trigger cases × 3 trials, hosted 70B)
actual:   0/9 cases reach a bash call matching ^(npx |pnpm exec )?weaver <cmd>\b
expected: rate ≥ 2/3 per case, via Read SKILL.md → bash weaver <cmd>
```

**Unverified link in the claim:** the trail log records only tool *names* (`trigger-agentic.llm.test.ts` trailSummary), so "the model never emitted `weaver` via bash" has not been distinguished from a matcher false-negative in `isWeaverInvocation` (e.g. the model emitting `cd /path && weaver rename …` or `node dist/adapters/cli/cli.js rename …`, which the anchored regex rejects). Step zero is logging the raw bash command strings and re-running.

A stopgap currently credits a hallucinated right-skill tool call as a pass proxy (`matches` accepts `call.name === expect.skill`) — that is skill *selection*, not CLI invocation; it masks the failure in the rate number but not in the trail.

## Value / Effort

- **Value:** Gates spec 2 (grader refinement + assertion audit + single-shot retirement) — all grader work is meaningless while the lane produces zero real weaver invocations to classify. Until fixed, the eval cannot measure the thing it exists to measure: whether skill-description edits change real CLI adoption.
- **Effort:** Investigation is cheap (one instrumented re-run, ~27 hosted calls minimum). Candidate causes are localised: the `<available_skills>` framing in `eval/harness/context.ts`, the pass rule in `eval/harness/assertions.ts`, and provider variance in `callModel`.

## Expected

Under the two-hop framing, a ≥2/3 per-case rate of trials in which the model emits a bash tool call whose command matches `isWeaverInvocation(cmd, expectedCommand)` — i.e. the model treats weaver as a CLI to run via bash, not as a callable tool or something to ignore for grep/sed.

## Root cause

*Confirmed 2026-07-07 by instrumented reproduction (raw bash command strings + per-trial `skillMdRead` logging; full run + 3-case subset re-run, OpenRouter Llama 3.3 70B, temp 0.7).*

The `<available_skills>` block built by `buildAvailableSkillsPrompt` (`eval/harness/context.ts:72`) is consumed by the hosted model as a **tool catalogue**, not as documentation pointers. Across all 36 instrumented trials:

- **Zero SKILL.md reads** — `skillMdRead` was false in every trial. The "Skills are not callable tools. To use a skill: read its SKILL.md at the location shown, then execute the instructions using your existing tools" instruction is never followed; the chain's first hop never fires.
- **Zero weaver bash invocations** — no bash command string contained `weaver` at all. The matcher false-negative hypothesis is refuted: `isWeaverInvocation` never saw a weaver command to reject.
- The model does one of two things instead: (a) emits **hallucinated tool calls named after the skills** with invented, trial-to-trial-inconsistent argument schemas (e.g. `weaver-refactor({"oldName","newName","line","column"})`, then `{"old_name","new_name"}`, then `{"old","new"}`, `{"source","destination"}`, `{"old_path","new_path"}`) — tools that are not in the declared set; or (b) ignores the skills entirely and applies shell habit via the declared tools (`sed -i`, `find -exec sed`, `tsc --noEmit`, `Grep`), repeating the same command for all 6 budget steps.

The 2/9 baseline "passes" were entirely the stopgap proxy (`matches` crediting `call.name === expect.skill`) recognising failure mode (a) — skill selection, never CLI invocation. Trail evidence: `scratchpad/eval-trigger-agentic-instrumented-run2.log` and `eval-trigger-agentic-subset-run3.log` (this session); representative trails quoted above are reproducible via `pnpm eval trigger-agentic`.

## Fix

*(As implemented — the first candidate, a hand-written "the weaver CLI is installed" prose framing, was rejected mid-investigation: no real user writes that into a system prompt, so the lane would measure a framing that occurs nowhere. The shipped fix simulates the real host mechanism instead.)*

Simulate the host's skill mechanism in the lane:

- Declare one generic `Skill` tool (`SKILL_TOOL`, `eval/harness/tools.ts`) alongside bash/Glob/Grep/Read — the indirect skill-by-name form a real host exposes, not one tool per skill.
- The `<available_skills>` block keeps verbatim frontmatter descriptions and SKILL.md locations; its trailing instruction now says: invoke a skill as a tool by name and its instructions are loaded into the conversation (`buildAvailableSkillsPrompt`, `eval/harness/context.ts`).
- A `Skill(skill: <name>)` call — or a Read of the SKILL.md path — is the *load hop*: the loop feeds back the real SKILL.md body, records `skillMdRead`/`readTurn`, and keeps it out of the trail.
- A hallucinated direct skill-name call gets a host-style unknown-tool error and stays in the trail; the model recovers to the proper `Skill` form.
- Pass = a bash `weaver <expected-command>` call (`isWeaverInvocation`) — the stopgap skill-name proxy is removed.
- Hardening shipped alongside: `callModel` marks tool calls with malformed JSON arguments (`invalidArguments`) instead of throwing, and the loop answers them with an invalid-arguments error; `chaiConfig.truncateThreshold: 0` in `vitest.llm.config.ts` so long case names stay distinct for `-t` filtering.

The single-shot lanes (`trigger.llm.test.ts`, `trigger-adversarial.llm.test.ts`) still use `skillTools()` and are untouched (their retirement is spec 2).

## Security

- **Workspace boundary:** N/A — eval harness only; no workspace reads/writes change.
- **Sensitive file exposure:** N/A — sends only repo-public skill files and canned fixtures to the hosted endpoint (trust boundary already accepted in the archived rate-lane spec). The API key stays in env, never committed or logged.
- **Input injection:** N/A — in-memory message arrays; no user-supplied strings reach filesystem or shell.
- **Response leakage:** Raw bash command strings from the model now appear in test output logs — model-generated content only, no secrets.

## Edges

- If the matcher is the culprit (false-negative), sibling forms to check: `cd … && weaver …` chains, `node dist/adapters/cli/cli.js …`, `./node_modules/.bin/weaver …`, backgrounded/piped forms.
- If framing is the culprit, verify the fix doesn't regress the command-stage lanes (temp 0, single-shot) which use a different context builder.
- Provider variance is confounding: two runs diverged more than temp 0.7 explains; any conclusion needs either a pinned provider or enough trials to average over routing.

## Done-when

- [x] Raw bash command strings logged per trial in the rate lane (permanent diagnostic, not throwaway)
- [x] Instrumented re-run completed; "no weaver invocation" **confirmed** (framing root cause; matcher refuted), recorded in Root cause with trail evidence
- [x] Fix implemented in-session (user-directed): host-style `Skill` tool + SKILL.md body feedback; subset-validated, then full-lane re-baselined
- [x] `pnpm check` passes (lint + build + test; 214 eval unit tests)
- [x] Non-obvious gotchas (hosted tool-hallucination + recovery, malformed-JSON tolerance, title truncation) added to `docs/eval-design.md`
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Fixed and re-baselined.** Root cause held: hosted models consume an `<available_skills>` block as a tool catalogue regardless of instruction text. The fix stopped fighting that behaviour and simulated the host mechanism it implies: a generic `Skill` tool whose invocation feeds back the real SKILL.md body. With it, the two-hop chain completes — including recovery from hallucinated direct skill-name calls via a host-style unknown-tool error.

**Post-fix baseline** (OpenRouter Llama 3.3 70B, temp 0.7, 3 trials/case, pass floor 2/3, pass = real `bash weaver <cmd>`):

| Case | Rate | Classification |
|---|---|---|
| trigger-refactor-rename | 3/3 | pass — full chain (hallucination → error → Skill load → CLI) |
| trigger-refactor-rename-no-coords-sed-tempting | 2/3 | pass — one trial lost to sed habit |
| trigger-refactor-move-file | 3/3 | pass |
| trigger-search-and-replace-pattern | 0/3 | skill-text gap — sed habit; one load-no-convert |
| trigger-search-and-replace-todos-grep-tempting | 0/3 | skill-text gap — pure Grep, no skill contact |
| trigger-search-and-replace-sed-tempting | 0/3 | skill-text gap — sed habit; one load-no-convert |
| trigger-code-inspection-find-references | 0/3 | skill-text gap — pure grep habit, no skill contact |
| trigger-code-inspection-find-references-delete-intent | 2/3 | pass — one trial loaded but never emitted the CLI |
| trigger-code-inspection-get-type-errors | 0/3 | skill-text gap — tsc habit, no skill contact |

Every red is a classified description loss (Done-when (a) from the rate-lane spec); tuning queued in handoff. A new signal class is now observable: **loaded-but-didn't-convert** — right skill selected, body in context, model still runs sed. That is the body-under-pressure gap made measurable.

**Secondary findings:**
- The 7B-era "weaver-refactor loses to weaver-search-and-replace for rename" finding did **not** reproduce on the 70B two-hop lane (rename cases pass); its handoff entry is retired.
- Grep habit-momentum is confirmed as the load-bearing pressure on the 70B (find-references/todos-grep reds never touch skills at all).
- OpenRouter provider pinning was **not** needed for the fix — path variance persists across trials but the rate metric absorbs it; revisit only if run-to-run rate deltas prove noisy.

**Reflection.**
- *Went well:* subset-first iteration (2 cases, ~40 calls/run) made each framing experiment ~1 minute; raw-argument trail logging (this spec's step zero) turned every subsequent run into direct evidence. The `pass-cli run` secret-reference pattern kept the API key out of the transcript.
- *Didn't:* the first fix candidate (prose "weaver CLI is installed" framing) optimised for making the model comply instead of for real-world fidelity — user caught it; the corrected design (simulate the host) was both more faithful *and* more effective. Lesson: when a model "misbehaves" against a simulated surface, first ask whether the real surface would have absorbed that behaviour.
- *Slower than needed:* two runs wasted on vitest's silent 40-char test-title truncation breaking `-t` filtering; `vitest list` diagnosed it in seconds — probe filters with `vitest list` before spending model calls.
- Tests added: 6 (malformed-JSON ×3 across callModel/loop, SKILL_TOOL ×3) plus 2 rewritten framing-contract tests. Mutation: N/A (`eval/` is stryker-excluded).
