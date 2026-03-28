# light-bridge

A refactoring bridge between AI coding agents and compiler APIs. Provides ts-morph (TypeScript) and Volar (Vue) engines behind a CLI and MCP server.

## Tech stack

- **Runtime**: Node.js 18+ with TypeScript (ESM)
- **Package manager**: pnpm
- **Build**: `tsc`
- **Test**: vitest
- **Lint/format**: Biome

## Commands

```bash
pnpm build        # compile TypeScript
pnpm test         # run all tests
pnpm check        # biome check + build + test
pnpm lint         # lint only
pnpm format       # format in place (whitespace/style only — does NOT fix import ordering)
pnpm exec biome check --write .  # fix everything: format + lint assists (organizeImports etc.)
pnpm test:mutate              # full mutation run (slow — hours)
pnpm test:mutate:file <path>  # targeted mutation on one file (minutes)
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

**Rule 6: When fixing items from tech-debt.md, remove them from the doc in the same commit. Only touch entries you actually completed.**

**Rule 7: Commit messages must not mention things you're NOT doing.** "Does not use X" is meaningless to someone reading the log without the conversation's context.

**Rule 8: Write durable memory to `.claude/MEMORY.md` — never to `~/.claude/`.**
This project runs in a dev container. The home directory is deleted on every rebuild, taking `~/.claude/projects/` with it. Do NOT use the auto-memory system there. Use `.claude/MEMORY.md` (git-tracked) instead. Technical gotchas belong in the relevant `docs/features/` or `docs/tech/` doc, not in MEMORY.md.

**Rule 10: Every task gets a spec before implementation.**
Tasks in `docs/handoff.md` are either `[needs design]` (no spec yet) or linked to a spec file in `docs/specs/`. Use `/spec` to create a spec from a `[needs design]` entry — it picks the right template, walks through ACs with the user, and produces a ready-to-implement file. Use `/slice` to implement a spec. When adding new work discovered during a session, add a `[needs design]` entry to handoff.md and move on — do not spec it in the same session. Do not add ACs to feature docs (`docs/features/*.md`) — those are reference docs for shipped behaviour, not task tracking. ACs live in spec files and are archived (with an Outcome section) when the task ships.

Specs are **changesets**, not features. They describe a unit of work to deliver, then get archived. Code and tests must never reference spec identifiers (AC numbers, spec slugs, etc.) — describe the *behaviour* being tested, not the changeset that introduced it.

**Rule 9: Dogfood the tools — you are the target user.**
The `mcp__light-bridge__*` tools are always available (configured in `.mcp.json`; daemon auto-spawns on first use). Every user of this tool gets the same MCP tool descriptions you do. If those descriptions aren't compelling enough to make you reach for the tools naturally during development, they aren't good enough for users either — improve the description, don't add a private agent rule. Shareable skills (`.claude/skills/`) are fine — they ship with the tool and any consumer can load them. Private memories and rules that only exist in this repo's config are not a substitute for good descriptions. If a tool can't do what you need at all, add it to `docs/handoff.md`.

The shipped skill files at `.claude/skills/{search-and-replace,move-and-rename,code-inspection}/SKILL.md` are the canonical refactoring guidance — the same files external users load.

**Rule 11: Pin exact dependency versions. Never use `^` or `~` ranges.**
Ranges let a compromised patch release auto-install on the next `pnpm install`, turning a single package takeover into a supply-chain attack across every consumer. All versions in `package.json` must be exact (e.g. `"1.2.3"`, not `"^1.2.3"`). Only install actively maintained packages — check for deprecation warnings before adding a dependency.

**Rule 13: Follow `docs/code-standards.md` for file size and reuse.**
Read target files before extending them. Ideal file length is 150 lines; review at 300; hard flag at 500. Search for existing utilities before writing new ones. See `docs/code-standards.md` for the full set of refactoring triggers.

**Rule 14: When fixing a bug, establish a failing state first.**
Before applying a fix, confirm the failure with a reproducible command or a failing test. After applying the fix, verify that the same command or test now passes. Reading code and reasoning about why it should work is not verification.

**Rule 15: Pipe long-running commands through `tee`.**
Always use `| tee /tmp/descriptive-name.log` for commands that take more than a few seconds (test suites, Stryker, builds). This preserves the full output for re-reading without re-running. Tail the tee output for immediate feedback: `command 2>&1 | tee /tmp/name.log | tail -20`.

**Rule 16: Commit the Stryker incremental cache after mutation runs.**
`reports/stryker-incremental.json` is committed to the repo so every developer and agent starts from the last known baseline. After any `pnpm test:mutate` or `pnpm test:mutate:file` run, commit the updated cache file. Targeted runs accumulate — run a few files at a time and the cache builds up.

**Rule 17: Think like an experienced engineer.**
Read the code before forming opinions. Look at function bodies, indirection depth, and seam boundaries before defending test placement or code structure. Spot clean code opportunities proactively — dead code, tests at the wrong level, unnecessary indirection, duplicated logic. When you find them, refactor in separate commits. Ensure tests live at the lowest level that exercises the behaviour; use 1–2 integration smoke tests for trivial delegation seams, not 10. Treat wasted compute (hour-long mutation runs, redundant CI cycles) as a cost worth investigating, not dismissing. Don't defend a position you haven't verified by reading the source.

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
