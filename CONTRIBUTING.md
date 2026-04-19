# Contributing to weaver

## Prerequisites

- Node.js 24+
- pnpm 8+

## Setup

```bash
pnpm install
```

## Dev container

The repo includes a dev container configuration in `.devcontainer/`. It works with any container runtime — VS Code, CLI tools, or remote environments.

Two scripts wrap the common workflows. Both require the [devcontainer CLI](https://github.com/devcontainers/cli) (`npm install -g @devcontainers/cli`):

```bash
scripts/devcontainer-up.sh       # build and start the container
scripts/devcontainer-connect.sh  # attach with the AEE zellij layout
```

### GitHub authentication

After launching the container, run the bootstrap script to authenticate with GitHub and configure your git identity:

```bash
scripts/bootstrap-gh.sh
```

This will walk you through `gh auth login` interactively.

### Headless / CI usage

For non-interactive environments, pass GitHub credentials as environment variables to skip the interactive flow:

| Variable | Required | Description |
|---|---|---|
| `GH_TOKEN` | yes | A GitHub personal access token — used for `gh auth` |
| `GH_USER` | no | GitHub username — skips the API call to look it up |
| `GH_EMAIL` | no | Git commit email — defaults to `<id>+<user>@users.noreply.github.com` |

These can be set in `devcontainer.json` under `containerEnv`, passed via `docker run -e`, or injected by your CI provider.

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
├── ci.yml                 # lint + build + test + pnpm audit on push/PR
├── codeql.yml             # CodeQL security scanning on push/PR + weekly
├── quality-feedback.yml   # mutation testing (weekly + on push to main); triggers Claude Code triage on score < 75
└── release-please.yml     # automated releases: version bump PR + npm publish

.claude/skills/
│                          # Shipped with the package (for consumers):
├── search-and-replace/    # agent guidance for search-text + replace-text
├── move-and-rename/       # agent guidance for rename, move-file, move-directory, move-symbol, delete-file, extract-function
├── code-inspection/       # agent guidance for find-references, get-definition, get-type-errors
│                          # Internal (dev workflow only, metadata.internal: true):
├── slice/                 # /slice — pick up and implement the next task
├── spec/                  # /spec — create a spec from a handoff entry
├── mutate-triage/         # /mutate-triage — classify survivors, open issues or fix PRs
├── brainstorm/            # /brainstorm — explore design before implementation
├── run-checks/            # /run-checks — run tests/checks with tee output capture
├── implementation-context/ # /implementation-context — absorb local patterns before coding
├── using-git-worktrees/   # /using-git-worktrees — isolate feature work in a worktree
└── writing-skills/        # /writing-skills — create or edit skill files
```

## CI and automation

Every push and PR to `main` runs these checks:

| Workflow | What it does |
|---|---|
| **CI** (`ci.yml`) | `pnpm audit --prod --audit-level high` → Biome lint → build → full test suite |
| **CodeQL** (`codeql.yml`) | Static analysis with GitHub's `security-extended` query suite. Also runs on a weekly cron to catch newly-discovered patterns in existing code |
| **Quality feedback** (`quality-feedback.yml`) | Stryker mutation testing (weekly + on push to main). Triggers Claude Code triage when mutation score drops below 75 |

## Releasing

Releases are automated via [Release Please](https://github.com/googleapis/release-please):

1. Push conventional commits to `main` (e.g. `feat(cli): ...`, `fix(ts-engine): ...`)
2. Release Please opens (or updates) a PR titled "chore(main): release X.Y.Z" with a generated CHANGELOG entry and `package.json` version bump
3. That PR accumulates — every push to `main` updates it
4. When you merge the release PR, the publish job runs: `pnpm install` → `pnpm build` → `npm publish --tag alpha --provenance`
5. A GitHub Release is created automatically with npm provenance attestation

The `--tag alpha` flag means `npm install @yearofthedan/weaver` does **not** install alpha versions by default — users must use `@alpha` or an explicit version. This will change when a stable release ships.

## Security tooling

- **CodeQL** scans every push, PR, and weekly for security vulnerabilities. Results appear in the repo's Security tab
- **`pnpm audit`** runs in CI and blocks merges when a production dependency has a known high-severity vulnerability
- **Branch protection** requires PRs for all contributors except the repo owner, preventing accidental direct pushes to `main`
- **Vulnerability reporting** follows the process in [SECURITY.md](SECURITY.md) — private advisory form, not public issues
