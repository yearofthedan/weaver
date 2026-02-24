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

- **Scope:** `src/security.ts`, `src/utils/`, `src/operations/`, `src/providers/` (excluding `vue-service.ts` — factory setup code driven by integration tests). Excludes `src/daemon/`, and `src/mcp.ts` (line coverage too low — surviving mutants would just confirm test absence).
- **Don't add to `pnpm check`** — a full run takes ~13 minutes. Run periodically or before releases.
- **Config note:** `disableTypeChecks: false` is required. The default (`true`) prepends `// @ts-nocheck` to files in Stryker's sandbox, shifting line numbers and breaking any test that asserts on line/col positions.
- **Expect noise from:** string-heavy operations where Stryker's `StringLiteral` mutations produce equivalent mutants (excluded via config).
- **Target mutation score:** 80%+ on scoped modules. Below 60% indicates real assertion gaps worth fixing.

#### Mutation scores (as of 284 tests)

| Module | Score (total) | Score (covered) | Notes |
|--------|--------------|-----------------|-------|
| All scoped files | **76.23%** | 79.50% | Providers added to scope |
| `security.ts` | 82.19% | 88.24% | Above threshold |
| `utils/text-utils.ts` | **100%** | 100% | Clean |
| `utils/assert-file.ts` | **100%** | 100% | Clean |
| `utils/file-walk.ts` | 73.33% | 73.33% | Below threshold |
| `utils/relative-path.ts` | 75.00% | 75.00% | Below threshold |
| `operations/moveFile.ts` | 86.67% | 92.86% | Above threshold |
| `operations/moveSymbol.ts` | 72.82% | 75.00% | Below threshold |
| `operations/rename.ts` | 78.26% | 81.82% | Near threshold |
| `operations/replaceText.ts` | 77.78% | 81.91% | Near threshold |
| `operations/findReferences.ts` | 76.47% | 81.25% | Near threshold |
| `operations/getDefinition.ts` | 73.33% | 78.57% | Below threshold |
| `operations/searchText.ts` | 70.19% | 75.26% | Below threshold |
| `providers/ts.ts` | 71.03% | 72.03% | First run; caching + out-of-project scan gaps |
| `providers/volar.ts` | 66.96% | 71.96% | Volar virtual↔real path branches; below threshold |
| `providers/vue-scan.ts` | 88.75% | 91.03% | Above threshold |

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
| `providers/ts.ts` | `if (!project) → if (true)` (caching guard line 17) and `if (tsConfigPath) → if (true)` (branch line 18) | Always rebuilding the project is slower but produces identical results. Caching is a performance concern, not a correctness concern. |
| `providers/ts.ts` | `new Project({ useInMemoryFileSystem: false }) → new Project({})` (line 24) | The default for ts-morph Project when no tsconfig is given; functionally equivalent for standalone file analysis. |
| `providers/ts.ts` | `refreshFile` whole-body no-op and related boolean mutations (lines 45–49) | `refreshFile` effects are only visible via subsequent compiler queries. Tests don't assert on post-refresh content; adding such tests would require disk writes and re-queries — a reasonable tradeoff to leave as-is. |
| `providers/ts.ts` | `if (!sourceFile) → if (true)` at lines 55, 68, 95, 115 | `addSourceFileAtPath` is idempotent; calling it on an already-loaded file is a no-op. The mutation `if (true)` is semantically equivalent when the file is already in the project. `if (false)` variants were killed by the no-tsconfig tests. |
| `providers/ts.ts` | Null guards `if (!locs \|\| locs.length === 0)`, `if (!refs \|\| ...)`, `if (!defs \|\| ...)` | TypeScript LS always returns non-empty arrays for any position that passes `getRenameInfo`/`canRename`. These are defensive guards that the TS LS never triggers in practice. |
| `providers/ts.ts` | `findRenameLocations` boolean params (`findInStrings: false → true`, `findInComments: false → true`) | Enabling string/comment search would only add more results to the returned set; no test asserts that rename locations are ABSENT from strings or comments. |
| `providers/ts.ts` | `allowRenameOfImportPath: false → true` in `getRenameInfo` and `findRenameLocations` | Tests don't attempt to rename an import specifier, so this option is never exercised in a way that distinguishes `true` from `false`. |
| `providers/ts.ts` | `getEditsForFileRename` filter (`textChanges.length > 0 → true`, `>= 0`) (line 140) | The TS LS never returns file rename edits with zero text changes; defensive guard. |
| `providers/ts.ts` | `afterFileRename` out-of-project scan survivors (lines 176–222) | Requires a fixture with files outside `tsconfig.include` that import the moved file. The existing moveFile tests use project-internal files only. Accepted for now — the logic is exercised by the moveFile integration tests indirectly. |
| `providers/volar.ts` | `cacheKey` `?? → &&` (line 14) | All Volar tests use a Vue fixture with a tsconfig; the null-tsconfig branch of `cacheKey` is not exercised. Killing this requires a Vue project without tsconfig — an uncommon scenario. |
| `providers/volar.ts` | `if (!cached) → if (true)` (line 22) | Always rebuilds Volar service; slower but correct. Same pattern as TsProvider caching guards. |
| `providers/volar.ts` | `toVirtualLocation` branch survivors (lines 41–59) | Multiple fallback branches triggered when Volar's source map or script generation returns null — edge cases in Volar's internal state that require `.vue` files with non-standard script blocks to exercise. |
| `providers/volar.ts` | `translateSingleLocation` branch survivors (lines 67–83) | Same as above — fallback paths for Volar glue code. The `if (!next.done) → if (true)` mutation means always taking the mapped position path even when no source mapping exists; would produce wrong offsets, but the one getDefinition test only checks the file name not the exact span. |
| `providers/volar.ts` | `NoCoverage` — `resolveOffset` catch block (line 103), `toVirtualLocation` ObjectLiteral returns | The catch path requires an out-of-bounds line; `toVirtualLocation` is only called via `getDefinitionAtPosition` which has one test. |

**Worth fixing (next quality pass):**

| Area | Gap |
|------|-----|
| `operations/searchText.ts` | 70.19% — weakest operation |
| `operations/getDefinition.ts` | 73.33% — SYMBOL_NOT_FOUND and out-of-range paths need stronger assertion |
| `utils/file-walk.ts` | 73.33% — SKIP_DIRS logic and extension filtering have uncovered branches |
| `operations/moveSymbol.ts` | 72.82% — workspace-boundary `filesSkipped` paths still not covered |
| `providers/volar.ts` | 66.96% — Volar internal path-translation branches; needs a fixture with `.vue` files using `<script>` (non-setup) blocks and specific source-map edge cases |

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
