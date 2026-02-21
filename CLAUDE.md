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
pnpm format       # format in place
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
Finish the test for a unit before moving to the next. The test is part of the implementation.

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
