# CLI Eval Design

**Status:** Current
**Date:** 2026-06-10 (supersedes the MCP-based design of 2026-03-01)

---

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
  decision surface — alongside a `bash` tool. Pass = the model's first tool call selects
  the expected skill. Prose-only answers, bash-first responses, and wrong-skill
  selections fail.
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

## Adding a new operation

The coverage invariant (`eval/cases/coverage.test.ts`, runs in `pnpm check`) fails until:

1. A command-stage case for the operation exists in `eval/cases/cases.ts` (kebab-case
   subcommand, a task whose text determines the key arguments).
2. `eval/fixtures/<operationName>.json` exists (camelCase, matching `OPERATION_NAMES`) —
   model it on an existing fixture; it must look like real CLI stdout.

Trigger cases are not per-operation — add one only when a new *skill* (or a materially
new task category) ships.

## Iteration path

1. **v1 (this design):** local model, single-shot, temperature 0, pass/fail per case
2. **v2 candidates, in rough order of value:**
   - statistical trigger rates (temperature > 0, repeat-N per case — free locally)
   - an Anthropic/Haiku transport as a canonical gate before skill releases
   - Agent SDK end-to-end runs (real bash, live daemon, file-state assertions) — highest
     fidelity, but a subsystem-sized build; revisit once descriptions have stabilised
