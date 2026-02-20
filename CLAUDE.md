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

## Commits

After making code changes, create a commit. Use conventional commits with imperative style:

```
type(scope): short description
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Examples:
- `feat(cli): add daemon mode support`
- `fix(ts-engine): handle missing tsconfig gracefully`
- `test(vue-engine): add cross-boundary rename cases`
- `docs: update CLI usage in README`
