# Rate lane: recommended provider pin returns empty completions and tanks every case

**type:** bug
**date:** 2026-07-09
**tracks:** handoff.md # Skill slicing & description redesign for the shell-habit-losing cases (investigation split-off)

---

## Symptom

The agentic rate lane's per-case numbers are not a skill-text signal — they are
dominated by which OpenRouter backend serves the request. Two apparatus faults corrupt
the tally:

1. **The documented reproducibility pin is broken.** `docs/eval-design.md:10` and the
   handoff task both instruct pinning `WEAVER_EVAL_PROVIDER=DeepInfra` "for
   reproducibility." Under that pin the rock-solid control `trigger-refactor-rename`
   (baseline 3/3) scores **0/3**, every trial "(no tool calls)".
2. **A transient network timeout counts as a red.** A single 60s `TimeoutError` on one
   model call throws the whole case, discarding all its trials and printing no rate — a
   network abort masquerading as a skill-text loss. In a full 9-case run, two cases were
   lost this way.

```
input:    pnpm eval trigger-agentic, WEAVER_EVAL_PROVIDER=DeepInfra (the documented pin)
actual:   trigger-refactor-rename 0/3, all "(no tool calls)"; DeepInfra returns an empty
          assistant message ~62% of the time when tools are present
expected: refactor-rename ≥ 2/3 (it is 3/3 under a working provider); reds attributable
          to skill text, not to provider tool-call breakage
```

## Value / Effort

- **Value:** Blocks the skill-redesign task entirely. Any per-case rate measured under
  the documented pin is provider noise; tuning skill descriptions against it optimises
  against a broken oracle. The archived baseline's five "description losses" are not
  trustworthy — two of them flip to clean 3/3 under a working provider with **no skill
  edit** (see Root cause). High value: the confound silently corrupts the one number the
  lane exists to produce.
- **Effort:** Root cause confirmed and localised (one doc recommendation, one setup
  probe, one retry wrapper). No new infrastructure.

## Expected

- The documented reproducibility pin names a provider that actually emits tool calls, so
  the rate reflects skill text.
- A broken/empty-completion provider is caught **before** a multi-minute run, not
  silently scored as 0.
- A transient `TimeoutError` does not convert a whole case to a red.

## Root cause

*Confirmed 2026-07-09 by direct OpenRouter probes and instrumented lane runs
(`meta-llama/llama-3.3-70b-instruct`, temp 0.7). Evidence logs:
`scratchpad/akash-full.log`, `akash-two.log`, `ctrl-deepinfra.log`, `ctrl-nopin.log`,
`probe-out.json`.*

**Primary — the recommended pin breaks tool-calling.** With
`WEAVER_EVAL_PROVIDER=DeepInfra`, OpenRouter's DeepInfra backend for this model returns
an **empty assistant message** (`content: null`, no `tool_calls`, `finish_reason: null`)
whenever `tools` are present. Across 8 identical single-tool probes: **5/8 empty, 3/8
tool call** — intermittent, so it both depresses *and* adds noise to every case.
`callModel` maps the empty message to `{toolCalls: [], text: ""}`
(`eval/harness/call-model.ts:122,141`); the loop then hits its "no tool calls → abandon"
branch (`eval/harness/agentic-loop.ts:105`) and scores the trial 0. Result:
`trigger-refactor-rename` = **0/3** under DeepInfra vs **3/3** unpinned. Unpinned,
OpenRouter routed **8/8** probes to **AkashML**, which returns proper
`finish_reason: tool_calls` every time and is pinnable
(`provider: {order:["AkashML"], allow_fallbacks:false}`). The archived baseline
(`20260707-agentic-lane-no-weaver-invocation.md`) ran **without** a pin — its numbers are
real-but-noisy; the DeepInfra recommendation was added by the reproducibility follow-up
and was never validated against tool-call emission.

**Secondary — the confound explains the "description losses."** Re-measured under
AkashML (pinned, working, reproducible), 3 trials/case, with temporary instrumentation
recording *which* skill each load hop pulled:

| Case | AkashML now | Baseline (unpinned) | Mechanism under AkashML |
|---|---|---|---|
| refactor-rename | 3/3 | 3/3 | loads `weaver-refactor`, converts |
| refactor-rename-no-coords-sed | 3/3 | 2/3 | loads `weaver-refactor`, converts |
| refactor-move-file | 3/3 | 3/3 | loads `weaver-refactor`, converts |
| search-and-replace-pattern | **3/3** | **0/3** | loads correct skill, converts |
| find-references-delete-intent | **3/3** | **2/3** | loads `weaver-code-inspection`, converts |
| search-and-replace-sed-tempting | 0/3 | 0/3 | **never-touch** — pure `sed`, no skill loaded |
| search-and-replace-todos-grep | 0/3 | 0/3 | **never-touch** — pure `Grep`, no skill loaded |
| code-inspection-find-references | 0/3 | 0/3 | **never-touch** — pure `Grep`, no skill loaded |
| code-inspection-get-type-errors | 0/3 | 0/3 | **never-touch** — pure `tsc`, no skill loaded |

Two baseline reds (`search-and-replace-pattern`, `find-references-delete-intent`) flip to
clean 3/3 with **zero skill edits** — provider/routing variance, not skill text. Every
persistent red is **never-touch**: shell habit (sed/grep/tsc) wins the trigger decision
and no skill is ever loaded. Under AkashML, neither of the two failure mechanisms the
earlier apparatus reported is reproducible:

- **No `loaded-but-didn't-convert`** (body miss). The baseline's "one load-no-convert"
  sed trials did not recur; sed-tempting is pure never-touch here.
- **No `wrong-skill` misrouting.** The handoff's headline "confirmed cause" — that
  `find-references` loads `weaver-search-and-replace` (the text-search skill) 4/6 trials,
  reading the identifier as a `pattern` — **did not reproduce in 6 AkashML trials**
  (3 plain + 3 delete-intent). `find-references` never loads *any* skill; it greps
  directly. The wrong-skill loading was a property of whatever backend the earlier
  unpinned runs happened to route to, not of the skill definitions.

The load-bearing conclusion: **mechanism cannot be attributed without controlling the
provider**, and the provider recommended for that control is the one that breaks the
measurement.

## Fix

1. **Doc recommendation (unambiguous).** In `docs/eval-design.md:10` and the handoff
   task text, stop recommending `DeepInfra`. Recommend a *verified tool-calling*
   provider (AkashML observed 8/8 tool calls, pinnable, reproducible). State the
   principle: pin a provider that emits tool calls for this model; a pin that returns
   empty completions with tools present is worse than no pin.

2. **Fail fast on a broken provider (setup probe).** In `eval/global-setup.llm.ts`, after
   the endpoint reachability check, send one minimal request *with a tool declared* and
   assert the response carries either `tool_calls` or `content`. An empty message
   (no tool_calls, null/empty content) fails setup with a message naming the provider and
   the empty-completion cause — so a broken pin surfaces in seconds, not after a 30-min
   run of silent zeros.

3. **Do not let a transient timeout become a red.** In the per-trial call path
   (`callModel` / `runAgenticLoop` step), retry a `TimeoutError` (network abort, name
   `"TimeoutError"` / `AbortSignal.timeout`) a small fixed number of times (e.g. 2) before
   propagating. A retried transient no longer discards a case's trials. Keep the retry
   narrow to timeout/abort — a real HTTP error still throws immediately.

**Adjacent inputs to cover with tests:** an empty-completion response *with tools sent*
(setup probe rejects) vs. a legitimate text-only response (setup probe accepts); a
`TimeoutError` on attempt 1 that succeeds on retry (case survives) vs. a persistent
timeout (still fails after retries); a non-timeout HTTP error (no retry — throws at once).

## Security

- **Workspace boundary:** N/A — eval harness only; no workspace reads/writes change.
- **Sensitive file exposure:** N/A — sends only repo-public skill files and canned
  fixtures to the endpoint. The OpenRouter API key stays in env (operator's secret
  manager), never committed or logged; the setup probe sends no secret in its body.
- **Input injection:** N/A — in-memory message arrays; no user-supplied strings reach the
  filesystem or shell.
- **Response leakage:** No new leakage surface. The setup probe's assertion reads only
  presence of `tool_calls`/`content`, not their values.

## Edges

- DeepInfra empties are *intermittent* — a single passing trial does not clear the
  provider; only the rate over ≥8 samples does. The setup probe should therefore not be
  a single request if a one-shot false-negative would wrongly reject a good provider;
  a good provider returned tool calls on every probe, so one probe is acceptable, but
  note this if false setup failures appear.
- Provider routing is time-varying: unpinned routed 100% to AkashML at investigation
  time; that can change — which is exactly why a *working* provider must be pinned
  explicitly rather than relying on unpinned routing.
- Verify the working-provider pin does not regress the command/two-step lanes (temp 0;
  they may route differently).

## Done-when

- [ ] `docs/eval-design.md` + the handoff task no longer recommend DeepInfra; a verified
      tool-calling provider is documented as the reproducibility pin, with the principle
      stated
- [ ] `global-setup.llm.ts` fails fast with a provider-named message when the configured
      provider returns an empty completion to a tool-carrying probe
- [ ] A transient `TimeoutError` is retried (not scored as a red); a persistent one still
      fails; a non-timeout HTTP error still throws immediately
- [ ] Regression tests cover the adjacent inputs listed in Fix
- [ ] Mutation score ≥ threshold for touched harness files (note: `eval/` is
      stryker-excluded — confirm whether the touched files are in scope; if excluded,
      state so)
- [ ] `pnpm check` passes
- [ ] `docs/eval-design.md` gotcha added: DeepInfra returns empty completions with tools
      present; pin a tool-calling provider and probe it at setup
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

<!-- appended at archive time -->
