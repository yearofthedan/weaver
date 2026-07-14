# CLI Eval Design

**Status:** Current
**Date:** 2026-07-13 (supersedes the local-Ollama design of 2026-06-10 and the MCP-based design of 2026-03-01)

---

## Goal

Verify that the shipped skill files cause an AI agent to (a) reach for weaver at all and
(b) invoke the correct `weaver` command with the right arguments — instead of defaulting to
grep, sed, or manual edits.

Agents interact with weaver exclusively through bash (`weaver <command> '<json>'`), discovered
via the skill files in `.claude/skills/`. Those files are the product surface under test, at
two decision points:

1. **Trigger stage** — in a real agent host, only the skill's one-line frontmatter
   *description* is in context when the agent decides whether to load the skill. If the
   description doesn't win against the agent's shell habits, the rest of the skill file may as
   well not exist.
2. **Command stage** — once the skill is loaded, the full SKILL.md must instruct the model well
   enough to emit a correct `weaver` invocation with the right arguments — including arguments it
   must carry from a prior tool result.

## Non-goals

- **Engine correctness regression** — unit tests cover this.
- **Real command execution** — emitted commands are asserted on, never run; no daemon involved.
  The fixtures stand in for real CLI output (see Working discipline).
- **CI gating** — the eval runs on the maintainer's machine on demand (`pnpm eval`), against a
  hosted model (API key + pennies per run).
- **Absolute scores** — see "Interpreting results".

## The model: one Haiku lane

The eval runs against **`anthropic/claude-haiku-4.5`** over an OpenAI-compatible hosted endpoint
(OpenRouter). Haiku is the audience-representative model: weaver's skills are `.claude/skills` in
Claude Code's format, so a Claude-family model is the realistic consumer. It is the sole lane and
the release gate — skill-text changes should be green here before shipping.

Set three env vars (`global-setup.llm.ts` fails fast if any is missing):

```
WEAVER_EVAL_BASE_URL=https://openrouter.ai/api/v1
WEAVER_EVAL_MODEL=anthropic/claude-haiku-4.5
WEAVER_EVAL_API_KEY=<OpenRouter key>
```

`WEAVER_EVAL_TEMPERATURE` (default 0.7) and `WEAVER_EVAL_TRIALS` (default 3) tune the agentic rate
lane. Run:

```bash
pnpm eval                        # all lanes
pnpm eval trigger-agentic        # the agentic trigger/rate lane only
pnpm eval -t <case-regex>        # filter cases
WEAVER_EVAL_TRIALS=6 pnpm eval trigger-agentic   # re-check a surprising rate
```

`callModel` accepts an explicit config parameter, so an alternate transport (e.g. the Anthropic
API directly) plugs in without touching cases or assertions.

## Architecture

Plain vitest + `fetch` against the hosted endpoint. No eval framework.

```
eval/cases/cases.ts           ← typed case table (trigger + command stages; two-step seed)
eval/cases/*.llm.test.ts      ← LLM cases; run ONLY via `pnpm eval` (vitest.llm.config.ts)
eval/cases/coverage.test.ts   ← invariant: every operation has a case (runs in pnpm check)
eval/harness/call-model.ts    ← one fetch per turn; per-lane temperature; 60s abort, one timeout retry
eval/harness/context.ts       ← system prompts built from .claude/skills/ at run time
eval/harness/assertions.ts    ← extractBashCommands + matchWeaverCommand (→ matched + outcome); pure, unit-tested
eval/harness/seed.ts          ← pre-seeded tool-exchange conversations (two-step, habit-momentum)
eval/harness/agentic-loop.ts  ← runAgenticLoop + cannedToolResult
eval/harness/grade.ts         ← SUBCOMMAND_MUTABILITY + isMutatingCompetitor (the loop's hard-fail verdict)
eval/fixtures/                ← canned tool stdout, embedded as tool results
eval/global-setup.llm.ts      ← fails fast unless the three hosted-endpoint env vars are set
```

Skill content is read from `.claude/skills/` at run time — the eval can never drift from what
ships. Lane separation is a hard constraint: `pnpm check` runs the harness unit tests and the
coverage invariant but never needs a model server; the live lanes run only under `pnpm eval`.

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
  assistant `bash` tool call running the step-1 command, `tool`-role result carrying a canned
  fixture from `eval/fixtures/`; the assertion checks the follow-up `bash` tool call. Seeding
  the precursor is how a command-stage case handles a task the model won't do in one shot,
  while keeping the single asserted follow-up call that makes the command lane deterministic.
  Two shapes:
  - **Result-derived carry-through** (search→rename): the task withholds the line number, so
    the `line`/`col` the follow-up `rename` carries exist only in the seeded `search-text`
    result (`searchText-userId.json`: line 12, col 9).
  - **Read-then-act** (cat→extract): the model reads the file before extracting, so the seed
    carries that `cat` and the asserted follow-up is the `extract-function` itself, not the
    look. The precursor here is a plain shell read, so its fixture is the file's source in a
    real `.ts` file (`sources/auth.ts`) — `loadFixture` reads a fixture by filename, so a
    non-weaver result need not be JSON.

## Interpreting results

Haiku is a realistic consumer of the shipped skills, so the lane is **audience-representative** —
but read it as *relative movement*, not absolute truth:

- **Relative signal is the point** — a description edit that drops the trigger rate or flips a
  command case is a regression worth investigating.
- **Not absolute truth** — the simulated system prompt is far less crowded than a real host's, so
  rates read optimistic; and Haiku is the *cheapest* Claude-family model, so the frontier models
  most users run (Opus, Sonnet) are an easier audience. A green Haiku lane is a floor, not a
  ceiling.
- **Movement is the workflow** — edit a skill file → `pnpm eval` → read what flipped. Skill files
  are read from disk at run time, so there is no build step between editing and re-running.

## The agentic trigger/rate lane

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
precursor-then-win (`matched@3`). Each matched trial additionally prints a **non-gating** args
verdict (`args:correct` / `args:wrong-args` from `matchWeaverCommand.outcome`): a
right-selection/wrong-args trial is surfaced in the trail but still counts as a selection match,
so args noise never smears into the selection rate.

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
then act) on its first call, re-planning the same step forever. `buildHabitMomentumSeed` and the
two-step seed use the same format.

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

**Reading a rate.** n=3 is coarse — re-run a surprising flip at `WEAVER_EVAL_TRIALS=6` before
acting on it. Classify the trail mechanism, not just the rate: *never-touch* → the frontmatter
description lost the trigger (quote the losing task phrasing in it); *loaded-but-didn't-convert* →
the body lacks an "Instead of: `<shell command>`" contrast block for the habit it displaces;
*prose-stall* (`abandonedText` in the trail output shows the giving-up turn) → body length or
framing; *oracle-loop* (repeated calls to the skill itself with query args) → the skill name
sounds like an endpoint. Before attributing a red to a text edit, A/B against the unedited text
(`git stash`). **YAML trap:** a `description:` value starting with `"` is truncated by real hosts'
frontmatter parsers — the harness's regex parser masks this; start descriptions with a plain word.

Two host-behaviour gotchas the lane deliberately reproduces: (1) the model sometimes *hallucinates
direct skill-name tool calls* (`weaver-refactor({...})`, invented arg schemas); the harness answers
with a host-style unknown-tool error and the model recovers to the proper `Skill` form — do **not**
declare per-skill tools to "fix" this, that removes the recovery a real host exercises. (2) Hosted
models occasionally emit tool calls with **malformed JSON arguments**; `callModel` marks such calls
(`invalidArguments`) and the loop feeds back an invalid-arguments error instead of crashing the
trial.

Run: `pnpm eval trigger-agentic`. Filter to a case subset with `-t <case-name-regex>`;
`WEAVER_EVAL_TRIALS=1` for spot checks; `WEAVER_EVAL_DEBUG=1` dumps the full turn-by-turn exchange
(initial prompt, each model turn, each fed-back result) for diagnosing non-convergence. Test titles
carry full case names (`chaiConfig.truncateThreshold: 0` in `vitest.llm.config.ts` — the default
40-char truncation made long case names collide and silently broke `-t` filtering).

## The command and two-step lanes (deterministic)

Both run at temperature 0, single-shot per case, so a regression reproduces every run and a one-off
is noise. The single call is deliberate — it isolates argument fidelity from selection. A task the
model won't do in one shot (it reads a file first) becomes a two-step case with the precursor
seeded, not a case with a wider step budget: given room to act, the model finishes shell-doable
tasks in shell (`mv`, `grep`, `npx tsc`) and never reaches weaver. When a command case fails, the
message classifies via `matchWeaverCommand`:

- `wrong-tool` — never reached the expected subcommand (no weaver at all, or a different op).
- `wrong-args` — the right op was reached but a key arg is malformed, missing, or the wrong value.

**Frontmatter feeds the command prompt too.** `skillContext()` returns the **whole** SKILL.md
including frontmatter, so a description edit aimed at the *trigger* stage also lands in every
*command*-stage prompt — a trigger-routing fix can silently regress command args (e.g. rewording a
description toward "TODO comments" can make the model emit `pattern: "// TODO"`, reading "comments"
as the literal marker). After any description edit, run **both** lanes, not just the one you were
aiming at.

## Working discipline

The eval is a **black-box** behavioural test of a stochastic system — but a *narrowly* stochastic
one: it exercises skill/tool **selection** and structured tool-call **arguments**, not free-form
prose, so outputs are low-entropy on a clear task. That shapes how to work on it:

- **Run → observe → debug. Never predict-then-carve.** Write the assertion for the real flow, run
  it, watch what the model actually emits, debug from the result. Do not reason to what the model
  "should" emit and shape the assertion to match — reading engine source to *fix an expected model
  output* is the anti-pattern tell. (This is distinct from verifying the *world* the model acts in,
  below, which does require reading source.)
- **A dropped or loosened assertion costs an observation, not a thought bubble.** "This might be
  fragile" is a hypothesis you test by running, not a licence to delete. You cannot keep slicing
  assertions out until it's green — and because selection/args are low-entropy here, an exact-value
  assertion (e.g. a carried `line`/`col`) is legitimate and a red is far more likely real signal
  than sampling noise.
- **Fixtures are the scenario.** The eval never runs real commands, so a fixture that diverges from
  real CLI stdout tests a fiction — silently. Verify a fixture against real output, and make sure
  any downstream argument the eval asserts a model *carried* is exactly what the real upstream op
  *emits*. Worked example: the two-step search→rename carry-through asserts `line: 12, col: 9`.
  That is correct only because `search-text` emits 1-based `col = m.index + 1` (col 9 for `userId`
  in `  const userId =`) and `rename` consumes 1-based col via
  `getPositionOfLineAndCharacter(line - 1, col - 1)` — the two ops agree, so col 9 targets the same
  character. Had they disagreed, the red would have been the *product*: a real search→rename
  carry-through bug, not fragility to design around.
- **Selection is a rate; correctness is deterministic.** The agentic lane runs at temperature > 0
  over N trials and reports a *rate* — selection under pressure is genuinely variable. The command
  and two-step lanes run at temperature 0, single-shot — argument correctness on a clear task is
  not, and a rate there would only add flakiness. Keep the boundary: a new check belongs in the
  lane whose determinism matches what it measures.

### Known limitation: Haiku is a proxy on the sampling axis

Haiku 4.5 still accepts `temperature`, so the lane's 0 / 0.7 knobs are meaningful *for Haiku*. But
the real audience — Claude Code on Opus/Sonnet — has no `temperature` parameter at all (it is
removed on those models; sampling is governed by effort + adaptive thinking). So the eval's
temperature settings are proxy-instrument properties, not audience-fidelity dials, and there is no
host temperature to align them to. Consequence: `callModel` always sends a `temperature` field, so
pointing the eval at a frontier Claude (Opus/Sonnet) would 400 — the harness is coupled to
temperature-accepting models (Haiku).

## Adding a new operation

The coverage invariant (`eval/cases/coverage.test.ts`, runs in `pnpm check`) fails until:

1. A command-stage case for the operation exists in `eval/cases/cases.ts` (kebab-case
   subcommand, a task whose text determines the key arguments).
2. `eval/fixtures/<operationName>.json` exists (camelCase, matching `OPERATION_NAMES`) —
   model it on an existing fixture; it must look like real CLI stdout (see Working discipline —
   fixtures are the scenario).

Trigger cases are not per-operation — add one only when a new *skill* (or a materially new task
category) ships.

## Iteration path

1. **Agentic trigger/rate lane** (above) — the current trigger-stage lane: eventual-operation
   metric under host-like pressure, crediting sensible precursors a single-shot first-call metric
   would score as losses; owns the boundary over-trigger guard, the first-call (`matchedAtStep`)
   signal, and the non-gating args verdict.
2. **Later candidates, queued in `docs/handoff.md`:** Agent SDK end-to-end runs (real bash, live
   daemon, file-state assertions) — highest fidelity, but subsystem-sized and requires Anthropic
   API access.
