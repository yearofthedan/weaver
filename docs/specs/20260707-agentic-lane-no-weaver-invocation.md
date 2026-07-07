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

Reframe the rate lane's system prompt so weaver is presented as an **installed CLI reachable through the declared bash tool**, not as an `<available_skills>` block that pattern-matches to tool definitions. In `eval/harness/context.ts`, rework the prompt builder to state: bash is available; the `weaver` CLI is installed; each capability group is listed with its **verbatim frontmatter description** (still the artifact under test) and its docs path; to use one, read the docs file, then run the `weaver` command it documents via bash. The framing must stay neutral on *when* to prefer weaver — a "prefer weaver over sed" line would put the answer in the frame and stop the eval measuring the descriptions.

Iterate empirically on a 2-case subset covering both observed failure modes (`trigger-refactor-rename-no-coords-sed-tempting` for shell habit, `trigger-code-inspection-find-references` for hallucinated skill-tools) before validating on the full lane.

Once real `bash weaver <cmd>` invocations appear: remove the stopgap skill-name proxy from the lane's `matches` predicate so a pass requires a real invocation, and re-baseline the full lane. Pin the OpenRouter provider (`provider` routing param in the request body) if run-to-run path variance persists at that point.

Adjacent inputs: the builder's unit tests (`context.test.ts`) pin the old framing and must move with it; the single-shot lanes (`trigger.llm.test.ts`, `trigger-adversarial.llm.test.ts`) still use `skillTools()` and are untouched (their retirement is spec 2).

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

- [ ] Raw bash command strings logged per trial in the rate lane (permanent diagnostic, not throwaway)
- [ ] Instrumented re-run completed; "no weaver invocation" either confirmed (framing root cause) or refuted (matcher root cause), recorded in Root cause with trail evidence
- [ ] Fix routed: `/slice` if unambiguous, or handoff re-tagged `[needs design]` for `/spec` if architectural (framing rewrite vs provider pinning vs both)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Non-obvious gotchas (OpenRouter provider routing, hosted tool-hallucination behaviour) added to `docs/eval-design.md`
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
