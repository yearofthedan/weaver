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

**Rule 8: Write durable memory to `.claude/MEMORY.md` and `docs/agent-memory.md` — never to `~/.claude/`.**
This project runs in a dev container. The home directory is deleted on every rebuild, taking `~/.claude/projects/` with it. Do NOT use the auto-memory system there. Instead:
- `.claude/MEMORY.md` — project state and agent behaviour notes (git-tracked)
- `docs/agent-memory.md` — technical gotchas and decisions useful to humans too (git-tracked)

Update both at the end of every session.

**Rule 10: Every task gets a spec before implementation.**
Tasks in `docs/handoff.md` are either `[needs design]` (no spec yet) or linked to a spec file in `docs/specs/`. Use `/spec` to create a spec from a `[needs design]` entry — it picks the right template, walks through ACs with the user, and produces a ready-to-implement file. Use `/slice` to implement a spec. When adding new work discovered during a session, add a `[needs design]` entry to handoff.md and move on — do not spec it in the same session. Do not add ACs to feature docs (`docs/features/*.md`) — those are reference docs for shipped behaviour, not task tracking. ACs live in spec files and are archived (with an Outcome section) when the task ships.

**Rule 11: Doc updates are mandatory when public surfaces change — optional otherwise.**
When any of the following change, update the corresponding docs in the same commit:
- MCP tool added/renamed/removed → `README.md` tool table + `docs/features/mcp-transport.md` tool table
- CLI command added/renamed/removed → `README.md` CLI Commands + `docs/features/cli.md`
- Error code added/removed → `README.md` Error codes section
- Source layout changed (new/renamed/moved file in `src/`) → `README.md` Project structure + `docs/handoff.md` "Current state" layout

Description changes, implementation details, and internal refactoring do not require doc updates unless they affect a public interface.

**Rule 9: Dogfood the tools — you are the target user.**
The `mcp__light-bridge__*` tools are always available (configured in `.mcp.json`; daemon auto-spawns on first use). Every user of this tool gets the same MCP tool descriptions you do. If those descriptions aren't compelling enough to make you reach for the tools naturally during development, they aren't good enough for users either — improve the description, don't add a private agent rule. Shareable skills (`.claude/skills/`) are fine — they ship with the tool and any consumer can load them. Private memories and rules that only exist in this repo's config are not a substitute for good descriptions. If a tool can't do what you need at all, add it to `docs/handoff.md`.

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
