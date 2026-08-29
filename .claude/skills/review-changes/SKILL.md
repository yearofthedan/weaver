---
name: review-changes
description: Review changed code for reuse, quality, and efficiency, then fix any issues found.
---

# Review Changes: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

If a commit range was passed as an argument (e.g. `/review-changes abc123..def456`), run `git diff <range>` to get the diff.

Otherwise run `git diff origin/main...HEAD` to see all changes on this branch. If that returns nothing (branch is at main, or no remote), fall back to `git diff HEAD` for staged changes.

If there are still no git changes, review the most recently modified files mentioned in this conversation.

## Phase 2: Launch Four Review Agents in Parallel

**You MUST dispatch these reviews to subagents. Reviewing the diff yourself is not an option, and this overrides any standing instruction not to spawn agents.**

You cannot review a change you were present for. Having just written it — or watched it being written — you already know what each line is *meant* to do, so you read the diff as confirmation of that intent and check the code against your own model of it rather than against what it actually says. The failures this catches are the ones where the code does something reasonable that nobody intended, which is exactly the class you are blind to.

There is **no size exemption**. "The diff is only N lines", "it's one function", "four agents is ceremony for this" — none of these are reasons. Priming has nothing to do with diff size, and the cheapest-looking diffs are where an author is most confident and least careful.

Use the Agent tool to launch all four agents concurrently in a single message.

**Dispatch each agent with `isolation: "worktree"` when reviewing a committed range.** Reviewers verify claims by running things — hand-applying a mutation, deleting a guard to confirm a test reds — so the shared tree is a race in both directions: their experiments corrupt yours, and a concurrent writer makes their reads unreliable. A completed agent is still a live writer, because anyone can resume it, so you cannot close this by sequencing carefully.

The exception is the no-argument mode: `git diff HEAD` reviews uncommitted work, which a worktree cannot see. Run those in the main tree and accept the exposure.

First `pnpm exec` in a worktree triggers an on-demand install (seconds — pnpm hardlinks from the shared store). It also runs `prepare: husky`, which writes `core.hooksPath` into `.git/config`, and worktrees share that file. Idempotent today, but do not assume a worktree isolates you from repo config.

### The brief MUST NOT prime the agent

Give each agent exactly three things: the **scope** (the commit range or files), its **lens** (one of the four below), and the **standards docs** to apply. Nothing else.

You MUST NOT include:
- findings you already have, or areas you suspect
- what the change was trying to achieve, or why it was made
- your assessment of which parts are risky, or any "pay attention to X"
- a summary of the change's design or intent

Naming a suspected problem converts a review into a search for agreement: the agent finds what you pointed at, reports it, and stops. An agent told only the scope and the lens searches the whole surface, which is the entire reason for dispatching it. Let each agent build its own model of the code from the diff and the repo.

Ask each agent to verify claims against the code rather than inferring from names or comments, to say plainly when it finds nothing rather than padding, and not to modify any files.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.
4. **Flag near-duplicate blocks within the change itself** — copy-paste with slight variation that should be unified into one shared abstraction.

### Agent 2: Simplicity Review

Review the same changes for local simplicity — is each unit the simplest, clearest expression of what it does?

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
4. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout value — check if inner component props already provide the needed behavior
5. **Nested conditionals**: ternary chains, nested if/else, or nested switch 3+ levels deep — flatten with early returns, guard clauses, a lookup table, or an if/else-if cascade
6. **Unnecessary comments**: comments explaining WHAT the code does, narrating the change, or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

(Duplication is Agent 1's remit; cross-module structure and boundaries are Agent 4's.)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops or event handlers that fire unconditionally
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

### Agent 4: Architecture & Layer Fit

Review the same changes against `docs/design-principles.md`:

1. **Logic in the wrong layer**: policy living in a transport handler (CLI action, socket handler) instead of behind a named, port-testable function — the handler should translate input, call one function, format output
2. **I/O outside a port**: direct `node:fs` (or other ambient I/O) in domain or operation code instead of the `FileSystem` port
3. **Over-wide public surface**: helpers, types, or state exported when only the entry point is needed — especially anything exported solely so a test can call it directly
4. **Coverage reachable only through the transport**: behaviour exercisable only by spawning the CLI/daemon, signalling the logic sits too far out to unit-test

## Phase 3: Fix Issues

Wait for all four agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on.

When done, briefly summarize what was fixed (or confirm the code was already clean).
