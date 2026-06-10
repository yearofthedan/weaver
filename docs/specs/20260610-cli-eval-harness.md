# CLI eval harness

**type:** change
**date:** 2026-06-10
**tracks:** handoff.md #redesign-the-promptfoo-eval-harness-for-the-cli → docs/eval-design.md, docs/quality.md (eval section)

---

## Context

The eval harness broke when the MCP transport was removed: `eval/promptfooconfig.yaml` spawns `weaver serve` (gone) and asserts on MCP tool selection (`tool-call-f1`), backed by a fixture socket server impersonating the daemon. With CLI-only distribution, agents interact through bash (`weaver <command> '<json>'`), discovered via the shipped skill files. The eval must measure two things instead: **does the agent reach for the skill at all** (trigger quality — the frontmatter description is the only thing in context when that decision is made), and **does it emit the correct `weaver` command once the skill content is loaded** (instructional quality). `pnpm check` does not run this harness (needs `ANTHROPIC_API_KEY`), so the breakage was invisible to CI.

## User intent

*As a weaver maintainer, I want the eval to measure whether an agent — given the shipped skill files and bash — reaches for weaver and emits the correct command for a refactoring task, so that skill-file regressions (in trigger descriptions or command instructions) are caught before they reach users.*

## Relevant files

- `eval/promptfooconfig.yaml` — the 15 existing test cases; their tasks, two-step seeds, and competing-tool scenarios port to the new case table
- `eval/run-eval.ts` — current entry point; deleted (replaced by a vitest config + globalSetup API-key check)
- `eval/fixture-server.ts` + `eval/fixture-server.test.ts` — daemon impersonation; deleted (the new harness never executes commands, so no daemon is needed)
- `eval/fixtures/*.json` — pre-recorded responses, already in CLI stdout shape (`{"status": "success", ...}`); repurposed as canned bash `tool_result` content for two-step cases
- `eval/fixture-coverage.test.ts` — per-operation fixture invariant; re-pointed at the new case table
- `eval/vitest.config.ts` — runs `eval/**/*.test.ts` in the `test:eval` lane (part of `pnpm check`); the LLM cases must NOT land in this lane
- `.claude/skills/{search-and-replace,refactor,code-inspection}/SKILL.md` — the system-prompt content; read from disk at eval time so the eval cannot drift from what ships
- `src/daemon/dispatcher.ts` — `OPERATION_NAMES` (camelCase); CLI subcommands are the kebab-case forms (see `src/adapters/cli/operations.ts` SUBCOMMANDS)
- `src/adapters/cli/operations.ts` — confirms CLI output is single-line JSON on stdout (fixture shape matches)
- `docs/eval-design.md` — superseded design note; rewritten by this task
- `docs/quality.md` — eval section describes the promptfoo architecture; rewritten by this task

### Red flags

- `eval/agent-conventions.test.ts` + `scripts/agent-conventions.js` validate `.mcp.json` MCP server configs — likely dead since the MCP removal. Out of scope; tracked as a new handoff entry.
- Test hotspots: none — all eval test files are well under threshold; `fixture-server.test.ts` is deleted along with its source.
- Layer fit is marked per AC below. The harness helpers (command extraction, system-prompt assembly, case-table types) are pure functions → unit tests in the `test:eval` lane (no API key). The LLM cases themselves are inherently integration-with-a-remote-model and live in a separate lane behind `pnpm eval`.

## Value / Effort

- **Value:** `pnpm eval` works again, and it now measures the failure mode the maintainer actually fears: agents never loading the skills (this repo needed CLAUDE.md Rule 18 to force its own agent to use them — external agents have no such rule). Trigger-stage cases give a cheap (~cents, seconds) iteration loop for improving the frontmatter descriptions; command-stage cases catch regressions in the skill bodies. Without this, skill edits ship blind.
- **Effort:** confined to `eval/` plus `package.json` (remove `promptfoo`; no new runtime dependency — plain `fetch` to a local server) and two docs. No `src/` changes. New code is ~150 lines of harness helpers plus a typed case table; deletions outweigh additions (fixture server, run-eval, 300-line YAML, the promptfoo dependency tree).

## Behaviour

All LLM calls go to a **local model server** (Ollama, OpenAI-compatible API at `http://localhost:11434/v1`) at temperature 0, single-shot (no retries, no repeat sampling). Default model: `qwen3:14b` (strong local tool-caller at Haiku-ish capability); base URL and model overridable via `WEAVER_EVAL_BASE_URL` / `WEAVER_EVAL_MODEL`. The eval runs on the maintainer's machine, not in CI.

- [ ] **AC1 — Harness replacement.** `pnpm eval` runs the LLM cases via vitest, calling the local model server directly. If the server is unreachable or the model is not available, it fails fast before any case runs (globalSetup) with an actionable message (e.g. "start Ollama and run: ollama pull qwen3:14b"); no fixture server is started; `promptfoo`, `eval/fixture-server.ts`, `eval/fixture-server.test.ts`, `eval/run-eval.ts`, and `eval/promptfooconfig.yaml` are removed. `pnpm check` passes without a model server running — the LLM cases live in a separate vitest config, not the `test:eval` lane. *(Layer: harness helpers unit-tested in `test:eval`; the lane separation is verified by `pnpm check` itself.)*
- [ ] **AC2 — Trigger-stage cases.** Given a system prompt containing only the three skills' frontmatter descriptions (formatted as an available-skills list), a `skill` tool (`{name}`), and a `bash` tool, each trigger case asserts the model invokes the `skill` tool with the expected skill name. Responding with prose only, calling `bash` first, or selecting the wrong skill fails. At least one trigger case exists per shipped skill, including at least one task where a shell tool is the tempting default (e.g. multi-file rename → `sed`). *(Layer: prompt-assembly and tool-call-extraction helpers are pure → unit tests; cases run in the `pnpm eval` lane.)*
- [ ] **AC3 — Command-stage cases.** Given a system prompt containing the full SKILL.md content (read from `.claude/skills/` at run time, not copies) and a `bash` tool, each single-step case asserts the model's bash call parses as `weaver <expected-subcommand> '<json>'` AND the JSON contains the case's key arguments (e.g. rename → `newName: "accountId"` and the right file path). A wrong subcommand, a non-weaver command, unparseable JSON, or missing/wrong key args each fail. *(Layer: the command parser/matcher is pure → unit tests including the failure modes; cases run in `pnpm eval`.)*
- [ ] **AC4 — Two-step flows.** Step-2 cases pre-seed the messages array with the step-1 user task, an assistant turn containing a bash `tool_use` for the step-1 weaver command, and a `tool_result` whose content is the canned CLI stdout from the corresponding `eval/fixtures/<operation>.json`, then assert the follow-up weaver command per AC3 rules (e.g. `search-text` results in context → `rename`; `find-references` results → `move-symbol`). *(Layer: seed-building helper is pure → unit test that the seed embeds the named fixture verbatim; cases run in `pnpm eval`.)*
- [ ] **AC5 — Coverage invariant.** A test in the `test:eval` lane (runs in `pnpm check`, no API key) imports the case table and asserts every operation in `OPERATION_NAMES` appears as the expected subcommand (kebab-case mapping) of at least one command-stage case, and every `eval/fixtures/*.json` file corresponds to a registered operation. A new operation without an eval case, or an orphaned fixture, fails `pnpm check`. *(Layer: pure — replaces `fixture-coverage.test.ts`.)*

Type matrix: 12 operations × command stage (AC5 forces full coverage); 3 skills × trigger stage (AC2); two-step pairs cover the search→rename and references→move flows that exercised the old harness's multi-turn shape. Vue-specific task phrasings are out of scope for this changeset (see Edges).

## Interface

No `src/` surface changes. The interfaces here are the harness's internal contracts:

- **Case table entry** (`eval/cases/`): `{ name: string; stage: "trigger" | "command"; task: string; seed?: { operation: string }; expect: { skill?: SkillName; subcommand?: string; keyArgs?: Record<string, unknown> } }`.
  - `task`: natural-language prompt, 1–3 sentences, paths under a fictional `/tmp/weaver-eval` workspace (never executed — realistic bounds: <500 chars). Ported from the existing YAML tasks.
  - `seed.operation`: names the fixture file embedded as the step-1 `tool_result`; empty/absent means single-step. Adversarial case: naming a fixture that doesn't exist must throw at case-table load, not produce a silent empty seed.
  - `expect.keyArgs`: the decisive arguments only (1–3 keys), not the full payload — full-payload matching would make cases brittle to harmless arg variation. Empty `keyArgs` is valid (subcommand-only assertion) but each case must state at least one of `skill`/`subcommand`.
- **`callModel(messages, tools)`** (~60 lines): one `fetch` POST to the OpenAI-compatible `/chat/completions` endpoint with `tools`; returns the assistant message's tool calls and text in a narrow local type. Temperature 0; max_tokens generous enough for thinking-mode models that emit reasoning before the tool call (~4k). Adversarial: server/HTTP errors surface as test failures with the response body, not retries.
- **`extractBashCommands(blocks)` / `matchWeaverCommand(command, subcommand, keyArgs)`**: pure. `matchWeaverCommand` must tolerate both `weaver x '{...}'` and `pnpm exec weaver x '{...}'` forms and single/double-quote variants; it must reject commands where the JSON does not parse. Zero case: no bash calls → empty array → assertion fails with "no command emitted". Failure messages must distinguish "no weaver attempt" (description/selection failure) from "weaver attempted but JSON malformed" (a local-model formatting failure) — small local models produce the latter often enough that conflating them corrupts the signal.
- **System-prompt builders**: `triggerContext()` (descriptions-only list) and `skillContext(skillNames)` (full SKILL.md bodies), both reading `.claude/skills/` at call time. Zero case: missing skill file → throw, never silently omit.

## Open decisions

All resolved with the owner during spec drafting (2026-06-10):

- **Harness: vitest + direct model calls (chosen) vs keep promptfoo vs Claude Agent SDK.** Promptfoo's deciding advantage (native MCP provider) died with the MCP transport; what remained in use was a heavyweight pinned dependency, stringly assertions against its serialized output, and multi-turn cases as JSON escaped inside YAML. Owning ~100 lines of typed TS harness is the cheaper carry, and the repo's existing quality machinery (biome, vitest, mutation testing) applies to it. **Consequences:** we own flakiness policy (mitigated: temperature 0, single-shot, same as the old harness's effective behaviour); no HTML viewer or cross-model matrix (unused today; rebuilding them later would be the signal to reconsider a framework). The Agent SDK option (real bash, live daemon, file-state asserts) is higher-fidelity but a subsystem-sized build with permanent three-suspect diagnostics (description vs model vs harness); deferred as an explicit v2 in `docs/eval-design.md` — the `callModel` wrapper and case table carry forward.
- **Eval model: local-only v1 (chosen) vs Anthropic Haiku.** The owner runs Claude through a Pro subscription; the Anthropic API is a separate Console account and bill, and the eval's iteration loop (tweaking skill descriptions, re-running) benefits from being free and unlimited. v1 therefore targets a local model over Ollama's OpenAI-compatible API — no SDK dependency, no API key, nothing leaves the machine. **Consequences:** absolute trigger/selection rates measure Qwen-class behaviour, not the Claude-class agents that actually run the skills — treat results as relative/regression signal and as a stress test (a description that triggers a 14B local model is robust; one that fails it may still work on stronger models). A Haiku canonical gate stays possible later through the transport seam (`callModel` is the only provider-specific code) and is recorded in `docs/eval-design.md` as the iteration path, not built now. Plain `fetch` is used instead of an SDK (one endpoint, localhost, we control both ends) — revisit if the client surface grows.
- **Trigger measurement: simulate the description-only decision (chosen) vs only command-stage cases.** The owner's primary worry is that skills never get used. The trigger decision in Claude Code is made on frontmatter descriptions alone, so it is a single-shot decision the harness can eval directly. **Consequences:** absolute trigger rates read optimistic vs a real crowded system prompt — the eval gives relative/regression signal, recorded in `docs/eval-design.md`. Deterministic enforcement via PreToolUse hooks is a separate product feature, tracked as a new `[needs design]` handoff entry alongside `weaver install`.
- **Fixtures: keep and re-point (chosen) vs delete.** Fixture JSONs are already in CLI stdout shape and feed two-step seeds; the coverage invariant survives re-pointed at the case table so new operations cannot ship without eval coverage.
- **Assertion strictness: subcommand + key args (chosen) vs subcommand only.** Catches "right tool, garbage args" failures the old `tool-call-f1` missed; `keyArgs` kept to 1–3 decisive keys to avoid brittleness.

## Security

- **Workspace boundary:** N/A — the harness never executes the emitted commands and writes no workspace files; paths in prompts are fictional.
- **Sensitive file exposure:** the eval sends skill-file content and fixture JSON to a model server on localhost — committed, public repo content, and nothing leaves the machine. No API keys are involved.
- **Input injection:** N/A — no new user-controlled strings reach the filesystem or shell; fixture names resolve via a fixed directory join and a load-time existence check. `WEAVER_EVAL_BASE_URL` is operator-supplied config, used only as a fetch target.
- **Response leakage:** model output appears in test failure messages — it contains only refactoring commands for fictional paths. No secrets transit the harness.

## Edges

- `pnpm check` must never require a running model server — lane separation between `test:eval` (helpers, invariants) and `pnpm eval` (LLM cases) is a hard constraint. The eval is local-machine-only for now; CI integration is explicitly out of scope.
- `skill-file.test.ts` (skill format/packaging invariants) is untouched and must keep passing.
- Harness helpers stay thin: if they approach a framework (repeat sampling, score aggregation, reporters), stop and spec it — that's the "should have kept promptfoo" alarm.
- Skill files are read at run time; if a skill is renamed or added, `triggerContext()`/`skillContext()` discovery and AC5 should fail loudly rather than silently shrink coverage.
- Vue-task phrasings (e.g. rename inside an SFC) are not in the case table; add only with a deliberate case-table extension, not by relaxing assertions.
- v1 is single-shot at temperature 0 — on a local model this is effectively deterministic, so repeats add nothing. Statistical trigger *rates* (temperature > 0, repeat-N per case) are a future knob the case-table design shouldn't preclude, but they are out of scope now.
- A full run is ~15–25 calls to a local 14B model: expect 2–5 minutes wall-clock, zero cost. Anything that multiplies calls per case (retries, sampling) is out of scope.
- The transport seam (`callModel`) is the only provider-specific code. A future Anthropic/Haiku canonical gate — validating that descriptions tuned locally also win with Claude-class models — plugs in there without touching cases or assertions. Record this as the iteration path in `docs/eval-design.md`, do not build it now.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (harness helpers under `eval/` — confirm Stryker scope covers them; if Stryker only mutates `src/`, document that and rely on the unit tests)
- [ ] `pnpm check` passes (lint + build + test) — without a model server running
- [ ] A full `pnpm eval` run executed against the default local model with results recorded in the spec Outcome (model id, pass/fail per case — failures are signal about the skill files, not necessarily this task)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Docs updated:
      - `docs/eval-design.md` rewritten for the CLI harness (goal, two-stage architecture, local-model decision and its relative-signal caveat, Haiku-gate and Agent SDK iteration path, "adding a new operation" instructions referencing AC5's invariant, how to run: Ollama setup + env overrides)
      - `docs/quality.md` eval section updated (architecture list currently names run-eval/fixture-server/promptfooconfig)
      - `package.json`: `promptfoo` removed, `eval` script re-pointed; no new runtime dependency
      - handoff.md current-state section (eval/ layout)
- [ ] New handoff entries added: PreToolUse hook design `[needs design]`; agent-conventions MCP-validation dead-code check `[chore]`
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to `docs/internals/` / `docs/tech/` or `.claude/MEMORY.md` (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
