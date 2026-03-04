# Contributing to light-bridge

## Prerequisites

- Node.js 18+
- pnpm 8+

## Setup

```bash
pnpm install
```

## Build

```bash
pnpm run build
```

## Test

```bash
pnpm run test
```

## Agent workspace checks

```bash
# Fast static policy check for committed MCP configs (CI-friendly)
pnpm run agent:check

# Optional runtime smoke check for local environment/debugging
pnpm run agent:doctor
```

Tests include:

- **Operation tests** — per-operation behavior and boundary handling (`tests/operations/`)
- **Provider tests** — ts-morph/Volar provider behavior (`tests/providers/`)
- **MCP transport tests** — tool registration and end-to-end MCP calls (`tests/mcp/`)
- **Daemon tests** — lifecycle, socket protocol, watcher, and stop behavior (`tests/daemon/`)
- **Security tests** — workspace boundary and sensitive-file controls (`tests/security/`)
- **Utility tests** — shared path/text/file helpers (`tests/utils/`)

## Project structure

```
src/
├── cli.ts                 # CLI entry point (daemon, serve, stop)
├── schema.ts              # Zod input validation
├── types.ts               # Shared result/provider interfaces
├── security.ts            # Workspace + sensitive-file checks
├── mcp.ts                 # MCP server (connects to daemon)
├── daemon/
│   ├── daemon.ts          # Socket server; daemon lifecycle
│   ├── ensure-daemon.ts   # ensureDaemon, callDaemon, spawnDaemon
│   ├── paths.ts           # Socket/lockfile path utilities
│   ├── dispatcher.ts      # Data-driven operation dispatch
│   └── watcher.ts         # Filesystem watcher + invalidation callbacks
├── operations/
│   ├── rename.ts
│   ├── moveFile.ts
│   ├── moveSymbol.ts
│   ├── deleteFile.ts
│   ├── extractFunction.ts
│   ├── findReferences.ts
│   ├── getDefinition.ts
│   ├── getTypeErrors.ts
│   ├── searchText.ts
│   └── replaceText.ts
├── providers/
│   ├── ts.ts              # TypeScript provider (ts-morph)
│   ├── volar.ts           # Vue provider (Volar)
│   ├── vue-scan.ts        # Vue import rewrite post-steps
│   └── vue-service.ts     # Volar service factory
└── utils/
    ├── text-utils.ts
    ├── file-walk.ts
    ├── ts-project.ts
    ├── relative-path.ts
    ├── assert-file.ts
    └── errors.ts

tests/
├── operations/            # Operation behavior tests
├── providers/             # Provider behavior tests
├── mcp/                   # MCP transport + tool call tests
├── daemon/                # Daemon lifecycle + protocol tests
├── security/              # Boundary and sensitive-file tests
├── utils/                 # Shared utility tests
├── eval/                  # Fixture server unit tests
├── helpers.ts             # Test utilities
└── fixtures/              # Fixture projects

eval/
├── fixture-server.ts      # In-process daemon impersonator; exports startFixtureServer
├── run-eval.ts            # Entry point: starts fixture server, runs promptfoo, tears down
├── promptfooconfig.yaml   # PromptFoo config; 5 positive + 1 negative case
└── fixtures/              # Pre-recorded daemon JSON responses keyed by method name

.github/workflows/
├── ci.yml                 # lint + build + test on push/PR
└── quality-feedback.yml   # mutation testing (weekly + on push to main); triggers Claude Code triage on score < 75

.claude/skills/
├── slice/                 # /slice — pick up and implement the next task
├── spec/                  # /spec — create a spec from a handoff entry
└── mutate-triage/         # /mutate-triage — classify survivors, open issues or fix PRs
```
