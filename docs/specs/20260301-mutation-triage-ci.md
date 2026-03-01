# Mutation triage CI gate

**type:** change
**date:** 2026-03-01
**tracks:** handoff.md # P2 Agent triage on mutation score warning

---

## Context

When `pnpm test:mutate` reports a score below the 75% break threshold, a human must read the Stryker output, cross-reference `docs/quality.md`'s accepted-survivor list, and decide whether to open an issue or write new tests. This spec automates that triage: a GitHub Actions workflow runs mutation testing, and on failure the official `anthropics/claude-code-action@v1` invokes a Claude Code skill to classify survivors and take action — opening a GitHub issue for noise survivors or creating a fix branch with new tests and a draft PR for fixable ones.

## Behaviour

- [ ] Given Stryker completes with `metrics.mutationScore ≥ 75`, the workflow succeeds and the Claude Code Action step is skipped entirely — no issues, no PRs, no agent invocation.
- [ ] Given Stryker completes with `metrics.mutationScore < 75` and every surviving mutant (`status: "Survived"` or `"NoCoverage"`) semantically matches an entry in the "Known surviving mutants" or "Accepted / low-risk" tables in `docs/quality.md`, the agent reports "all survivors already documented" and creates no issues or PRs.
- [ ] Given ≥ 1 surviving mutant not in quality.md that matches a noise pattern (caching guard, equivalent arithmetic, defensive null guard, or `NoCoverage` in a process-entry-point), the agent creates one GitHub issue per logical gap (grouped by file + noise pattern type) containing: source file path, line range, mutation operator, mutated snippet, and a one-sentence rationale for why it should be accepted.
- [ ] Given ≥ 1 surviving mutant not in quality.md and not matching any noise pattern (i.e., a testable gap), the agent creates a branch `fix/mutation-<yyyymmdd>-<slug>`, adds tests targeting each fixable survivor's location, iterates with `pnpm check` until it passes, commits, and opens a draft GitHub PR with a summary table of the survivors addressed.
- [ ] Given Stryker's JSON report does not exist at the expected path (mutation run crashed), the agent logs a clear error identifying the missing path and takes no further action.

## Interface

### Workflow file

`.github/workflows/mutation.yml`

**Trigger:** `schedule` (weekly or nightly — exact cron TBD) + `workflow_dispatch` for manual runs.

**Steps:**

1. Checkout, install deps, build
2. `pnpm test:mutate` with `continue-on-error: true`, capturing exit code
3. Conditional step (`if: steps.mutate.outcome == 'failure'`): `anthropics/claude-code-action@v1` with `prompt: "/mutate-triage"`, `--model claude-opus-4-6` (code reasoning requires Opus), and tool restrictions via `claude_args`

**Required secrets:** `ANTHROPIC_API_KEY`. `GH_TOKEN` is provided automatically by the action.

**Tool allowlist for the agent:** `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep` — sufficient for reading reports, writing tests, running `pnpm check`, and calling `gh`. No need for `Agent` or `WebFetch`.

### Skill file

`.claude/skills/mutate-triage/SKILL.md`

The skill instructs the agent to:

1. Locate the Stryker JSON report (`reports/mutation/mutation.json`). If absent, log the error and stop.
2. Extract all mutants with `status: "Survived"` or `"NoCoverage"`. Each has: `mutatorName` (e.g. `"ConditionalExpression"`), `replacement` (mutated snippet), `location.start.line` (1-indexed), and `sourceFilePath`.
3. Read `docs/quality.md` — specifically the "Known surviving mutants", "Accepted / low-risk", and "Hard-won mutation lessons" sections.
4. Classify each survivor as **known** (matches a quality.md table entry), **noise** (matches a lesson pattern but not explicitly listed), or **fixable** (testable gap).
5. For **known**: no action.
6. For **noise**: create a GitHub issue via `gh issue create` with a structured body (file, line, operator, snippet, rationale). Group by file + pattern type — one issue per group.
7. For **fixable**: create a branch `fix/mutation-<yyyymmdd>-<slug>` (slug = primary source file basename), write tests targeting the survivor locations, run `pnpm check`, iterate on failures until passing, commit, and open a draft PR via `gh pr create --draft`.

### Stryker JSON fields consumed

| Field | Type | Description |
|-------|------|-------------|
| `metrics.mutationScore` | `number` (0–100) | Overall score; ≥ 75 means no triage needed |
| `files[path].mutants[].status` | `"Survived" \| "NoCoverage" \| ...` | Only `Survived` and `NoCoverage` are triaged |
| `files[path].mutants[].mutatorName` | `string` | e.g. `"ConditionalExpression"`, `"ArithmeticOperator"` |
| `files[path].mutants[].replacement` | `string` | The mutated code snippet; may be empty for `NoCoverage` |
| `files[path].mutants[].location.start.line` | `number` (1-indexed) | Source line of the mutant |

**Realistic bounds:** A full Stryker run on this codebase produces ~800 mutants across ~20 files. Surviving mutants are typically 50–150 (score 75–85%). The agent processes only survivors, so input size is bounded.

**Zero case:** Score ≥ 75, zero survivors to triage. The action step is skipped entirely (workflow conditional).

**Adversarial case:** A large refactor drops the score to 40% with 300+ survivors. The agent should still work but may hit `--max-turns`. The skill should prioritize the highest-impact files (most survivors) and open an issue for the remainder if it cannot address all in one run.

### GitHub issue body shape

```markdown
## Surviving mutant(s): <file>

| Line | Operator | Replacement | Rationale |
|------|----------|-------------|-----------|
| 17 | ConditionalExpression | `if (true)` | Caching guard — always rebuilding is slower but correct. |

**Suggested action:** add to "Accepted / low-risk" table in `docs/quality.md`.
```

### PR body shape

```markdown
## Mutation triage: fix surviving mutants

Score before: XX.X% · Break threshold: 75%

### Survivors addressed

| File | Line | Operator | Test added |
|------|------|----------|------------|
| src/utils/ts-project.ts | 42 | ConditionalExpression | `it("returns null when tsconfig walk reaches root")` |

Run `pnpm test:mutate` to confirm score improvement.
```

### Branch naming

`fix/mutation-<yyyymmdd>-<slug>` where `<slug>` is the primary source file's basename (e.g., `fix/mutation-20260301-ts-project`). If the branch already exists, append `-2`, `-3`, etc.

## Edges

- Must NOT triage mutants with `status: "Killed"`, `"Timeout"`, or `"CompileError"` — only `"Survived"` and `"NoCoverage"`.
- Must NOT push to `main` or `master` — fix branches always use the `fix/mutation-` prefix.
- If ALL new survivors are classified as noise, zero PRs are created; that is correct, not an error.
- If ALL new survivors are classified as fixable, zero issues are created; that is correct, not an error.
- The agent must cap its iteration at `--max-turns` (set in `claude_args`). If it cannot fix all survivors within that budget, it should commit what it has and note the remaining gaps in the PR description.
- The workflow must not run on every PR push — it is scheduled or manually triggered only (mutation testing is too slow for per-PR gating).
- The skill file must be self-contained: a new Claude Code agent with no prior context should be able to follow it end-to-end.

## Done-when

- [ ] `.github/workflows/mutation.yml` present and valid YAML; includes `schedule`, `workflow_dispatch` triggers, and conditional Claude Code Action step
- [ ] `.claude/skills/mutate-triage/SKILL.md` present with complete triage instructions
- [ ] Workflow tested locally via `act` or validated via `gh workflow run` (if repo has Actions enabled)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - README.md project structure (new workflow + skill)
      - handoff.md current-state section (new files)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
