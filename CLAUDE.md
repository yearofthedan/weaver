# weaver

A refactoring bridge between AI coding agents and compiler APIs. Provides ts-morph (TypeScript) and Volar (Vue) engines behind a CLI and MCP server.

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

Hard-won rules — update when a session goes wrong.

**Rule 1: Read `package.json` before researching a dependency's API.**
pnpm keeps old versions in its content-addressed store. Directory names under `node_modules/.pnpm/` are not reliable version sources. Read `package.json` first; confirm against `pnpm-lock.yaml` if in doubt.

**Rule 2: Once the root cause is known, read the exact source — stop probing symptoms.**
Stop inferring; read the source file directly. Every extra probing step costs money and time.

**Rule 3: When confused, stop and ask — do not assume.**
Flag ambiguity early. The cost of asking is zero compared to building on a wrong assumption.

**Rule 4: Tell research subagents which version to use and ask them to verify it.**
Explicitly state the version and instruct the subagent to confirm it from `package.json` inside the package directory before reading any source.

**Rule 5: Write tests as you implement, not after.**
Finish the test for a unit before moving to the next. The test is part of the implementation. Tests must specify behaviour, not just verify it: pin exact output shapes, cover at least one boundary or error path, and ask "what logic inversion would this test still pass through?" before moving on. TypeScript's type system does not kill mutants — only assertions do.

**Rule 6: When fixing a handoff entry, remove it from `docs/handoff.md` in the same commit. Only touch entries you actually completed.**

**Rule 7: Commit messages must not mention things you're NOT doing.** "Does not use X" is meaningless to someone reading the log without the conversation's context.

**Rule 8: Write durable memory to `.claude/MEMORY.md` — never to `~/.claude/`.**
This project runs in a dev container. The home directory is deleted on every rebuild, taking `~/.claude/projects/` with it. Do NOT use the auto-memory system there. Use `.claude/MEMORY.md` (git-tracked) instead. Technical gotchas belong in the relevant `docs/internals/` or `docs/tech/` doc, not in MEMORY.md.

**Rule 10: Not every task needs a spec — but every task needs a tag.**
Tasks in `docs/handoff.md` carry one of four tags:

- **`[chore]`** — implementation is unambiguous; implement directly, no spec needed. Any decision context is in the task description itself. Use for: text/doc edits, dependency bumps, dead code removal, small config changes. If you find yourself unsure how to implement it, change the tag to `[needs design]`.
- **`[needs investigation]`** — something is broken but the root cause is not yet confirmed. Run `/investigate` first — it reproduces the failure, observes the mechanism, and records a confirmed root cause, then routes the fix to `/slice` (unambiguous) or `/spec` (needs design). A bug whose cause is genuinely obvious is a spec-linked bug or a `[chore]`, not this.
- **`[needs design]`** — problem understood, solution not agreed. Run `/spec` first — it picks the right template, walks through ACs with the user, and produces a ready-to-implement file. When adding new work discovered during a session, add a `[needs design]` entry and move on — do not spec it in the same session.
- **spec link** — already designed, run `/slice` to implement.

`/spec` sessions stay frontier-led — design judgment is where a weaker model silently makes an expensive wrong call. A Sonnet-class orchestrator is only for `/slice` on a task that already has a finished spec, where the work is mechanical.

A `[needs investigation]` or `[needs design]` task cannot be downgraded to a direct fix by *claiming* you already know the cause or the design — the tag is lowered only by running the discipline (`/investigate` or `/spec`) and recording its result.

Before writing a spec, ask: (1) does planning add safety? (real architectural choices, multiple code paths, meaningful risk) and (2) will an archived spec be a useful future reference? (the "why" isn't visible in the output itself). If neither is true, use `[chore]`.

Do not add ACs to command or internals docs (`docs/commands/*.md`, `docs/internals/*.md`) — those are reference docs for shipped behaviour, not task tracking. ACs live in spec files and are archived (with an Outcome section) when the task ships.

Specs are **changesets**, not features. They describe a unit of work to deliver, then get archived. Code and tests must never reference spec identifiers (AC numbers, spec slugs, etc.) — describe the *behaviour* being tested, not the changeset that introduced it.

**Rule 9: Dogfood the tools — you are the target user.**
Use the CLI (`pnpm exec weaver <command>`) for refactoring during development. This is the primary interface most users will have — if it doesn't work well for you, it won't work well for them. If the CLI can't do what you need, add it to `docs/handoff.md`. Shareable skills (`.claude/skills/`) are fine — they ship with the tool and any consumer can load them. Private memories and rules that only exist in this repo's config are not a substitute for good tool descriptions.

The shipped skill files at `.claude/skills/{weaver-search-and-replace,weaver-refactor,weaver-code-inspection}/SKILL.md` are the canonical refactoring guidance — the same files external users load.

Skill files are interface documentation, not agent playbooks. Describe what the tool returns and what each field means. Do not prescribe what the agent should do in response — that's the caller's policy, not the tool's contract. The agent has project context weaver doesn't: pre-existing errors, intent, conventions.

**Rule 11: Pin exact dependency versions. Never use `^` or `~` ranges.**
Ranges let a compromised patch release auto-install on the next `pnpm install`, turning a single package takeover into a supply-chain attack across every consumer. All versions in `package.json` must be exact (e.g. `"1.2.3"`, not `"^1.2.3"`). Only install actively maintained packages — check for deprecation warnings before adding a dependency.

**Rule 13: Assess existing files before extending them.**
Before adding code, read the target file and apply the pre-edit assessment in `docs/code-standards.md`.

**Rule 14: When fixing a bug, establish a failing state first.**
Before applying a fix, confirm the failure with a reproducible command or a failing test. After applying the fix, verify that the same command or test now passes. Reading code and reasoning about why it should work is not verification. A *root-cause claim* is held to the same bar: it is confirmed only by a reproduced red state — plus, when the mechanism is hidden (a race, an ordering, unseen state), an observed mechanism from instrumenting the real path. Reasoning your way to a plausible cause, or a single green run of a flaky case, is not a confirmed cause. `/investigate` carries this discipline.

**Rule 15: Pipe long-running commands through `tee` — and never re-launch them.**
Always use `| tee /tmp/descriptive-name.log` for commands that take more than a few seconds (test suites, Stryker, builds). This preserves the full output for re-reading without re-running. Tail the tee output for immediate feedback: `command 2>&1 | tee /tmp/name.log | tail -20`. When running in the background, **wait for the completion notification**. Before even *thinking* about re-launching a background command: (1) `tail /tmp/the-tee-file.log` — the output file you created is the progress indicator, read it; (2) `pgrep -af <command>` — if the process is running, wait; (3) consider expected duration — mutation testing takes 10–20 minutes, `pnpm check` takes 1–2 minutes, builds take 10–30 seconds. Duplicate launches waste compute and corrupt shared state (temp dirs, caches).

**Rule 16: Commit the Stryker incremental cache after mutation runs.**
`reports/stryker-incremental.json` is committed to the repo so every developer and agent starts from the last known baseline. After any `pnpm test:mutate` or `pnpm test:mutate:file` run, commit the updated cache file. Targeted runs accumulate — run a few files at a time and the cache builds up.

**Rule 17: Think like an experienced engineer.**
Read the code before forming opinions. Look at function bodies, indirection depth, and seam boundaries before defending test placement or code structure. Spot clean code opportunities proactively — dead code, tests at the wrong level, unnecessary indirection, duplicated logic. When you find them, refactor in separate commits. Ensure tests live at the lowest level that exercises the behaviour; use 1–2 integration smoke tests for trivial delegation seams, not 10. Treat wasted compute (hour-long mutation runs, redundant CI cycles) as a cost worth investigating, not dismissing. Don't defend a position you haven't verified by reading the source.

**Rule 18: Use skills and the CLI for code searches — not grep.**
Before reaching for `grep` or `find`:
- Refactoring (rename, move, delete, extract) → invoke the `weaver-refactor` skill
- Symbol lookups, reference finding, definition jumping → invoke the `weaver-code-inspection` skill
- Multi-file text searches or replacements → invoke the `weaver-search-and-replace` skill

Both skills use `pnpm exec weaver` under the hood — dogfooding the primary user interface (Rule 9). The skills are listed in every session; check their trigger conditions before defaulting to shell tools.

**Rule 19: Default to static imports. Use `await import()` only when you can name the specific reason — and write that reason as a comment.**
Legitimate reasons: genuinely optional peer dep that may not be installed, breaking a real circular dependency, ESM-only module loaded from a CJS context.
Not legitimate: "the package is heavy," "we only sometimes call this."
Dynamic imports break Stryker's coverage attribution: the lines of the imported module are invisible to the mutation runner when the import is dynamic. Static imports are also the standard in this codebase — `await import()` without a comment is a bug.

**Rule 20: A mutation threshold is an alarm, not a target. Classify every survivor.**
Mutation testing finds bugs. When a mutant survives, ask: what does this tell me about the code? Then classify: (a) real gap — the test suite cannot catch this logic inversion, write the missing assertion; (b) noise — the mutant is structurally unreachable or untestable, document exactly why; (c) dead code — the branch cannot be reached, remove it. "We hit 75%" is not a classification. Optional chaining, default values, and defensive guards that silently swallow impossible states are the most dangerous survivors — they turn future bugs into silent wrong answers instead of loud crashes. If the code is supposed to always find what it looks for, make it throw when it doesn't.

**Rule 21: No narrative, no flavour, no history — in docs and in chat.**
State the current point, then the evidence. Cut hype ("this is the real deal"), the "not just A, but B" construction, dramatic build-up ("the interesting bit is…"), and changelog narration ("moved from P2", "former X", "now reframed") in living docs — handoff/specs/docs describe what *is*, not what changed. Prefer a table, list, or bare fact over a paragraph that walks up to one. Applies to documentation, commit messages, and replies to the user.

---

## Commits

After making code changes, create a commit. Use conventional commits with imperative style:

```
type(scope): short description
```

Examples:
- `feat(cli): add daemon mode support`
- `fix(ts-engine): handle missing tsconfig gracefully`
- `test(vue-engine): add cross-boundary rename cases`
- `docs: update CLI usage in README`
