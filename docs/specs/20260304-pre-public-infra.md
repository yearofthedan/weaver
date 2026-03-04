# Pre-public release infrastructure

**type:** change
**date:** 2026-03-04
**tracks:** handoff.md # pre-public-infra

---

## Context

The repo is ready to go public but is missing the infrastructure to do so safely: no license, no vulnerability disclosure policy, no automated release pipeline, and no code scanning. This spec covers everything needed to open the repo and publish `v0.1.0-alpha` to npm with confidence.

## Value / Effort

- **Value:** Unblocks public release. Without a license the repo is legally unusable. Without a release pipeline, publishing is manual and error-prone. Without CodeQL and a disclosure policy, the first public vulnerability report lands in a public GitHub issue.
- **Effort:** All config/workflow files — no source code changes except `package.json`. Touches: two new GH Actions workflows, two new root-level docs (LICENSE, SECURITY.md), one `package.json` update, one branch protection rule (UI/API, not a file). No new concepts; all plumbing through established tools.

## Behaviour

- [ ] Given a push to `main` that contains conventional commits, Release Please opens or updates a release PR with a generated `CHANGELOG.md` entry and a `package.json` version bump.
- [ ] Given that release PR is merged, Release Please publishes to npm with `--tag alpha` and provenance enabled; the GitHub Release is created and linked to the npm publish attestation.
- [ ] Given a push or PR to `main`, the CodeQL workflow runs the `security-extended` query suite and fails the check on any new finding.
- [ ] Given a weekly cron trigger, the CodeQL workflow runs the full `security-extended` scan on the current `main`.
- [ ] Given a push or PR to `main`, CI runs `pnpm audit --prod --audit-level high` and fails on any high-severity production dependency vulnerability.
- [ ] `package.json` declares an `exports` map that exposes only the public CLI entry point and blocks deep imports into `dist/`.
- [ ] `package.json` declares an `engines` field requiring Node.js 18+.
- [ ] `LICENSE` (MIT) exists at the repo root.
- [ ] `SECURITY.md` exists at the repo root with a one-paragraph disclosure policy pointing to GitHub's private security advisory form.
- [ ] Branch protection is enabled on `main`: PRs required for actors not on the bypass list; the repo owner's account is on the bypass list to allow direct pushes in interactive sessions.

## Interface

This spec delivers config files and GH Actions workflows, not a code API. Key shape decisions:

**Release Please workflow** (`release-please.yml`)
- Trigger: `push` to `main`
- Uses `google-github-actions/release-please-action`; `release-type: node`
- On release created: runs `pnpm install`, `pnpm build`, then `npm publish --tag alpha --provenance`
- Requires `NPM_TOKEN` secret and `contents: write` + `pull-requests: write` permissions

**CodeQL workflow** (`codeql.yml`)
- Triggers: `push` to `main`, `pull_request` targeting `main`, `schedule` (weekly)
- Language: `javascript-typescript`; query suite: `security-extended`
- Uses `github/codeql-action` v3

**`package.json` `exports` map**
```json
{
  ".": "./dist/cli.js"
}
```
Blocks `import '@yearofthedan/light-bridge/dist/internals'`; consumers only get the CLI entry.

**`package.json` `engines`**
```json
{ "node": ">=18" }
```

**SECURITY.md** — single section: "Reporting a vulnerability" → link to `https://github.com/yearofthedan/light-bridge/security/advisories/new`.

## Edges

- The `--tag alpha` flag means `npm install @yearofthedan/light-bridge` does **not** install this version by default — users must use `@alpha` or the explicit version. This is intentional; do not remove it.
- **`0.1.0` is already published to npm without `--tag alpha`**, meaning it currently sits on the `latest` dist-tag. npm does not allow removing `latest` (400 Bad Request). Accepted: `0.1.0` remains on `latest`; future alpha releases publish to the `alpha` tag only. `latest` will be updated naturally when a stable release ships. Before the pipeline runs for the first time, create a `v0.1.0` git tag on the current commit so Release Please has an anchor and doesn't attempt to re-publish `0.1.0`.
- Provenance requires the publish step to run inside a GH Actions job with `id-token: write` permission. This cannot be reproduced locally with `npm publish`.
- The `exports` map restricts JavaScript imports only — it does not affect the `skills/` directory, which is a static asset included via the `files` array and read as a file by consumers. The `exports` map and the `bin` entry coexist without conflict.
- Branch protection bypass is for the repo owner's personal account only — not a bot token, not a team. Cloud-mode runs (Claude.ai, etc.) do not have this bypass and must go through PRs.
- `pnpm audit --prod` already runs locally; this spec adds it to CI as a failing gate. Threshold is `high` — `moderate` is too noisy for alpha.
- CodeQL `security-extended` may surface findings in existing code. Triage before merging the PR that adds the workflow; document any accepted risks in a `.github/codeql/codeql-config.yml` exclusion with a comment.

## Done-when

- [ ] All ACs verified by inspection (workflows trigger correctly; npm dry-run with `--tag alpha --provenance` succeeds in CI)
- [ ] `pnpm check` passes
- [ ] `npm pack --dry-run` output does not include `src/`, `tests/`, `eval/`, or `.claude/`
- [ ] Release Please PR opens successfully against a test push
- [ ] CodeQL workflow completes without error on first run; any findings triaged
- [ ] Branch protection confirmed in GitHub repo settings: PR required, owner account bypasses
- [ ] README updated: add "Security" section pointing to SECURITY.md; update install instructions to use `@alpha` tag
- [ ] handoff.md current-state section updated
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
