**Purpose:** Testing strategy, performance targets, and reliability guarantees for light-bridge.
**Audience:** Developers implementing features, reviewers evaluating PRs.
**Status:** Current
**Related docs:** [Security](security.md) (controls), [Handoff](handoff.md) (next work)

---

# Quality Spec

## Testing

### Strategy

- **Unit tests** — primary coverage at the engine layer. Each engine operation (rename, move) is tested in isolation against known inputs and expected outputs.
- **Integration tests** — run against realistic fixture projects that mirror real-world TS/Vue structures. Fixtures should include cross-file dependencies, shared utilities, composables, and Vue components importing TypeScript modules.

### Fixtures

Fixtures should be minimal but realistic — a small app with enough complexity to exercise edge cases:
- Shared TypeScript utilities imported by multiple files
- Vue components with `<script setup>` importing from `.ts` files
- Composables used across multiple Vue components
- Barrel files and re-exports

### Coverage expectations

- All engine operations covered by unit tests
- Cross-boundary scenarios (`.ts` ↔ `.vue`) covered by integration tests
- Error paths (symbol not found, file not found, invalid path) explicitly tested

### Coverage targets by module

| Module | Current lines | Target | Notes |
|--------|--------------|--------|-------|
| `src/operations/` | 92% | 90%+ | Already strong; mutation testing is more valuable than chasing % |
| `src/providers/` | 91% | 85%+ | Virtual↔real translation paths are the priority |
| `src/utils/` | 99% | 95%+ | Healthy; maintain |
| `src/security.ts` | — | 90%+ | Correctness-critical; every branch matters |
| `src/daemon/` | 32% | 60%+ | Integration-heavy; requires harness investment |
| `src/mcp.ts` | 56% | 60%+ | Same — socket/stdio mocking needed |

Targets are floors, not goals. Mutation score is a better quality signal than line coverage for modules above 80%.

### Mutation testing

Use [Stryker](https://stryker-mutator.io/) with vitest to validate assertion quality in well-covered modules. Mutation testing answers "would my tests catch it if this line were wrong?" — a fundamentally different question from coverage.

- **Scope:** Start with `src/operations/`, `src/security.ts`, and `src/utils/`. Expand to `src/providers/` once those are clean.
- **Don't run on:** `src/daemon/` or `src/mcp.ts` until line coverage reaches 60%+. Below that threshold, surviving mutants just confirm the absence of tests.
- **Expect noise from:** string-heavy operations (`replaceText`, `searchText`) where Stryker's string literal mutations produce equivalent mutants.
- **Target mutation score:** 80%+ on scoped modules. Below 60% indicates real assertion gaps worth fixing.

---

## Performance

### Startup

- Server must be ready to accept tool calls within **20 seconds** of launch (ceiling, not target)
- The server must not block the agent during initialisation — it should report a not-ready state if a tool call arrives before parsing is complete
- Readiness is signalled to the agent explicitly

### Per-operation (warm server)

- All tool calls must complete within **4 seconds** on a realistic project

---

## Reliability

### Atomicity

All mutating operations (rename, move) are atomic. Either all file changes are applied, or none are. If any write fails mid-operation, all changes are rolled back.

- Implementation approach: TBD — likely staging changes in memory before writing to disk

---

## Observability

### Logging

- Logs are emitted to **stderr** to avoid polluting the MCP stdio channel
- Log operations and outcomes (what was requested, what files were affected, whether it succeeded)
- **Never log code content, file contents, or symbol values** — these may contain sensitive information
- Log errors with enough context to diagnose without exposing internals (no raw stack traces in production output)

### Metrics

- Deferred — useful but the shape is TBD
- Candidates: operation latency, startup time, files modified per operation

---

## Security

### Principles

- **Workspace boundary enforcement** — all file paths in tool calls must be validated against the workspace root. Any path that resolves outside the workspace is rejected. This applies to both read and write operations.
- **Least privilege** — the server writes files and nothing else. It does not delete files, execute commands, or access the network (except as part of explicitly registered hooks, which carry their own security review).
- **Input validation** — Zod schemas enforce shape. Validation must also explicitly enforce workspace boundary constraints, not just schema correctness.
- **Treat code as data** — symbol names, file paths, and any content derived from the codebase must never be interpolated unsanitised into structured output. All code content is data, not instructions.
- **Error message hygiene** — error responses must not leak stack traces, internal paths, or server internals. Errors should be descriptive enough for the agent to act on, not diagnostic dumps.
- **Response size limits** — `filesModified` must be capped or paginated to prevent oversized responses from flooding the agent's context window.
- **Log hygiene** — logs must not contain file contents, symbol values, or any data derived from code. Operations and metadata only.

### Deferred

- Full security review of the post-operation hook system (high attack surface — arbitrary shell command execution)
- Broader security audit (deferred, flagged in vision)
