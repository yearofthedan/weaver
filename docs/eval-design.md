# CLI Eval Design

**Status:** Partly superseded — see the status note below.
**Date:** 2026-06-10 (supersedes the MCP-based design of 2026-03-01)

---

> **Status note (2026-07-07).** The trigger lane has pivoted **off local Ollama to a hosted OSS model** (OpenRouter, OpenAI-compatible, via the existing `callModel`) and now reports a **trigger *rate*** over N trials rather than temp-0 pass/fail (archived spec `20260707-hosted-model-trigger-rate`). The Ollama-specific sections below (local-model gotchas, `OLLAMA_CONTEXT_LENGTH`, the consumer-fidelity ladder's local rungs) are **superseded** for the rate lane and pending a full rewrite once the framing settles.
>
> **Running the rate lane:** the eval needs an OpenAI-compatible hosted endpoint — set `WEAVER_EVAL_BASE_URL`, `WEAVER_EVAL_MODEL`, and `WEAVER_EVAL_API_KEY` (e.g. an OpenRouter key); `WEAVER_EVAL_TEMPERATURE` (default 0.7) and `WEAVER_EVAL_TRIALS` (default 3) tune the rate. **Set `WEAVER_EVAL_PROVIDER` to pin one OpenRouter backend** — OpenRouter otherwise load-balances a model across providers whose quantization and tool-calling differ, which makes borderline cases wobble run-to-run; pinning trades "Llama-70B in the abstract" for a reproducible signal (state that when reading absolute numbers). **Pin a provider that actually emits tool calls: `AkashML` works for `meta-llama/llama-3.3-70b-instruct` (observed 8/8 tool calls); do NOT pin `DeepInfra` — its backend for that model returns empty completions (`content: null`, no `tool_calls`) ~62% of the time when tools are present, which scores every case 0 regardless of skill text.** A pin that returns empty completions is worse than no pin. `global-setup.llm.ts` fails fast listing any missing var and probes the provider with one tool-carrying request, throwing a named provider fault before the run if the provider drops tool calls. Run `pnpm eval trigger-agentic`.
>
> **Rate-lane framing (2026-07-07, settled):** the lane surfaces skills as an `<available_skills>` block plus a host-style generic `Skill` tool. Invoking `Skill(skill: <name>)` — or Reading the SKILL.md path — is the *load hop*: the harness feeds back the skill's real SKILL.md body, simulating the host's skill expansion. Pass = a bash `weaver <expected-command>` call within the step budget. Two gotchas discovered baselining on a hosted 70B: (1) the model reliably *hallucinates direct skill-name tool calls* (`weaver-refactor({...})`, invented arg schemas); the harness answers with a host-style unknown-tool error and the model reliably recovers to the proper `Skill` form — do not declare per-skill tools to "fix" this, that removes the recovery behaviour a real host exhibits. (2) Hosted models sometimes emit tool calls with **malformed JSON arguments**; `callModel` marks such calls (`invalidArguments`) and the loop feeds back an invalid-arguments error instead of crashing the trial. An earlier framing (instruction to Read the SKILL.md, no `Skill` tool) baselined 0/9 with zero skill loads — hosted models consume an `<available_skills>` block as a tool catalogue no matter what the surrounding text says.

## Goal

Verify that the shipped skill files cause an AI agent to (a) reach for weaver at all and
(b) emit the correct `weaver` command — instead of defaulting to grep, sed, or manual edits.

Since the MCP transport was removed, agents interact with weaver exclusively through bash
(`weaver <command> '<json>'`), discovered via the skill files in `.claude/skills/`. Those
files are therefore the product surface under test, at two distinct decision points:

1. **Trigger stage** — in a real agent host, only the skill's one-line frontmatter
   *description* is in context when the agent decides whether to load the skill. If the
   description doesn't win against the agent's shell habits, the rest of the skill file
   may as well not exist.
2. **Command stage** — once the skill is loaded, the full SKILL.md must instruct the
   model well enough to emit a correct `weaver` invocation with the right arguments.

## Non-goals

- **Engine correctness regression** — unit tests cover this
- **Real command execution** — emitted commands are asserted on, never run; no daemon involved
- **CI gating** — the eval runs on the maintainer's machine on demand (`pnpm eval`)
- **Absolute scores** — see "Interpreting results" below

## Architecture

Plain vitest + `fetch` against a **local model server** (Ollama's OpenAI-compatible API).
No eval framework, no API key, no cost; nothing leaves the machine.

```
eval/cases/cases.ts          ← typed case table (trigger + command stages)
eval/cases/*.llm.test.ts     ← LLM cases; run ONLY via `pnpm eval` (vitest.llm.config.ts)
eval/cases/coverage.test.ts  ← invariant: every operation has a case (runs in pnpm check)
eval/harness/call-model.ts   ← one fetch per case; temperature 0, single-shot, 60s abort
eval/harness/context.ts      ← system prompts built from .claude/skills/ at run time
eval/harness/assertions.ts   ← extractBashCommands + matchWeaverCommand (pure, unit-tested)
eval/harness/seed.ts         ← pre-seeded conversations for two-step flows
eval/fixtures/*.json         ← canned CLI stdout, embedded as tool results in two-step cases
```

Skill content is read from `.claude/skills/` at run time — the eval can never drift from
what ships. Lane separation is a hard constraint: `pnpm check` runs the helpers' unit
tests and the coverage invariant but never needs a model server.

### Case stages

- **Trigger cases:** each shipped skill is declared as its own tool whose description is
  the skill's frontmatter description — the artifact under test sits directly on the
  decision surface — alongside a `bash` tool. Pass = the model's first tool call matches
  the case's `expect.tool`. For most cases that is a skill, and a bash-first or wrong-skill
  response fails. **Boundary cases** (`boundary-*`) invert this: their `expect.tool` is
  `"bash"` — legitimate shell work (list files, run tests, tail a log) that must *not* be
  pulled into a skill. They guard against an aggressive description over-triggering; a
  skill-first response fails them.
- **Command cases:** the full SKILL.md bodies plus the task go in the user turn, with an
  instruction to reply with only the command (text emission — see gotchas for why not a
  declared bash tool). Pass = the response parses as `weaver <expected-subcommand>
  '<json>'` with the case's key arguments. `&&`-chained commands are split into
  candidates: a safety check before a destructive command is correct behaviour.
  Assertion failures distinguish "no weaver attempt" from "weaver attempted but JSON
  malformed" — the latter is a local-model formatting failure, not a skill-text failure.
- **Two-step cases:** the conversation is pre-seeded as plain turns — user task,
  assistant step-1 command, user turn with the command's canned output from
  `eval/fixtures/`; the assertion checks the follow-up command (e.g. `search-text`
  results in context → `rename`).

### Local-model gotchas (hard-won, 2026-06-10)

Empirical findings from qwen3:8b and qwen2.5:7b-instruct over Ollama 0.30.7 — re-test
before "simplifying" the harness back to declared tools:

- **Ollama silently drops tool calls it cannot parse.** A bash call whose `command`
  argument embeds JSON (i.e. every weaver invocation) comes back as
  `tool_calls: null, content: ""` — tokens are generated (visible in usage) and then
  swallowed. This is why command-stage cases use text emission.
- **Small models cannot do skill-tool indirection.** Given "Available skills: refactor…"
  and a `skill(name)` tool, they emit a call to an undeclared function named `refactor`,
  which the server drops. Declaring each skill as its own tool works reliably.
- **Thinking-mode lineages stall on emission.** qwen3 at temperature 0 reasons to a
  correct conclusion ("the correct tool call is refactor with those parameters") and
  then stops without emitting anything — with thinking enabled or disabled, on both API
  endpoints. Prefer non-thinking instruct models (qwen2.5) for this harness.
- **Ollama's OpenAI endpoint ignores `num_ctx`.** The server default applies
  (`OLLAMA_CONTEXT_LENGTH`, 4096 unless raised). The current skill content (~3.2k
  tokens) plus task fits; if skills grow past ~3.8k tokens, raise the server-side env
  var or prompts will be silently truncated.

## Running

```bash
ollama serve            # if not already running
ollama pull qwen2.5:7b-instruct    # one-time
pnpm eval               # full run, ~2–5 minutes
pnpm eval two-step      # vitest file filters work as usual
```

Model and server are overridable: `WEAVER_EVAL_MODEL=qwen3:14b WEAVER_EVAL_BASE_URL=... pnpm eval`.
`callModel` also accepts an explicit config parameter, so a multi-model comparison run or
an alternate transport (e.g. the Anthropic API) plugs in without touching cases or assertions.

## The skill-editing loop

The eval exists for one workflow: **edit a skill file → `pnpm eval` → read what flipped.**
Movement is the signal; the absolute score is not (see "Interpreting results"). A case
that goes red after a description edit is a regression; a case that goes green confirms
the fix. The skill files are read from disk at run time, so there is no build step
between editing and re-running.

### Reading a failure

Every assertion failure names the case, the task, and what the model actually did:

- **Trigger case failed** — a frontmatter description lost the selection. The message
  says which tool won: `bash` means the description lost to shell habits (the core
  failure weaver's skills exist to prevent); a sibling skill name means two descriptions
  overlap on that task type.
- **Command case failed** — the full skill text produced the wrong command. The message
  lists every command emitted with a classified reason:
  - `wrong subcommand` / `missing key arg` / `wrong key arg value` — the skill text
    under-specifies; usually fixable with one clarifying line in the SKILL.md
  - `weaver attempted but JSON malformed` — local-model formatting noise, not a
    skill-text problem; ignore unless it dominates a case
  - `no weaver attempt` — the skill content failed to land at all
- **The file you edit for cases** is `eval/cases/cases.ts` — a flat typed table; each
  case is ~6 lines and adding one is copying a neighbour. The coverage test in
  `pnpm check` will tell you if an operation lacks a case.

### Running one lane, one case, and re-running for stability

- **Filter to a lane** with `--testNamePattern` against the *static* part of the test
  title, e.g. `pnpm exec vitest run --config eval/vitest.llm.config.ts --testNamePattern
  "model selects the correct skill"` for the trigger lane, or `"model emits correct
  weaver command"` for the command lane. **You cannot filter to a single case by name:**
  the cases use `it.each(...)("$name — …")`, and vitest matches `--testNamePattern`
  against the *uninterpolated* template (`"$name — …"`), not the interpolated case name.
  Match a static suffix and read the per-case lines in the output.
- **Re-run a lane 2–3× by hand when a knife-edge case is in play.** At temperature 0 the
  same prompt is near-deterministic (a wording regression reproduces every run, a true
  flap does not), so a couple of repeats cheaply separates "I broke it" from "this case
  was always noisy." In-suite repeat-N is deliberately *not* built into this lane: at
  temp 0 it would burn compute for identical answers. Repeat-N earns its cost only at
  temperature > 0, where it estimates a trigger *rate* — that belongs to the adversarial
  /statistical-rates lane queued in `docs/handoff.md`, not here.

### Frontmatter feeds the command prompt too

`skillContext()` returns the **whole** SKILL.md including frontmatter, so a description
edit aimed at the *trigger* stage also lands in every *command*-stage prompt. A vivid
example: rewording weaver-search-and-replace's description to say "TODO **comments**"
fixed the trigger routing for "find all TODO comments" but simultaneously made the 7B
model emit `pattern: "// TODO"` in the command lane (it read "comments" as the literal
comment marker). The fix kept the trigger win and undid the command regression by using
"markers like TODO" instead. Lesson: after any description edit, run **both** lanes, not
just the one you were aiming at.

## Interpreting results

The eval model (`qwen2.5:7b-instruct`) is **not** the model weaver's users run. Results are:

- **Valid as relative signal** — a description edit that drops the trigger pass-rate is a
  regression worth investigating regardless of model family.
- **Valid as a stress test** — a description that reliably triggers a small local model is
  robust; stronger models are an easier audience.
- **Not valid as absolute truth** — the simulated system prompt is far less crowded than a
  real agent host's, so trigger rates read optimistic; and Claude-class models select
  tools differently than Qwen-class ones. Don't tune skill text to chase a local-model
  score.

## Consumer-fidelity ladder

The eval tests AI *consumers* of weaver's interface, not AI features in the product. The
rungs climb toward the real audience, and each catches a different bug class — a reasoning
model surfaces selection failures (reaching for grep over a text-search skill) that a
keyword-matching model cannot. Each rung has its own metric; don't read a lower rung's
signal as a higher rung's verdict.

1. **Structural invariants** — no model; runs in `pnpm check` (`coverage.test.ts` plus the
   harness unit tests): parsing, per-operation coverage, boundary-case existence. Metric:
   deterministic pass/fail.
2. **Local instruct canary** (`qwen2.5:7b-instruct`) — the fast, near-deterministic
   regression lane for the edit→eval→read loop. Metric: single-shot pass/fail, read as
   *relative movement*, not an absolute score.
3. **Local reasoning probe** (e.g. `qwen3`) — a reasoning-pressure check. Free, but Ollama
   emission stalls confound thinking-mode lineages (see gotchas), so failures are
   hypotheses, not a gate.
4. **Frontier cold-context** — a fresh Claude session with no design history, the
   authoritative audience. Costs API time, so it is pre-release rather than per-edit, and
   is currently manual (making it repeatable is queued in `docs/handoff.md`).

The adversarial trigger lane below is not a new rung — it applies host-like *pressure* to
the local rungs (2–3), holding the skill text constant so the pressure is the only variable.

## The adversarial trigger lane

`eval/cases/trigger-adversarial.llm.test.ts` reruns the skill-expecting trigger cases under
the pressures a real agent host applies, without touching the skill files:

- **Competing toolset** — `Edit`/`Grep`/`Glob`/`Read` declared alongside the skills, so a
  loss names which habit won.
- **Cluttered system prompt** — `buildClutterSystemPrompt()` wraps the decision surface in
  generic agent scaffolding. This pushes the prompt past Ollama's 4096 default, so the lane
  needs `OLLAMA_CONTEXT_LENGTH` raised (≈ 16384) or prompts are silently truncated; a 7B
  fits that context on a 16 GB host. **Gotcha:** the macOS Ollama app starts `serve` at the
  4096 default regardless of shell env — set the var in its launch environment, or quit the
  app and run `OLLAMA_CONTEXT_LENGTH=16384 ollama serve` from a terminal. A truncated run
  silently measures the wrong thing (the description gets squeezed, not the clutter).
- **Grep-primed seed** — `buildHabitMomentumSeed()` prepends a successful grep before the
  task, so the model already has shell momentum.

Metric: temperature 0, single-shot pass/fail — the same decoding as the clean lane, with
the poisons as the only variable. Reading the gap against the clean lane:

- **clean-pass + poisoned-fail** → a pressure problem: the description is fine but loses
  under a real host. This is the evidence for a forcing mechanism (host hooks).
- **both fail** → a text problem: fix the skill description.

Because the lane runs at temperature 0, it catches a poison only when it *flips* the top
tool choice. Sub-flip erosion (P(skill) drops but the skill still wins) needs repeat-N
rates on a trustworthy model — deferred to the hosted follow-up in `docs/handoff.md`. Point
the lane at a hosted 32B/72B via `WEAVER_EVAL_MODEL`/`WEAVER_EVAL_BASE_URL` plus
`WEAVER_EVAL_API_KEY` (bearer auth) for that calibration run.

## The agentic trigger lane

`eval/cases/trigger-agentic.llm.test.ts` runs the same skill-trigger subset under the same
pressures as the adversarial lane, but measures the *eventual* operation instead of the first
tool call. `runAgenticLoop` (`eval/harness/agentic-loop.ts`) drives the model forward up to a
step budget (6 — room for the skill-load hop, a precursor, and the operation), feeding a canned
result back after each turn. A skill load (`Skill` tool call or SKILL.md Read) feeds back the
real SKILL.md body and is tracked as `skillMdRead`/`readTurn` without entering the trail; the
case passes when a bash `weaver <expected-command>` invocation is reached within the budget.
Per-trial trails print with raw bash command strings — a name-only trail cannot distinguish
"never ran weaver" from a matcher false-negative.

Why it exists: the single-shot first-call metric cannot tell a *substitution* (grep instead of
search-text) from a reasonable *precursor* (find-references before a rename). It scores
`rename-at-position → find-references-first` as a loss even though the model would rename next.
The agentic lane credits the precursor and checks where the model actually lands.

Reading the gap against the adversarial lane (same case subset, by design):

- **red in adversarial, green here** → a precursor case: the description loses the first call but
  wins within the budget. The single-shot loss was a false negative.
- **red in both** → genuine non-convergence. The agentic lane's `trail` names what the model did
  instead — a wrong-skill substitution (`inspection → search-and-replace → search-and-replace`)
  or no tool call at all. This is the accurate attribution the single-shot lane cannot give: it
  would blame the *precursor* skill that happened to win the first call.

**Gotcha — plain-text echo.** Completed turns are echoed back as plain-text conversation turns
(an assistant text turn plus a user turn carrying the canned result), never as `tool_call`/`tool`
messages. Ollama silently drops seeded tool messages (the same reason seeds use plain text), so a
tool-format echo would corrupt the next turn and silently measure nothing — the same invisible
failure class as the `OLLAMA_CONTEXT_LENGTH` truncation gotcha. The model still emits a fresh tool
call each turn, read straight from the response.

Run: `pnpm eval trigger-agentic` (hosted env vars per the status note). Filter to a case subset
with `-t <case-name-regex>` for cheap iteration; `WEAVER_EVAL_TRIALS=1` for spot checks. Test
titles carry full case names (`chaiConfig.truncateThreshold: 0` in `vitest.llm.config.ts` —
the default 40-char truncation made long case names collide and silently broke `-t` filtering).

## Adding a new operation

The coverage invariant (`eval/cases/coverage.test.ts`, runs in `pnpm check`) fails until:

1. A command-stage case for the operation exists in `eval/cases/cases.ts` (kebab-case
   subcommand, a task whose text determines the key arguments).
2. `eval/fixtures/<operationName>.json` exists (camelCase, matching `OPERATION_NAMES`) —
   model it on an existing fixture; it must look like real CLI stdout.

Trigger cases are not per-operation — add one only when a new *skill* (or a materially
new task category) ships.

## Iteration path

1. **v1:** local model, single-shot, temperature 0, pass/fail per case — the clean lane.
2. **v2 (shipped):** the adversarial trigger lane (see above) — same metric, host-like
   pressure, clean lane retained as the regression baseline.
3. **v3 (shipped):** the agentic trigger lane (see above) — eventual-operation metric under the
   same pressure, crediting sensible precursors the single-shot lanes score as losses.
4. **Later candidates, queued in `docs/handoff.md`:**
   - repeat-N fragility rates (temperature > 0) on the hosted calibration model, to catch
     the sub-flip erosion the pass/fail lanes miss
   - Agent SDK end-to-end runs (real bash, live daemon, file-state assertions) — highest
     fidelity, but subsystem-sized and requires Anthropic API access
