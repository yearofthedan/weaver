**Purpose:** Testing strategy, performance targets, and reliability guarantees for weaver.
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

### Eval suite

The eval suite (`eval/`) tests a different quality dimension from unit/integration tests: **do the tool descriptions cause agents to select the right tool for a given task?** Unit tests verify correct outputs given correct inputs; evals verify that agents reach for the right tool in the first place.

### Don't fix pre-existing mutation scores by adding tests at the wrong layer

If mutation survivors are in code you didn't change, note them and move on. Adding integration tests to kill unit-level mutants is test duplication — the fix belongs in unit tests for the unchanged code, as a separate task. Only add tests at the layer where the logic lives.

**How it works:**

- `eval/run-eval.ts` — entry point (`pnpm run eval`). Starts a fixture server that impersonates the daemon, runs `promptfoo eval` against `eval/promptfooconfig.yaml`, tears down on exit.
- `eval/fixture-server.ts` — Unix socket server; responds to `ping` (version check) and serves pre-recorded JSON fixtures from `eval/fixtures/{method}.json` for every tool call. The model never touches a real project.
- `eval/promptfooconfig.yaml` — defines providers and test cases. Two providers: `weaver-only` (MCP only) and `with-shell-alternatives` (MCP + bash/grep/sed stubs). Tests use `providers:` to target one or both.

**Test structure — 15 tests:**

- **Single-tool positives** — natural-language tasks that should map to exactly one weaver tool. Assert `tool-call-f1 ≥ 0.8` for the expected tool.
- **Two-step flows** — tasks that require a discovery step before the action. Split into two tests each:
  - *Step-1 test*: plain user message; assert the right first tool is selected.
  - *Step-2 test*: conversation history pre-seeded with the step-1 call and its fixture response; assert the correct follow-up tool is selected.
- **Negative cases** — tasks where a simpler tool might be chosen incorrectly. Assert the correct compiler-aware tool, optionally assert the wrong tool is absent via `type: javascript`.
- **Competing-tool tests** — run against `with-shell-alternatives`. Assert weaver tool selected and bash/grep/sed absent from the output.

**Seeded-history format (step-2 tests):**

Set `vars.task` to a JSON messages array string. Promptfoo parses the rendered `{{task}}` prompt as a conversation when it's valid JSON:

```yaml
vars:
  task: |
    [
      {"role": "user", "content": "..."},
      {"role": "assistant", "content": [
        {"type": "tool_use", "id": "toolu_s1", "name": "searchText", "input": {...}}
      ]},
      {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_s1", "content": "...fixture JSON..."}
      ]}
    ]
```

The fixture JSON in `tool_result` should match the content of the relevant `eval/fixtures/{method}.json` so the model gets realistic results to act on.

**Running a single test:**

```bash
node_modules/.bin/tsx eval/run-eval.ts --filter-pattern "some description"
```

Do not use `pnpm eval -- --filter-pattern` — pnpm intercepts the `--` separator.

**Adding new tests:**

1. Add a fixture file `eval/fixtures/{newMethod}.json` if a new tool is involved.
2. Add the test case(s) to `promptfooconfig.yaml` with natural-language prompts (no domain jargon, no workflow hints in the task text).
3. For two-step flows, add both the step-1 and step-2 tests.
4. Run `pnpm run eval` to confirm the new tests pass before committing.

### Coverage expectations

- All engine operations covered by unit tests
- Cross-boundary scenarios (`.ts` ↔ `.vue`) covered by integration tests
- Error paths (symbol not found, file not found, invalid path) explicitly tested

### Coverage targets by module

Numbers from `pnpm coverage` (vitest v8) as of 413 tests.

| Module | Lines | Branches | Target | Notes |
|--------|-------|----------|--------|-------|
| `src/operations/` | 95.68% | 84.49% | 90%+ | Exceeding target; mutation score is the better signal |
| `src/providers/` | 91.61% | 66.04% | 85%+ | Lines healthy; branch coverage low — virtual↔real path translation has many branches |
| `src/utils/` | 98.70% | 96.55% | 95%+ | Healthy; maintain |
| `src/security.ts` | 94.11% | 100% | 90%+ | All branches covered; two uncovered lines are `realpathSync` catch paths |
| `src/daemon/` | 60.4% | 59.42% | 60%+ | At threshold (folder level); `daemon.ts` alone is 57.28% — `handleSocketRequest` and watcher-extension logic only run inside spawned processes |
| `src/mcp.ts` | 33.67% | 40% | 60%+ | Below target; `ensureDaemon`, `startMcpServer`, `spawnDaemon` only run when the full MCP server is spawned — subprocess-level gap |
| `src/schema.ts` | 100% | 100% | — | Declarative Zod schemas; trivially covered |

Targets are floors, not goals. Mutation score is a better quality signal than line coverage for modules above 80%.

### Mutation testing

Use [Stryker](https://stryker-mutator.io/) with vitest (`pnpm test:mutate`) to validate assertion quality. Mutation testing answers "would my tests catch it if this line were wrong?" — a fundamentally different question from coverage.

- **Target mutation score:** 80%+ on scoped modules. Below 60% indicates real assertion gaps worth fixing. `break` threshold in CI is set to 75 (floor, not target).
- **Current score:** Run `pnpm test:mutate` — scores are not tracked in docs to avoid stale data.
- **Don't add to `pnpm check`** — a full run takes ~22 minutes. Run periodically or before releases.

For Stryker config details, known surviving mutants, and hard-won lessons, see **[`docs/tech/mutation-testing.md`](tech/mutation-testing.md)**.

---

### Test design patterns

Patterns established across the test suite — use these for consistency.

**Test helpers are split into three files by concern.**
`tests/helpers.ts` — fixture I/O only (`copyFixture`, `cleanup`, `readFile`, `fileExists`, `PROJECT_ROOT`). `tests/process-helpers.ts` — CLI spawn and daemon helpers (`spawnAndWaitForReady`, `waitForDaemon`, `killDaemon`, `callDaemonSocket`, `runCliCommand`). `tests/mcp-helpers.ts` — MCP client (`McpTestClient`, `parseMcpResult`, `useMcpContext`). Import from the appropriate module; `mcp-helpers` imports from both others.

**`spawnAndWaitForReady` and `runCliCommand` accept a `cwd` option.**
Pass `{ cwd: dir }` to spawn the CLI process with a different working directory. Required when testing the `--workspace` default (which falls back to `process.cwd()`).

**`mockReturnValue` vs `mockImplementation` for fake child processes with async gaps.**
If the code under test calls an async operation (e.g. a socket ping) before calling `spawn`, the fake child returned by `mockReturnValue(makeFakeChild())` will have its `setTimeout(0)` fire *before* `child.stderr.on("data", ...)` is registered — the ready event is missed and `spawnDaemon` times out. Fix: use `mockImplementation(() => makeFakeChild())` so the child (and its timer) is created at the moment `spawn` is called, not at test-setup time. Rule of thumb: whenever there is an `await` between calling `mockReturnValue` and the code that sets up event listeners on the returned object, use `mockImplementation` instead.

**`vi.resetModules()` + dynamic `import()` in `beforeEach` for module-level state reset.**
`ensure-daemon.ts` (and similar modules) use a module-level `let versionVerified = false`. Tests that exercise the "already verified" path require controlling this flag between test cases. The correct approach: call `vi.resetModules()` in `beforeEach`, then `const mod = await import("...")` to get a fresh module instance. Registered `vi.mock()` factories remain active after `vi.resetModules()` (mock registry is separate from module instance cache). Do NOT export the flag for testing — that is the antipattern this pattern replaces.

**Mocking `process.exit` — use the throw pattern.**
`vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("EXIT"); }) as () => never)` is the standard pattern for testing code that calls `process.exit` on failure. The throw stops execution at the point the real exit would have, keeping the test hermetic. Always restore with `vi.restoreAllMocks()` in `afterEach`. For paths that do NOT call `process.exit` (happy paths), no mock is needed — await the function directly.

**`useMcpContext()` in `tests/helpers.ts` for MCP integration tests.**
Call once at the top of a `describe` block; returns `{ setup }`. `setup(fixture?)` copies the fixture, starts the MCP server, waits for the daemon, returns `{ dir, client }`. The `afterEach` cleanup (kill process, `removeDaemonFiles`, remove temp dir) is registered automatically.

**`parseMcpResult(resp)` in `tests/helpers.ts` for MCP response parsing.**
Extracts `.content[0].text` and JSON-parses it. Use instead of the two-line cast-and-parse inline in every MCP test.

**Error assertions: always use `rejects.toMatchObject`.**
`await expect(op(...)).rejects.toMatchObject({ code: "ERROR_CODE" })` is idiomatic vitest and safer than `try/catch + expect.fail`. The `try/catch` pattern silently passes if the wrong error type is thrown.

**`setup(fixture?)` helper pattern for operation tests.**
Each operation test file defines a local `setup(fixture = "default-fixture")` at the top of the `describe`, which calls `copyFixture` + `dirs.push`. Tests call `setup()` or `setup("other-fixture")` instead of repeating the two lines. See `rename.test.ts`, `findReferences.test.ts`, `getDefinition.test.ts` for examples.

**`it.each` for extension-mapping tables.**
`relative-path.test.ts` uses `it.each` with named object rows (`{ src, expected, desc }`) and `$desc` as the test name template. Preferred for parametric tests where each row has a different semantic meaning.

**Vertical slice tests assert before and after.**
Always read fixture files before the operation to confirm original state, then assert both that the old string is gone and the new string is present. This catches false positives where an assertion passes because the fixture never had the expected content.

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

---

For the threat model, controls, and known limitations, see [`docs/security.md`](security.md).
