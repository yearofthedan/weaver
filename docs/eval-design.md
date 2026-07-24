# CLI Eval Design

**Purpose:** What the CLI eval measures and why it's shaped this way — one Haiku lane, fixture-backed. To run it, see [`eval/README.md`](../eval/README.md).
**Audience:** Anyone who edits the skills the eval guards, changes the harness, or interprets a run.
**Status:** Current

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
  hosted model. Runs cost real money, not pennies: a 4-case spike at n=6 is ~US$0.75 (clutter
  prompt + skill bodies × trials × steps add up). Budget paid runs deliberately — scope the case
  set and trial count to the question, and never waste a run (see Working discipline).
- **Absolute scores** — see "Interpreting results".

## The model: one Haiku lane

The eval runs against **`anthropic/claude-haiku-4.5`** over an OpenAI-compatible hosted endpoint
(OpenRouter). Haiku is the audience-representative model: weaver's skills are `.claude/skills` in
Claude Code's format, so a Claude-family model is the realistic consumer. It is the sole lane and
the release gate — skill-text changes should be green here before shipping.

The lane needs a hosted OpenAI-compatible endpoint (base URL, model, API key); `global-setup.llm.ts`
fails fast if any is unset. To run it, see [`eval/README.md`](../eval/README.md).

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
eval/harness/seed.ts          ← pre-seeded tool-exchange conversations (two-step, true-shell momentum)
eval/harness/case-lane.ts     ← seedForCase + caseIsGating (per-case seed depth and gating; pure, unit-tested)
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
a cluttered system prompt (`buildClutterSystemPrompt()`), and a true-shell multi-turn momentum
seed (`buildHabitMomentumSeed(task, turns)` prepends `turns` distinct true-shell pre-steps —
log grep, `git log --grep`, `find` by name — before the task; each pre-step is work weaver does
not own, so seeding it primes a general shell habit rather than a substitution precedent).
Depth is a first-class lever, per-case via `CaseEntry.momentumTurns` (`seedForCase` in
`eval/harness/case-lane.ts` reads it, defaulting to `1`); requesting more turns than the pool
holds throws rather than cycling or silently under-seeding. `runAgenticLoop`
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

**Observational pressured cases** (`CaseEntry.observational: true`, read via `caseIsGating` in
`eval/harness/case-lane.ts`) report the same rate + trail as any skill-trigger case but carry no
`belowAlarm` assertion — the lane never fails on them. Gating stays on the existing ceiling
trigger cases (the catastrophic floor) and the boundary cases (the over-trigger guard). Seed
depth co-varies with the rung: the light rungs (existing direct/indirect trigger cases) keep
`momentumTurns` at its default of `1` as ceiling canaries — depth-1 pressure should not move
them; the pressured buried rung sets `momentumTurns: 3` as the discriminator, pairing a deeper
seed with phrasing that embeds the op inside a broader task. This is deliberately observational,
not gated, per "Don't tier what n=3 can't resolve" below — at n=3 a 2/3 gate on a case that the
spike put at ~1/6 would fail every run and force a paid tuning loop; reading the rate on demand
gets the regression signal (a visible drop) without a standing false alarm.

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

Boundary cases are epistemically weak — "never triggers weaver" has unbounded scope — and each
costs paid trials, so the pressure is to keep them minimal, not to add them. One earns a place
only when a plausible description error would flip it: the task must sit on a skill description's
decision boundary. A task no description could plausibly claim — list files, run tests, tail a
log — can only fail by hallucinating a nonexistent op, not by over-trigger, so it costs trials
without buying signal. And it must be shell work *by intent*: a task that should route to weaver,
asserted as a negative, tests against intent, not behaviour.

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
that would derail it. A tool the lane never declared splits two ways (`cannedResultForCall` →
`classifySkillReach`): if its name, normalised (lowercased, `_`→`-`), *matches a shipped skill*
(`weaver_code_inspection`, `weaver-refactor`), it is a skill reached as a tool — the harness feeds
back that skill's real SKILL.md body, exactly as for a `Skill`/`Read` load, so the trial reaches
content regardless of how the model phrased the call. A name that matches *no* skill (`frobnicate`)
is a genuine hallucination and still gets the host-style unknown-tool error, graded as the miss it
is. The tool-set-drift guard is unchanged: only a *declared* tool with no canned result throws —
that is the real drift, the map falling behind the tool set.

**Reading a rate.** n=3 is coarse — re-run a surprising flip at `WEAVER_EVAL_TRIALS=6` before
acting on it. Classify the trail mechanism, not just the rate: *never-touch* → the frontmatter
description lost the trigger (quote the losing task phrasing in it); *loaded-but-didn't-convert* →
the body lacks an "Instead of: `<shell command>`" contrast block for the habit it displaces;
*prose-stall* (`abandonedText` in the trail output shows the giving-up turn) → body length or
framing; *oracle-loop* (repeated calls to the skill itself with query args) → the skill name
sounds like an endpoint. Before attributing a red to a text edit, A/B against the unedited text
(`git stash`). **YAML trap:** a `description:` value starting with `"` is truncated by real hosts'
frontmatter parsers — the harness's regex parser masks this; start descriptions with a plain word.

**Content vs. exposure.** Alongside the gating selection rate, each skill-trigger case prints a
four-tier outcome composition (`classifyTrialOutcome` / `computeOutcomes` in
`eval/harness/outcome.ts`), so a cross-model run separates the skill signal weaver owns from host
noise it does not:

- **`clean-pass`** — matched with no tool-style reach: description and body both did their job.
- **`warned-pass`** — matched, but the model reached the skill *as a tool* at some point (see the
  gotcha above): the body still guided it; the host's skill exposure is what was noisy.
- **`content-fail`** — the body was in front of the model (loaded via `Skill`/`Read` *or* a
  tool-style call) but did not guide it to the op. **This is the miss weaver owns** — a body to fix.
- **`never-reached`** — the model never read the skill at all: a frontmatter-description or
  shell-habit problem, not a body problem.

The gate is unchanged — `computeRate` still fires on the *selection* rate, and
`clean-pass + warned-pass = matched`, so a warned pass still counts toward the gate. The composition
is reporting-only: it lets a red on a non-Claude model be attributed (`content-fail` = fix the body;
`never-reached` = fix the description; `warned-pass` = host-exposure noise to discount for a
real-host read, count for a pure-content read). Read the tiers as counts and trail evidence, not as
gated conditional rates — `warned-pass`/`content-fail` denominators are too small to gate at n=3.
Do **not** tune the harness's exposure per model family to move these — past a point that measures
the scaffolding, not the skills.

**Don't tier what n=3 can't resolve.** At n=3 a case has four possible rates — 0, 1/3, 2/3, 3/3 —
and the alarm fires below 2/3, so the only passing non-ceiling value is exactly 2/3: one flip from
failing, one from the ceiling. A "discriminating band" between floor and ceiling is a single
knife-edge point at n=3, indistinguishable from noise. Do not design rung classes, bands, or gating
tiers for a case before a spike has shown the lane discriminates at all; and do not chase a stable
band by raising the default n — a band that only exists at n=6 doubles the trial count — and the paid cost — of every
run, buying resolution the regression signal (a visible multi-step flip, 3/3 → 1/3 or 0/3) does not need. Escalate trials only
to confirm a surprising flip, never as the standing configuration.

Two host-behaviour gotchas the lane handles: (1) the model sometimes *reaches a skill as a direct
tool call* (`weaver-refactor({...})`, or the underscore-normalised `weaver_code_inspection` some
providers emit, with invented arg schemas). *How a host exposes a skill is host integration, not
skill content weaver owns* — so the lane does not let that phrasing decide the trial. It feeds back
the skill's real body (treating the call as a load) and flags the trial as reached-via-tool, so the
body is measured regardless. The tool set is **not** widened to declare per-skill tools; the harness
recognises the skill-name call and feeds the body. A trial that then converges is a `warned-pass`
(content worked, exposure was noisy); one that does not is a `content-fail` like any other loaded
miss — see *Content vs. exposure* below. (2) Hosted models occasionally emit tool calls with
**malformed JSON arguments**; `callModel` marks such calls (`invalidArguments`) and the loop feeds
back an invalid-arguments error instead of crashing the trial.

Run: `pnpm eval trigger-agentic --disable-console-intercept` — the flag is required or vitest
swallows the per-case rate/trail `console.log` lines on passing tests, so the observational rungs
print nothing. Filter to a case subset with `-t <case-name-regex>`;
`WEAVER_EVAL_TRIALS=1` for spot checks; `WEAVER_EVAL_DEBUG=1` dumps the full turn-by-turn exchange
(initial prompt, each model turn, each fed-back result) for diagnosing non-convergence. Test titles
carry full case names (`chaiConfig.truncateThreshold: 0` in `vitest.llm.config.ts` — the default
40-char truncation made long case names collide and silently broke `-t` filtering).

**A lane failure is not automatically a regression — read its cause.** Each case has a 540s
per-test budget (`LANE_TIMEOUT_MS` = trials × steps × per-call budget). When a run stalls — a slow
provider, or the host sleeping mid-run — a deep (`momentumTurns:3`) case can exceed it and fail the
*whole lane* on exit code even though its completed trials are clean; the exit status conflates "a
skill regressed" with "the run stalled." Before treating a red run as a regression, check whether
the failure is `Test timed out in …` (an environmental stall — re-run) or an actual rate/assertion
failure (signal). This is logged as a follow-up in `docs/handoff.md` (make the observational lane
timeout-resilient).

**`eval/cases/*.llm.test.ts` is not covered by `pnpm check`** — it is excluded from the `test:eval`
vitest lane, and stryker only mutates `eval/harness/**`. A type error or logic bug in the lane
wiring surfaces only under a paid `pnpm eval` run. After editing a `*.llm.test.ts`, type-check it
with `pnpm exec tsc --noEmit -p .` (which *does* include it) before spending on a run.

## The command and two-step lanes (deterministic)

Both run at temperature 0, single-shot per case, so a regression reproduces every run and a one-off
is noise. The single call is deliberate — it isolates argument fidelity from selection. A task the
model won't do in one shot (it reads a file first) becomes a two-step case with the precursor
seeded, not a case with a wider step budget: given room to act, the model finishes shell-doable
tasks in shell (`mv`, `grep`, `npx tsc`) and never reaches weaver. When a command case fails, the
message classifies via `matchWeaverCommand`:

- `wrong-tool` — never reached the expected subcommand (no weaver at all, or a different op).
- `wrong-args` — the right op was reached but a key arg is malformed, missing, or the wrong value.

**Path key args are matched by trailing segment, not exact string.** A model legitimately `cd`s
into the workspace and passes a workspace-relative path — `cd /ws && weaver move-directory
'{"oldPath":"src/utils"}'` targets the same directory as the absolute `/ws/src/utils`. So path-typed
keys (`oldPath`, `newPath`, `file`, `sourceFile`, `destFile`) match when the emitted value equals the
expected absolute path *or* is a trailing path-segment suffix of it. A different directory
(`src/wrong`) still fails. Non-path keys (`newName`, `pattern`, `replacement`, …) stay exact —
`replacement` can contain `/`, so suffix-matching it would be wrong. Author the expected value in the
case table as the absolute path; the suffix tolerance is the harness's, not the case's.

**Frontmatter feeds the command prompt too.** `skillContext()` returns the **whole** SKILL.md
including frontmatter, so a description edit aimed at the *trigger* stage also lands in every
*command*-stage prompt — a trigger-routing fix can silently regress command args (e.g. rewording a
description toward "TODO comments" can make the model emit `pattern: "// TODO"`, reading "comments"
as the literal marker). After any description edit, run **both** lanes, not just the one you were
aiming at.

## The pressured emission lane

`pressured-emission.llm.test.ts` keeps the command lane's single call (temp 0, bash-only, skill
body in context) but wraps it in host pressure — the `buildClutterSystemPrompt()` system prompt plus
a 3-turn habit-momentum seed. The clean command lane isolates argument fidelity; this lane asks
whether that fidelity survives when the context is crowded and primed toward the shell, i.e. whether
the body resists the shell-fallback pull that constraining to one call otherwise hides (the `mv` /
`grep` / `npx tsc` reflex above).

It grades each case with `matchWeaverCommand` like the command lane, but partitions the cases: a
case not in the lane's local `KNOWN_RED` set **gates** (a shell fallback fails the run); a case in it
is **reported, not gated**, because the skill body does not yet hold that emission under pressure and
gating it would ship a red build. A body-hardening pass removes each entry once it holds, flipping it
to gating. The set is calibrated to the gate model — another model falls on different cases.

**The pressure must be legitimate.** The momentum seed carries only weaver-orthogonal shell work
(log grep, `git log`, filename `find`); it must never demonstrate a shell stand-in for a graded op
(`grep` of source → `search-text`, `mv` → `move-file`, `sed` → `replace-text`). A seed that models
the substitution manufactures the fallback instead of measuring the body's weakness — the same
momentum-seed principle the trigger lane relies on.

## Working discipline

The eval is a **black-box** behavioural test of a stochastic system — but a *narrowly* stochastic
one: it exercises skill/tool **selection** and structured tool-call **arguments**, not free-form
prose, so outputs are low-entropy on a clear task. That shapes how to work on it:

- **Every case must be a task a real user would plausibly ask.** Before adding, removing, or
  rewording a case, stop and ask: *is this a reasonable thing for someone to ask?* That is the test
  that separates a legitimate clarity fix from tuning the instrument to pass — a phrasing kept or
  cut for any reason other than realism is gaming, however much the rate moves.
- **Run → observe → debug. Never predict-then-carve.** Write the assertion for the real flow, run
  it, watch what the model actually emits, debug from the result. Do not reason to what the model
  "should" emit and shape the assertion to match — reading engine source to *fix an expected model
  output* is the anti-pattern tell. (This is distinct from verifying the *world* the model acts in,
  below, which does require reading source.)
- **A change to harness code is verified by a real eval run, not green harness unit tests.** The
  `test:eval` lane (and mutation on the harness) proves the *logic* in isolation; it cannot prove a
  grading change behaves correctly against a real model — that only shows in `pnpm eval`. A fix to
  how tool calls are graded, mocked, or looped must be driven on a real model before it is done. A
  cheap way to also *exercise* a fix in situ: re-run the model whose behaviour surfaced the bug (a
  hallucination or malformed-args path), since it is the one likely to reproduce it.
- **A dropped or loosened assertion costs an observation, not a thought bubble.** "This might be
  fragile" is a hypothesis you test by running, not a licence to delete. You cannot keep slicing
  assertions out until it's green — and because selection/args are low-entropy here, an exact-value
  assertion (e.g. a carried `line`/`col`) is legitimate and a red is far more likely real signal
  than sampling noise.
- **Fixtures are the scenario.** The eval never runs real commands, so a fixture that diverges from
  real CLI stdout tests a fiction — silently. Fidelity is to the *scenario*, not just the format: a
  result that contradicts the task's stated scope — too few hits for a "whole project" ask, missing
  the substrings the task names — reads as incomplete and drives the model to re-verify in shell,
  confounding the trail. Verify a fixture against real output, and make sure
  any downstream argument the eval asserts a model *carried* is exactly what the real upstream op
  *emits*. Worked example: the two-step search→rename carry-through asserts `line: 12, col: 9`.
  That is correct only because `search-text` emits 1-based `col = m.index + 1` (col 9 for `userId`
  in `  const userId =`) and `rename` consumes 1-based col via
  `getPositionOfLineAndCharacter(line - 1, col - 1)` — the two ops agree, so col 9 targets the same
  character. Had they disagreed, the red would have been the *product*: a real search→rename
  carry-through bug, not fragility to design around.
- **A momentum seed primes a habit, not a substitution precedent.** The habit-momentum seed
  (`buildHabitMomentumSeed`) exists to carry *legitimate shell fluency* into the target task. Every
  seeded pre-step must be work weaver does **not** own — grep a log, `git log --grep`, `find` by
  name. It must never be a task a skill claims (find-importers, find-references, replace-text). A
  weaver-shaped pre-step stops being habit and becomes an in-session precedent that weaver-work is
  done in the shell — an unrealistic pressure that contaminates the signal, so a red then reflects
  the seed teaching substitution rather than genuine habit. (This is specific to *momentum/pressure*
  seeds; the two-step carry-through seed deliberately seeds a real weaver op as its precursor — that
  is the point there, not a violation.)
- **A pressured case's live task carries no pre-step the harness cannot satisfy.** Scenario context
  a pressured task wants the model to gather first — skim a changelog, check the build state — belongs
  in the *momentum seed*, where the harness authors a satisfying result, not in the live task string.
  A leading context step in the live task is executed against the loop's canned stubs: a non-weaver
  bash call resolves to `CANNED_RESULTS.bash` (the generic file list), so a step that hunts an artifact
  the stub never contains (a changelog file) loops until the step budget is exhausted and the rung
  never reaches its op. The rung then measures "can the model find a nonexistent file," not conversion
  under pressure — a dead instrument, floored regardless of skill text. Keep the burial (framing +
  multi-part phrasing) in the live task; move any *inspect-first* step into the seed. **An own-file
  inspect step is the exception with no home — remove it.** A step that inspects the op's *own* file
  can't move to the seed (weaver-owned inspection is not a valid habit pre-step) and can't be made
  satisfiable either: the canned-result map is keyed by tool, not path, and even a *coherent* read of
  the target file lets the model answer from it and skip the mutating op — feeding a real source
  dropped a buried-rename case *below* its incoherent-stub rate. Drop the step; keep the burial in
  framing and a trailing post-op ask (`pressured-buried-rename`, [`eval-baselines.md`](eval-baselines.md) ‡).
- **An embedded secondary step gates the metric on that step, not the tool.** A pressured task
  that asks the model to *report/flag/inspect before acting* ("flag the risky matches before you
  apply") can read low even with sound skill text and a faithful fixture: the model reasonably does
  the sub-step first, then stops at it or over-verifies (re-grep, re-read) until the budget is gone,
  while a plain declarative ask for the same change converts freely. Diagnose by removing *only* the
  suspected step and re-measuring. Integrity guard: removing a confounding step is a fair clarity
  fix, but lifting a rate by rewording the ask until the model complies is tuning the instrument to
  pass — the tell is a rate that moves only under a multi-change rewrite, not a single isolated
  removal.
- **A paid run must never be wasted — capture output to a file, not `console.log`.** Vitest's
  reporter swallows `console.log` from *passing* tests, so an observational lane (a spike that
  asserts nothing gating) prints nothing and the run's data — which cost real money — is lost. Write
  results with `fs.appendFileSync` to a known path as the trials run, so the output survives the
  reporter regardless of pass/fail. Same reason to scope a spike tightly before running: at ~US$0.75
  a run, a second run to recover lost output is a real cost, not a free retry.
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
