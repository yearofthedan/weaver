# weaver

A refactoring bridge between AI coding agents and compiler APIs. Provides ts-morph (TypeScript) and Volar (Vue) engines behind a CLI.

## Tech stack

- **Runtime**: Node.js 22+ with TypeScript (ESM)
- **Package manager**: pnpm
- **Build**: `tsc`
- **Test**: vitest
- **Lint/format**: Biome

## Commands

```bash
pnpm build        # compile TypeScript
pnpm test         # run main tests (accepts file args)
pnpm test:eval    # run eval tests only
pnpm test:all     # run both main + eval tests
pnpm check        # biome check + build + test:all
pnpm lint         # lint only
pnpm format       # format in place (whitespace/style only — does NOT fix import ordering)
pnpm exec biome check --write .  # fix everything: format + lint assists (organizeImports etc.)
pnpm test:mutate              # full mutation run (slow — hours)
pnpm test:mutate:file <path>  # targeted mutation on one file (minutes)
pnpm test:mutate:eval              # mutation run scoped to eval/harness (seconds)
pnpm test:mutate:eval:file <path>  # targeted mutation on one eval harness file
pnpm eval                     # LLM eval of skill files vs a local Ollama model (see docs/eval-design.md)
```

## Agent rules

Cross-cutting rules for **how the agent works** in this repo — investigating, delegating, committing, capturing knowledge. Update them when a session goes wrong, and keep each one general (state the principle, not the incident that prompted it). Rules about how code is *written* live in [`docs/code-standards.md`](docs/code-standards.md); rules about the *shape* of a change live in [`docs/design-principles.md`](docs/design-principles.md).

### Where the rules live

Every rule has one home, chosen by what it is about. Route new learnings by this table — do not add a rule here if it belongs in an owning doc.

| If the rule is about… | It lives in |
|---|---|
| How **code is written** (naming, imports, comments, file size, casts, test structure) | [`docs/code-standards.md`](docs/code-standards.md) |
| The **shape** of a change (where logic lives, boundaries, what's exposed, minimal shape) | [`docs/design-principles.md`](docs/design-principles.md) |
| A **procedure scoped to one workflow** (spec, slice, investigate, mutation triage, worktrees, running checks) | that workflow's **internal** skill in `.claude/skills/` (`internal: true`) |
| A **domain gotcha** (one command, engine, or tool) | the owning [`docs/internals/`](docs/internals/) or [`docs/tech/`](docs/tech/) doc |
| How the agent **writes** (tone, durability tests, banned phrases) — unless the rule names this repo | [`docs/writing-standards.md`](docs/writing-standards.md) |
| **How the agent works** across all workflows | this file |
| Current **state / status** of the project | [`docs/handoff.md`](docs/handoff.md) |

Never put agent policy or procedure into a shipped `weaver-*` skill — those are external tool-interface docs, not playbooks (see *Dogfood the tools*).

### Working with the user

- **When the user asks a question, answer it before touching any tools.** Reaching for tools while a question is unanswered is acting instead of listening. Answer, confirm they want the change, then act.
- **When confused, stop and ask — do not assume.** Flag ambiguity early. The cost of asking is zero compared to building on a wrong assumption.
- **Do simple docs tasks directly — don't delegate.** For straightforward doc edits (text, diagrams, tables), do the work inline rather than spawning a subagent.

### Diagnose before acting

- **Verify empirically — establish a failing state first.** Before applying a fix, confirm the failure with a reproducible command or a failing test; after the fix, confirm the same command passes. Reading code and reasoning about why it *should* work is not verification. A root-cause *claim* is held to the same bar: confirmed only by a reproduced red state — plus an observed mechanism (from instrumenting the real path) when the cause is hidden (a race, an ordering, unseen state). `/investigate` carries this discipline.
  - **When a bug is fixed, show the reproduction evidence and ask the user to verify it — do not self-certify.** Post the literal output of the failing-state repro and the literal output of the same command passing after the fix (not a paraphrase or a summary), then explicitly ask the user to confirm the reproduction is legitimate before treating the bug as closed. This is a checkpoint the user signs off on, not a step you clear on your own judgment.
  - **A mechanism is not a root cause — it is the evidence for a *theory* about one.** Observing *what* happens (a trail, a log line, the failing step) shows the mechanism; attributing it to a *cause* is a theory until an experiment isolates the driver — change the one thing you suspect and show the red move. Until then, write "theory," not "root cause," and do not design a fix on it. A `[needs investigation]` tag is not lowered by an unconfirmed causal story, however plausible — only by isolating the cause.
  - **Reproduce in the real project, not a fixture copy.** The daemon, watcher, singleton compiler, and project detection behave differently in the real project (real `node_modules`, `.vue` files triggering `isVueProject`, cached compiler state). A test that passes on a simplified copy proves nothing about the daemon path.
  - **Fix the cause, not the error.** Never suppress a failure with a try-catch or an `ok: true` that hides wrong results. Ask "what does the user want to happen?" and make the operation correct. Every error is a symptom of an underlying bug — fix that bug.
  - **"The same command" means the literal repro, with a value that can't pass by accident, against the real artifact.** Re-run the exact command that established the failing state — not a new command that resembles it. If the repro used a differentiating value (a sentinel string, not a plausible real one), keep using one: a plausible value can coincidentally match pre-existing state and pass for the wrong reason, producing a false "verified" fix. If the fix touches a tracked template (`.env.example`, a schema, a sample config), also inspect the untracked local file actually read at runtime (`.env`) — editing the template is not the fix, and a stale local copy will silently reproduce the exact bug just fixed. Do not scale to an expensive, paid, or irreversible action on the strength of a weaker check.
  - **When a change appears to have no effect, confirm the artifact under test is the one you just built — before theorising about the code.** A stale binary fails identically to a broken feature, and the false red sends you debugging correct code. Resolve what the command actually runs (`which`, follow the shim, `realpath` the package link, grep the built output for a string only the new code contains) and check its timestamp. The same discipline applies to the false green afterwards: having been wrong once is not a reason to distrust a correct result, so re-verify against the right artifact and move on rather than escalating for reassurance.
- **A green check is not evidence your code was checked.** Lint, typecheck, coverage, and mutation configs all enumerate paths, so code in a new location sits outside every one of them and still reports green — the failure mode is silence, not an error. When you add code somewhere new, prove the tooling reaches it (make it fail once) rather than inferring it from a passing run.
- **Once the root cause is known, read the exact source — stop probing symptoms.** Every extra probing step costs money and time.

### Task workflow & tags

`/slice` is the default entry point for picking up work. Not every task needs a spec — but every task in `docs/handoff.md` carries one of four tags:

- **`[chore]`** — implementation is unambiguous; implement directly, no spec needed. Any decision context is in the task description itself. Use for: text/doc edits, dependency bumps, dead code removal, small config changes. If you find yourself unsure how to implement it, change the tag to `[needs design]`.
- **`[needs investigation]`** — something is broken but the root cause is not yet confirmed. Run `/investigate` first — it reproduces the failure, observes the mechanism, and records a confirmed root cause, then routes the fix to `/slice` (unambiguous) or `/spec` (needs design). A bug whose cause is genuinely obvious is a spec-linked bug or a `[chore]`, not this.
- **`[needs design]`** — problem understood, solution not agreed. Run `/spec` first — it picks the right template, walks through ACs with the user, and produces a ready-to-implement file. When adding new work discovered during a session, add a `[needs design]` entry and move on — do not spec it in the same session, and do not auto-create specs during exploratory conversation (architecture Q&A stays conversational until the user asks for a spec).
- **spec link** — already designed, run `/slice` to implement.

`/spec` sessions stay frontier-led — design judgment is where a weaker model silently makes an expensive wrong call. A Sonnet-class orchestrator is only for `/slice` on a task that already has a finished spec, where the work is mechanical.

A `[needs investigation]` or `[needs design]` task cannot be downgraded to a direct fix by *claiming* you already know the cause or the design — the tag is lowered only by running the discipline (`/investigate` or `/spec`) and recording its result.

Before writing a spec, ask: (1) does planning add safety? (real architectural choices, multiple code paths, meaningful risk) and (2) will an archived spec be a useful future reference? (the "why" isn't visible in the output itself). If neither is true, use `[chore]`.

Do not add ACs to command or internals docs (`docs/commands/*.md`, `docs/internals/*.md`) — those are reference docs for shipped behaviour, not task tracking. ACs live in spec files and are archived (with an Outcome section) when the task ships. Specs are **changesets**, not features: they describe a unit of work to deliver, then get archived.

- **When fixing a handoff entry, remove it from `docs/handoff.md` in the same commit. Only touch entries you actually completed.**
- **Fix discovered small tech debt in the same session.** Misplaced tests, incorrect docs, or small structural problems found during a change: fix them now (in a separate commit). Deferring turns a 10-minute fix into a full session to pick up later. (An out-of-scope *bug* is different — log it as a `[needs design]` handoff entry and move on.)

### Dependencies & research

- **Read `package.json` before researching a dependency's API.** pnpm keeps old versions in its content-addressed store; directory names under `node_modules/.pnpm/` are not reliable version sources. Read `package.json` first; confirm against `pnpm-lock.yaml` if in doubt.
- **Tell research subagents which version to use and to verify it** from `package.json` inside the package directory before reading any source.

### Dogfood the tools

- **Dogfood the CLI — you are the target user.** Use `pnpm exec weaver <command>` for refactoring during development, after `pnpm build`. This is the primary interface most users will have — if it doesn't work well for you, it won't work well for them. If the CLI can't do what you need, add it to `docs/handoff.md`. The shipped skill files at `.claude/skills/{weaver-search-and-replace,weaver-refactor,weaver-code-inspection}/SKILL.md` are the canonical refactoring guidance — the same files external users load. They are **interface documentation, not agent playbooks** — describe what the tool returns, never what the agent should do with it.
- **Default to weaver's CLI and skills over `grep`/`sed`/manual `Edit` for code search and structural change** — they're compiler-aware, so they catch the re-exports a text search misses and the importers a manual multi-file edit misses. (Which skill covers what is in the skill descriptions, surfaced every session — this is the standing preference, not a re-listing.)

### Delegating to subagents

- **When prompting an execution agent, describe *what* to do, not *what comments to leave*.** "Step 1:/Step 2:" in a prompt gets transcribed as code comments; put method-level context in a JSDoc instead. Say "test at the lowest layer that verifies the behaviour" — don't restate an assertion at two layers.
- **Use worktrees for parallel, independent ACs** (`isolation: "worktree"`), so agents on the same working tree don't conflict. Run sequentially when one AC depends on another's output. The `using-git-worktrees` skill carries the procedure.
- **A completion notification is not proof the agent finished.** It fires whenever an agent stops with no live background children — including when the agent parked itself waiting on a job it launched and will never be woken from. Check `ListAgents` before acting on a batch: an agent still listed as running can wake and write to the working tree mid-commit. Stop it explicitly once you have taken the work over.
- **Name the steps the agent must *not* take.** An execution agent handed a spec will run adjacent workflow steps it can see — a mutation run, triage, the next batch — and those collide with the orchestrator's. State the boundary outright ("do not run Stryker", "do not end your turn waiting on a background job"); the batch's scope does not imply it.

### Commit hygiene

Use conventional commits, imperative style — `type(scope): short description`:

- `feat(cli): add daemon mode support`
- `fix(ts-engine): handle missing tsconfig gracefully`
- `test(vue-engine): add cross-boundary rename cases`

- **The body explains WHY, not WHAT.** Split commits at logical boundaries and commit at every logical milestone — don't let changes accumulate.
- **Commit messages must not mention things you're NOT doing.** "Does not use X" is meaningless to someone reading the log without the conversation's context.

### Long-running commands

**Pipe long-running commands through `tee` — and never re-launch them.** Use `| tee /tmp/descriptive-name.log` for anything over a few seconds (test suites, Stryker, builds) so the full output can be re-read without re-running. Tail for immediate feedback: `command 2>&1 | tee /tmp/name.log | tail -20`. When running in the background, **wait for the completion notification**. Before even *thinking* about re-launching a background command: (1) `tail /tmp/the-tee-file.log` — the output file is the progress indicator, read it; (2) `pgrep -af <command>` — if it's running, wait; (3) weigh expected duration (mutation testing 10–20 min, `pnpm check` 1–2 min, builds 10–30 s). Duplicate launches waste compute and corrupt shared state (temp dirs, caches). The `run-checks` skill carries the full procedure.

### Knowledge capture

- **Write durable knowledge to its owning file — never to `~/.claude/`.** This project runs in a dev container; `~/.claude/` (and its auto-memory store) is wiped on every rebuild. Route durable knowledge by *Where the rules live*: process rules → this file; code/shape standards → `code-standards.md` / `design-principles.md`; technical gotchas → the owning `docs/internals/` or `docs/tech/` doc; state → `docs/handoff.md`.
- **Encode fixes into durable artifacts, and don't hoard knowledge.** When the user corrects you, ask "what skill, template, or doc should change so the next agent doesn't repeat this?" — memory doesn't survive sessions; artifacts do. Anything non-obvious you learn belongs in its owning file before the session ends. This is a standing obligation, not a reaction to mistakes.
- **Write general rules, not incident reports.** Capture the principle ("specs must not contain contradictions"), not the one scenario that triggered it ("don't assign Vue cleanup to two layers") — the general form catches the next different failure too.
- **Git-tracked docs state what the reader must supply, never personal-environment specifics.** A shared doc is read by people without your machine — name what to provide (e.g. "set `WEAVER_EVAL_API_KEY` to an OpenRouter key"), not a local path, a password-manager entry, or personal tooling. Those stay session-only.

### Communication style

@docs/writing-standards.md

**Plain engineering language, never research or statistics vocabulary.** Say what the thing does in ordinary words: "take the table out and see if scores drop", not "ablation"; "small numbers lie", not "underpowered". Avoid *ablation* (in any form), *p-value*, *Fisher's exact test*, *paired deltas*, *sign test*, *unit of analysis*. Where a concept genuinely needs a technical term, define it in one clause on first use. This binds written artifacts hardest — docs, handoff entries, commit messages, and file *names* outlive the conversation and are read by people who never saw it. The eval docs use this vocabulary in places; translate it, don't echo it.
