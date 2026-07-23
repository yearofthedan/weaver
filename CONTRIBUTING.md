# Contributing to weaver

## Prerequisites

- Node.js 22+
- pnpm 11+ (via corepack)

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

Tests are colocated with the code they exercise (`*.test.ts` beside each source file; cross-cutting integration tests as `*.integration.test.ts`).

```bash
pnpm test        # unit + integration
pnpm test:eval   # eval-harness invariants (no model server)
pnpm eval        # full LLM skill eval (needs a local model server — see docs/eval-design.md)
pnpm check       # biome + build + coverage + test:eval (full check; also what CI runs)
```

The pre-commit hook (`scripts/pre-commit.sh`) picks a tier from what the commit
touches: a change confined to `eval/` and `docs/` runs only biome + `test:eval`,
while anything touching `src/`, skills, or a root config runs the full
`biome + build + test:all` gate. Coverage is omitted from the hook because it has
no threshold — it's a report, not a gate, and CI still produces it.

## Project structure

The source layout is documented — and kept up to date — in one place rather than duplicated here:

- [`docs/handoff.md`](docs/handoff.md) — current source tree and per-file responsibilities
- [`docs/architecture.md`](architecture.md) — compiler/operation design and the daemon
- [`docs/eval-design.md`](docs/eval-design.md) — the skill-eval harness

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
4. When you merge the release PR, the publish job runs: `pnpm install` → `pnpm build` → `npm publish --provenance`
5. A GitHub Release is created automatically with npm provenance attestation

## Security tooling

- **CodeQL** scans every push, PR, and weekly for security vulnerabilities. Results appear in the repo's Security tab
- **`pnpm audit`** runs in CI and blocks merges when a production dependency has a known high-severity vulnerability
- **Branch protection** requires PRs for all contributors except the repo owner, preventing accidental direct pushes to `main`
- **Vulnerability reporting** follows the process in [SECURITY.md](SECURITY.md) — private advisory form, not public issues
```
