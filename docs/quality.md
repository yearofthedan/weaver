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

Numbers from `pnpm coverage` (vitest v8) as of 264 tests.

| Module | Lines | Branches | Target | Notes |
|--------|-------|----------|--------|-------|
| `src/operations/` | 95.68% | 84.49% | 90%+ | Exceeding target; mutation score is the better signal |
| `src/providers/` | 91.61% | 66.04% | 85%+ | Lines healthy; branch coverage low — virtual↔real path translation has many branches |
| `src/utils/` | 98.70% | 96.55% | 95%+ | Healthy; maintain |
| `src/security.ts` | 94.11% | 100% | 90%+ | All branches covered; two uncovered lines are `realpathSync` catch paths |
| `src/daemon/` | 39.59% | 39.13% | 60%+ | Below target; integration-heavy (socket, process lifecycle) |
| `src/mcp.ts` | 28.42% | 36.66% | 60%+ | Below target; stdio/socket mocking needed |
| `src/schema.ts` | 100% | 100% | — | Declarative Zod schemas; trivially covered |

Targets are floors, not goals. Mutation score is a better quality signal than line coverage for modules above 80%.

### Mutation testing

Use [Stryker](https://stryker-mutator.io/) with vitest (`pnpm test:mutate`) to validate assertion quality. Mutation testing answers "would my tests catch it if this line were wrong?" — a fundamentally different question from coverage.

- **Scope:** `src/security.ts`, `src/utils/`, `src/operations/`. Excludes `src/providers/` (expand once operations are clean), `src/daemon/`, and `src/mcp.ts` (line coverage too low — surviving mutants would just confirm test absence).
- **Don't add to `pnpm check`** — a full run takes ~8 minutes. Run periodically or before releases.
- **Config note:** `disableTypeChecks: false` is required. The default (`true`) prepends `// @ts-nocheck` to files in Stryker's sandbox, shifting line numbers and breaking any test that asserts on line/col positions.
- **Expect noise from:** string-heavy operations where Stryker's `StringLiteral` mutations produce equivalent mutants (excluded via config).
- **Target mutation score:** 80%+ on scoped modules. Below 60% indicates real assertion gaps worth fixing.

#### Mutation scores (as of 264 tests)

| Module | Score (total) | Score (covered) | Notes |
|--------|--------------|-----------------|-------|
| All scoped files | **77.57%** | 81.37% | Up from 72% at initial run |
| `security.ts` | 82.19% | 88.24% | Above threshold |
| `utils/text-utils.ts` | **100%** | 100% | Clean |
| `utils/assert-file.ts` | **100%** | 100% | Clean |
| `utils/file-walk.ts` | 70.00% | 72.41% | Below threshold |
| `utils/relative-path.ts` | 75.00% | 75.00% | Below threshold |
| `operations/moveFile.ts` | 86.67% | 92.86% | Above threshold |
| `operations/moveSymbol.ts` | 72.82% | 75.00% | Up from 55%; below threshold |
| `operations/rename.ts` | 78.26% | 81.82% | Near threshold |
| `operations/replaceText.ts` | 77.78% | 81.91% | Near threshold |
| `operations/findReferences.ts` | 76.47% | 81.25% | Near threshold |
| `operations/getDefinition.ts` | 73.33% | 78.57% | Below threshold |
| `operations/searchText.ts` | 70.19% | 75.26% | Below threshold |

#### Known surviving mutants (current)

Fixed gaps are removed. Remaining survivors by category:

**Accepted / low-risk (noise):**

| Area | Survivor | Why accepted |
|------|----------|-------------|
| `security.ts` | `ArrayDeclaration` — all four lookup tables (`RESTRICTED_WORKSPACE_ROOTS`, `SENSITIVE_BASENAME_EXACT`, `SENSITIVE_EXTENSIONS`, `SENSITIVE_BASENAME_PATTERNS`) can be emptied as a whole | Stryker's `ArrayDeclaration` mutator replaces the entire literal with `[]`; individual entries are `StringLiteral` mutations (excluded). Emptying a whole constant table is a massive change that code review catches; individual-entry tests exist. |
| `security.ts` | `NoCoverage` — `realpathSync` catch blocks in `validateWorkspace` (line 126) and `isWithinWorkspace` (line 141–142) | Requires a path that exists but throws on `realpathSync` — not reproducible without kernel-level mocking. Accepted risk. |
| `security.ts` | Regex mutations on `SENSITIVE_BASENAME_PATTERNS[0]` — `^` anchor drop, `$` drop, `.*` → `.` | Even without `^`, `service-account*.json` still matches all real filenames. Minor permissiveness; accepted. |
| `security.ts` | Regex mutation on `SENSITIVE_BASENAME_PATTERNS[1]` — `$` drop from `/-key\.json$/` | Slightly more permissive without `$`; still blocks all real key files. Accepted. |
| `relative-path.ts` | Regex `.cts$` → `.cts` (drop `$` anchor) | `.cts` only appears at the end of filenames in practice; functional difference is zero. |

**Worth fixing (next quality pass):**

| Area | Gap |
|------|-----|
| `operations/searchText.ts` | 70.19% — weakest operation after moveSymbol improvements |
| `operations/getDefinition.ts` | 73.33% — SYMBOL_NOT_FOUND and out-of-range paths need stronger assertion |
| `utils/file-walk.ts` | 70.00% — SKIP_DIRS logic and extension filtering have uncovered branches |
| `operations/moveSymbol.ts` | 72.82% — workspace-boundary `filesSkipped` paths still not covered |

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
