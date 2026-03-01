# Agent+MCP Eval Design

**Status:** Approved
**Date:** 2026-03-01
**Tracks:** [handoff.md](handoff.md) P2 eval task → implementation spec TBD

---

## Goal

Verify that light-bridge MCP tool *descriptions* are compelling and clear enough that an AI agent
(Claude Haiku) naturally selects the right tool for a given refactoring task — and correctly
interprets the result.

The benchmark: competing with Claude's built-in language server tools. If the agent reaches for
`search_text` when it should call `find_references`, the tool description has failed.

## Non-goals

- **Engine correctness regression** — unit tests cover this; the eval does not re-test it
- **Multi-turn agent loops** — one task → one tool call per eval case; no reasoning chains
- **Cross-model comparison** — `claude-haiku-4-5` only for eval runs
- **Cost / latency benchmarking** — not the job of this eval
- **CI gating** — runs locally on demand; not a PR check

## Success metric

An eval run passes when, for each test case:

1. The model selects the correct MCP tool (not a wrong one, not a search fallback)
2. The model produces a sensible user-facing summary of the fixture response

Both conditions must hold. Tool-selection alone is insufficient — the output format must be
interpretable too.

## Architecture

### Recommended framework: PromptFoo

[PromptFoo](https://promptfoo.dev) is a Node.js eval framework with a native MCP provider.
It can point directly at the light-bridge `serve` process and run test cases that assert on
tool choice and response quality. No additional harness code needed for MCP connection.

### Fixture-based daemon

The daemon returns **pre-recorded fixture responses** rather than doing live compilation.
This keeps each eval case fast (< 1s), deterministic, and runnable without a TypeScript
project on disk.

A fixture is a JSON file capturing the daemon's JSON response for a given tool + input.
The MCP server serves real tool descriptions; only the daemon response is stubbed.

### Eval case structure

```
Task (natural language)  →  Model (Haiku, tools available)  →  Tool call + args
                                                             ↓
                                                    Fixture daemon response
                                                             ↓
                                                    Model summary
                                                             ↓
                                              Assertions (tool? args? summary quality?)
```

### Example cases

| Task | Expected tool | Fixture response |
|------|---------------|------------------|
| "Find everywhere the `User` type is used" | `find_references` | `{ references: [...] }` |
| "Rename `userId` to `accountId` at line 12" | `rename` | `{ edits: [...] }` |
| "What type errors exist in auth.ts?" | `get_type_errors` | `{ errors: [...] }` |
| "Move `parseToken` to utils/token.ts" | `move_symbol` | `{ edits: [...] }` |
| "Search for all TODO comments" | `search_text` | `{ matches: [...] }` |

Each case should also include a **negative** variant — a task that sounds similar but maps
to a different tool — to detect false positives.

## Running

```bash
pnpm eval          # run all cases, print pass/fail per case + overall score
pnpm eval --case find_references  # run a single case
```

A run prints: cases passed / total, any failed tool selections, any failed summaries.
No threshold enforcement in v1 — results are informational.

## Where to add new cases

Cases live in `eval/cases/`. Each file is a PromptFoo test config targeting one tool.
Fixtures live in `eval/fixtures/`. Adding a new tool means: one fixture file + one case file.

## Iteration path

1. **v1 (this design):** Single-tool cases, fixture daemon, Haiku, local-only, no threshold
2. **v2:** Add multi-tool negative cases; introduce a pass threshold (e.g. 90%)
3. **v3:** Live daemon option — run against a real TypeScript fixture project for smoke-testing
   end-to-end compilation paths

---

*Implementation tracked in handoff.md. See the follow-up `[needs design]` entry.*
