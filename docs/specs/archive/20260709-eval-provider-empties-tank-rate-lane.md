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

*As implemented — the empty-completion check lives in `callModel` (not just the setup
probe), so it also fires mid-run; the setup probe reuses it.*

1. **Doc recommendation.** `docs/eval-design.md` and the handoff task text no longer
   recommend `DeepInfra`; they recommend a *verified tool-calling* provider (AkashML,
   8/8 tool calls, pinnable) and state the principle: pin a provider that emits tool
   calls for this model; a pin that returns empty completions with tools present is worse
   than no pin. `config.ts`'s example provider comment updated to match.

2. **`callModel` treats an empty-completion-with-tools as a provider fault.** When tools
   were offered and the response carries neither a tool call nor text
   (`isEmptyWithTools`), it retries (`MAX_EMPTY_ATTEMPTS = 3`, empties return fast) and
   then throws a named error pointing at `WEAVER_EVAL_PROVIDER` — instead of returning an
   empty response the agentic loop would score 0. This is the robust safety net: it fires
   on every affected call during a run.

3. **Setup probe (`global-setup.llm.ts` → `probeToolCalling`).** After the env check,
   sends one tool-carrying request via `callModel`; the reused empty-completion throw
   fails setup fast with the provider-named message. Note: against an *intermittent*
   provider (DeepInfra ~62% empty) the probe is probabilistic — a lucky non-empty probe
   lets the run start, and the mid-run throw from (2) then catches it loudly. The probe
   catches a *consistently* broken provider in seconds; (2) catches the intermittent one.

4. **Transient timeout retried once.** `callModel` retries a `TimeoutError`
   (`MAX_TIMEOUT_ATTEMPTS = 2`) before propagating — a single network abort no longer
   discards a whole case. The retry is narrow to `err.name === "TimeoutError"`; a real
   HTTP error (non-2xx) and a generic network `TypeError` still throw on the first
   attempt (existing "propagates network errors without retrying" test still holds).

**Adjacent inputs covered by tests:** empty-completion *with tools* (retries then throws
named fault) vs. empty-completion *without tools* (returns empty, no retry) vs. text-only
reply *with tools* (returned as-is, not a fault); `TimeoutError` on attempt 1 that
succeeds on retry (recovered, 2 fetches) vs. persistent timeout (throws after 2); a
non-timeout error (no retry). Setup probe: resolves on a tool call, sends a tool in the
request, rejects on persistent empties, and does not probe when env vars are missing.

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

- [x] `docs/eval-design.md` + the handoff task no longer recommend DeepInfra; a verified
      tool-calling provider (AkashML) is documented as the reproducibility pin, with the
      principle stated
- [x] `global-setup.llm.ts` fails fast with a provider-named message when the configured
      provider returns an empty completion to a tool-carrying probe
- [x] A transient `TimeoutError` is retried (not scored as a red); a persistent one still
      fails; a non-timeout HTTP error still throws immediately
- [x] Regression tests cover the adjacent inputs listed in Fix (11 tests added)
- [x] Mutation: N/A — all touched files are under `eval/`, which is Stryker-excluded
- [x] `pnpm check` passes (1081 main + 229 eval-unit tests)
- [x] `docs/eval-design.md` gotcha added: DeepInfra returns empty completions with tools
      present; pin a tool-calling provider and probe it at setup
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Fixed and verified end-to-end** (`meta-llama/llama-3.3-70b-instruct` via OpenRouter).
Against the real broken provider, DeepInfra now dies loud — *"Model server returned an
empty completion (no tool call, no content) 3× while 5 tool(s) were offered … Check
WEAVER_EVAL_PROVIDER"* — where it previously scored the `refactor-rename` control a
silent 0/3. AkashML passes cleanly. Commits: `ab9271b` (spec) and `1d2c88b` (fix).

The fix routes empty-completion handling through `callModel`, not just the setup probe —
which turned out to matter: the setup probe alone would not reliably catch an
*intermittent* provider (a lucky non-empty probe lets the run start), but the per-call
mid-run throw catches every affected call. Verified: DeepInfra failed at case time this
run, not at the probe.

**Tests added:** 11 (6 in `call-model.test.ts` for the two fault classes + guards, 3 in
`global-setup.test.ts` for `probeToolCalling`, plus 2 existing success-path tests
rewritten to mock `fetch` — previously they resolved without asserting provider
behaviour). Mutation: N/A (`eval/` is Stryker-excluded).

**Reflection.**
- *Went well:* the harness-trust step (`/investigate` principle 4) paid off immediately —
  proving the lane with a green control surfaced the DeepInfra confound in the first two
  runs, before any skill-text conclusion could be drawn from noise. Direct OpenRouter
  probes (8 samples/provider) quantified the empty-rate cleanly and cheaply.
- *Didn't:* the first full lane run cost ~32 minutes largely because two cases hung on
  60s timeouts — the exact fragility this fix addresses; had the timeout-retry existed,
  that run would have been usable. Fixing the apparatus should precede trusting its
  output, which is the whole point of this split.
- *For the next agent:* the redesign task (`/spec`) now has a trustworthy lane. Every
  persistent red is `never-touch` shell habit; do not spend effort on skill *slicing*
  (no misrouting to eliminate) — the lever is trigger-description strength vs shell habit
  for text-search / find-references / get-type-errors. Pin `WEAVER_EVAL_PROVIDER=AkashML`
  (not DeepInfra) when measuring.
- *Watch:* AkashML routing/availability can change over time; if it stops emitting tool
  calls the setup probe will now say so. Re-pick a verified provider from OpenRouter's
  list for `meta-llama/llama-3.3-70b-instruct` if that happens.
