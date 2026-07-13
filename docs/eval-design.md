# CLI Eval Design

**Status:** Partly superseded — see the status note below.
**Date:** 2026-06-10 (supersedes the MCP-based design of 2026-03-01)

---

> **Status note (2026-07-07).** The trigger lane has pivoted **off local Ollama to a hosted OSS model** (OpenRouter, OpenAI-compatible, via the existing `callModel`) and now reports a **trigger *rate*** over N trials rather than temp-0 pass/fail (archived spec `20260707-hosted-model-trigger-rate`). The Ollama-specific sections below (local-model gotchas, `OLLAMA_CONTEXT_LENGTH`, the consumer-fidelity ladder's local rungs) are **superseded** for the rate lane and pending a full rewrite once the framing settles.
>
> **Running the rate lane:** the eval needs an OpenAI-compatible hosted endpoint — set `WEAVER_EVAL_BASE_URL`, `WEAVER_EVAL_MODEL`, and `WEAVER_EVAL_API_KEY` (e.g. an OpenRouter key); `WEAVER_EVAL_TEMPERATURE` (default 0.7) and `WEAVER_EVAL_TRIALS` (default 3) tune the rate. Run `pnpm eval trigger-agentic`.
>
> **Two lanes, two roles** (evidence: [`specs/archive/20260710-skill-shape-trigger-spike.md`](specs/archive/20260710-skill-shape-trigger-spike.md)):
>
> - **Primary / release gate — Haiku** (`WEAVER_EVAL_MODEL=anthropic/claude-haiku-4.5`, no provider pin needed — OpenRouter serves Anthropic models on the same endpoint). The audience-representative lane: weaver's skill format is Claude Code's, so a Claude-family model is the realistic consumer. Must be green before shipping skill text (~1 min, pennies). It sits near the ceiling, so it gates but rarely shows a gradient.
> - **Stress instrument — hosted OSS 70B** (`WEAVER_EVAL_MODEL=meta-llama/llama-3.3-70b-instruct`, `WEAVER_EVAL_PROVIDER=AkashML`). Reach for it only when Haiku shows no gradient and you need one to iterate against; never gate on it, and never chase reds it is structurally unable to pass — on sub-frontier models a declared competing tool that *is* the task shape (`Grep` for "find the TODOs") beats any second-class skill description, whatever the wording.
>
> **OSS-model pins:** pin a provider that actually emits tool calls (`AkashML`, observed 8/8 for the 70B). Do **NOT** pin `DeepInfra` — its backend returns empty completions (`content: null`, no `tool_calls`) ~62% of the time when tools are present. A pin that returns empty completions is worse than no pin; `global-setup.llm.ts` probes for this before the run and `callModel` throws a named provider fault if it appears mid-run.
>
> **Reading a rate:** n=3 is coarse — re-run a surprising flip at `WEAVER_EVAL_TRIALS=6` before acting on it. Classify the trail mechanism, not just the rate: *never-touch* → the frontmatter description lost the trigger (quote the losing task phrasing in it); *loaded-but-didn't-convert* → the body lacks an "Instead of: `<shell command>`" contrast block for the habit it displaces; *prose-stall* (`abandonedText` in the trail output shows the giving-up turn) → body length or framing; *oracle-loop* (repeated calls to the skill itself with query args) → the skill name sounds like an endpoint. Before attributing a red to a text edit, A/B against the unedited text (`git stash`). YAML trap: a `description:` value starting with `"` is truncated by real hosts' frontmatter parsers — the harness's regex parser masks this; start descriptions with a plain word.
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

- **Trigger cases:** run exclusively on the agentic trigger lane (see below) — a generic
  `Skill` tool loads a skill's real SKILL.md body, and a case passes when the model reaches
  a `weaver <expected-command>` bash call within the step budget. **Boundary cases**
  (`boundary-*`, `expect.skill: "bash"`) invert this: legitimate shell work (list files, run
  tests, tail a log) that must *not* pull a skill in; they pass when every trial neither loads
  a skill nor reaches any `weaver` invocation. Each matched trial also prints a non-gating
  args verdict (`matchWeaverCommand.outcome`) so a right-selection/wrong-args trial is
  visible in the trail without affecting the selection rate.
- **Command cases:** the full SKILL.md bodies plus the task go in the user turn, a `bash`
  tool is declared, and the prompt asks for a single call. Pass = the model's **bash tool
  call** parses as `weaver <expected-subcommand> '<json>'` with the case's key arguments;
  a response with no bash tool call fails as "did not call the bash tool". The prompt does
  not name weaver — the model must still select it from the skill content. `&&`-chained
  commands are split into candidates: a safety check before a destructive command is correct
  behaviour. `matchWeaverCommand` classifies the result as `correct` / `wrong-tool` /
  `wrong-args`, separating the right op reached with bad args from the wrong op entirely.
- **Two-step cases:** the conversation is pre-seeded as a real tool exchange — user task,
  assistant `bash` tool call running the step-1 weaver command, `tool`-role result carrying
  a canned fixture from `eval/fixtures/`; the assertion checks the follow-up `bash` tool
  call. The seeded search→rename case proves a **result-derived** carry-through: the task
  withholds the line number, so the `line`/`col` the follow-up `rename` carries exist only
  in the seeded `search-text` result (`searchText-userId.json`: line 12, col 9).

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

The agentic trigger lane below is not a new rung — it applies host-like *pressure* to
the local rungs (2–3), holding the skill text constant so the pressure is the only variable.

## The agentic trigger lane

`eval/cases/trigger-agentic.llm.test.ts` runs the skill-trigger cases plus the `boundary-*`
cases under host-like pressure — a competing toolset (`Skill`, `bash`, `Grep`, `Glob`, `Read`),
a cluttered system prompt (`buildClutterSystemPrompt()`), and a grep-primed seed
(`buildHabitMomentumSeed()` prepends a successful grep before the task) — and measures the
*eventual* operation instead of the first tool call. `runAgenticLoop`
(`eval/harness/agentic-loop.ts`) drives the model forward up to a step budget (6 — room for
the skill-load hop, a precursor, and the operation), feeding a canned result back after each
turn. A skill load (`Skill` tool call or SKILL.md Read) feeds back the real SKILL.md body and
is tracked as `skillMdRead`/`readTurn` without entering the trail. Per-trial trails print with
raw bash command strings — a name-only trail cannot distinguish "never ran weaver" from a
matcher false-negative.

Why the eventual-operation metric exists: a single-shot first-call metric cannot tell a
*substitution* (grep instead of search-text) from a reasonable *precursor* (find-references
before a rename). It scores `rename-at-position → find-references-first` as a loss even though
the model would rename next. The agentic lane credits the precursor and checks where the model
actually lands.

**Skill-trigger cases** (`expect.skill` names a skill) pass when a bash
`weaver <expected-command>` invocation is reached within the budget. `matchedAtStep` — the
1-based step of that invocation, absent if the trial never matched — is recorded per trial and
printed in the trail summary, so a first-call win (`matched@1`) is distinguishable from a
precursor-then-win (`matched@3`).

The verdict per call is three-way (`isMutatingCompetitor` in `eval/harness/grade.ts`, wired as
the loop's `hardFails`): the expected op is a **pass**; a *different mutating* weaver op — a
wrong destructive action the model cannot walk back — is a **hard fail** that stops the trial
(`failedAtStep`, printed as `competitor@<step>`); a read-only weaver op or a non-weaver call is
a **precursor** that is credited toward a later match. So a trajectory that runs the wrong
destructive op and then the right one fails rather than passing on the later call, and a
read-only op is allowed as an intermediate step but never as the terminal action for a
mutating-target case. Subcommands are classified mutating vs read-only by `SUBCOMMAND_MUTABILITY`,
completeness-guarded against `OPERATION_NAMES`. `&&`-chains are split before inspection, so a
`cd <dir> && weaver <sub>` chain is judged on its weaver segment.

**Boundary cases** (`expect.skill: "bash"` — legitimate shell work) invert the pass condition:
they guard against an aggressive description over-triggering and stealing a task no skill
should claim. A trial is clean when it neither loads a skill nor reaches a `weaver` invocation
for *any* subcommand within the budget (`boundaryTrialClean` in `eval/harness/agentic-loop.ts`);
the case passes only when every trial is clean. This is at least as strong as a first-call-only
guard — it catches an over-trigger anywhere in the trajectory, not only the first call.

**Standard tool exchange.** Completed turns are replayed as a standard tool-use conversation:
the model's own assistant message (its text and real `tool_calls`) followed by a `tool`-role
result for every call. The model is stateless, so this faithful history is what lets it advance
across hops — a lossy placeholder echo strands any multi-hop trajectory (search for a position,
then act) on its first call, re-planning the same step forever. `buildHabitMomentumSeed` uses the
same format. (The earlier plain-text echo existed only because Ollama drops seeded
`tool_call`/`tool` messages; Ollama is no longer a target lane.)

**Scenario-owned results, inert unowned hops.** The result fed back for a call is resolved by
`cannedToolResult` (`eval/harness/agentic-loop.ts`): a case owns the result for a specific weaver
subcommand or tool via `CaseEntry.cannedResults`. A `weaver <sub>` bash call the case does *not*
own resolves to a single inert stub (`NEUTRAL_WEAVER_RESULT`, "No results for this call.") — never
another operation's fixture content, and never the generic `bash` file list (reserved for
non-weaver shell commands). `cannedResults` is therefore the *only* source of scenario content: a
multi-hop case must own a coherent result for every on-path hop it might take (e.g. a replace case
that searches before replacing owns `search-text`), or the neutral stub reads as "nothing to do"
and strands the model. The inert default is deliberate — an *unanticipated* hop (a stray
`find-references` in a rename scenario) gets nothing to act on rather than another scenario's data
that would derail it. The tool-set-drift guard remains: an unknown *tool name* still throws.

Run: `pnpm eval trigger-agentic` (hosted env vars per the status note). Filter to a case subset
with `-t <case-name-regex>` for cheap iteration; `WEAVER_EVAL_TRIALS=1` for spot checks;
`WEAVER_EVAL_DEBUG=1` dumps the full turn-by-turn exchange (initial prompt, each model turn, each
fed-back result) for diagnosing non-convergence. Test titles carry full case names
(`chaiConfig.truncateThreshold: 0` in `vitest.llm.config.ts` — the default 40-char truncation
made long case names collide and silently broke `-t` filtering).

## Adding a new operation

The coverage invariant (`eval/cases/coverage.test.ts`, runs in `pnpm check`) fails until:

1. A command-stage case for the operation exists in `eval/cases/cases.ts` (kebab-case
   subcommand, a task whose text determines the key arguments).
2. `eval/fixtures/<operationName>.json` exists (camelCase, matching `OPERATION_NAMES`) —
   model it on an existing fixture; it must look like real CLI stdout.

Trigger cases are not per-operation — add one only when a new *skill* (or a materially
new task category) ships.

## Iteration path

1. **Agentic trigger lane** (see above) — the current and only trigger-stage lane:
   eventual-operation metric under host-like pressure, crediting sensible precursors a
   single-shot first-call metric would score as losses; owns the boundary over-trigger guard
   and the first-call (`matchedAtStep`) signal.
2. **Later candidates, queued in `docs/handoff.md`:**
   - repeat-N fragility rates (temperature > 0) on the hosted calibration model, to catch
     the sub-flip erosion the pass/fail lanes miss
   - Agent SDK end-to-end runs (real bash, live daemon, file-state assertions) — highest
     fidelity, but subsystem-sized and requires Anthropic API access
