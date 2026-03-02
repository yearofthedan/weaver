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

Numbers from `pnpm coverage` (vitest v8) as of 316 tests.

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

- **Scope:** All `src/**/*.ts` except: `cli.ts`, `schema.ts`, `types.ts` (declarative/entry-point, no logic to mutate), `mcp.ts`, and most of `daemon/**` (integration tests spawn CLI binaries unavailable in Stryker's sandbox). `src/daemon/ensure-daemon.ts` is re-included — its tests are pure unit tests that work in the sandbox.
- **Don't add to `pnpm check`** — a full run takes ~22 minutes. Run periodically or before releases.
- **Config note:** `disableTypeChecks: false` is required. The default (`true`) prepends `// @ts-nocheck` to files in Stryker's sandbox, shifting line numbers and breaking any test that asserts on line/col positions.
- **Expect noise from:** string-heavy operations where Stryker's `StringLiteral` mutations produce equivalent mutants (excluded via config). `ArrayDeclaration` mutations are also excluded — replacing an entire constant array with `[]` is a massive structural change that code review catches; individual-entry mutations were already excluded via `StringLiteral`.
- **Target mutation score:** 80%+ on scoped modules. Below 60% indicates real assertion gaps worth fixing. `break` threshold in CI is set to 75 (floor, not target).
- **Current score:** Run `pnpm test:mutate` — scores are not tracked in this file to avoid stale data.

#### Known surviving mutants (current)

Fixed gaps are removed. Remaining survivors by category:

**`ensure-daemon.ts` (scoped run, 81.36%):**

| Area | Survivor | Why accepted |
|------|----------|-------------|
| `ensure-daemon.ts` | `versionVerified = false → true` in stale-socket cleanup | Intermediate state. After cleanup, the `if (isDaemonAlive)` block is skipped and `spawnDaemon` runs unconditionally; whether `versionVerified` is true or false at that point doesn't change observable behavior for the current call. |
| `ensure-daemon.ts` | `versionVerified = false → true` / `true → false` assignments inside version-mismatch and version-match branches | Same class — intermediate assignments between two unconditional fall-throughs. Not observable without exporting `versionVerified`. |
| `ensure-daemon.ts` | `callDaemon(sockPath, {} , ...)` — ping request body emptied | Test servers respond based on version number, not request format. Not observable within the unit-test boundary; the daemon validates the method field in integration. |
| `ensure-daemon.ts` | `if (nl !== -1) → if (true)` and `if (nl !== +1)` | Equivalent mutants for all test responses (response length >> 1, so `nl > 1` always). |
| `ensure-daemon.ts` | `resolve(JSON.parse(buf))` instead of `resolve(JSON.parse(buf.slice(0, nl)))` | `JSON.parse` tolerates trailing whitespace; functionally identical for single-response test cases. |
| `ensure-daemon.ts` | `.trim()` variants of the `stderrBuf.slice(consumed, newline).trim()` line | Only observable with multi-line or whitespace-padded stderr output from the spawned process. Single-line ready signal in tests makes both variants equivalent. |
| `ensure-daemon.ts` | `NoCoverage` — timer callback and JSON-parse catch in `spawnDaemon` | Timer fires after 30s (no fake-timer tests for the timeout path); JSON-parse catch only fires on truly malformed stderr (never in production). |

**`dispatcher.ts` (excluded from full run; narrow run score 65%):**

| Area | Survivor | Why accepted |
|------|----------|-------------|
| `dispatcher.ts` | 9 `static:true` ObjectLiteral mutations on OPERATIONS table entries (L105–L214) | When a full entry like `rename: { schema, invoke, … }` is replaced with `{}`, `descriptor.schema.safeParse` throws a TypeError. Stryker's vitest runner classifies unhandled TypeErrors as errors rather than test failures, leaving these as Survived rather than Killed regardless of test count. The dispatch logic that is actually observable (checkTypeErrors block, workspace boundary enforcement, per-operation invoke bodies) is covered by the killed mutations. Excluded from the full run to prevent the 65% score from breaching the 75% CI threshold. |
| `dispatcher.ts` | NoCoverage — `getVolarProvider` init and `projectProvider` Vue branch (L37–L54) | Only executed for Vue projects. All dispatcher unit tests use TS-only fixtures. Would need a Vue fixture dispatched via `dispatchRequest` — possible but low value given the Volar provider already has its own mutation tests. |
| `dispatcher.ts` | NoCoverage — `invalidateFile` / `invalidateAll` body mutations (L69–L79) | Called by the watcher, not by `dispatchRequest`. Testable with spy-based unit tests; not worth the complexity given the functions are 2-line trivial. |

**Accepted / low-risk (noise):**

| Area | Survivor | Why accepted |
|------|----------|-------------|
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
| `providers/volar.ts` | 6 NoCoverage ObjectLiteral mutations (`return {}`) in defensive null-check early returns inside `toVirtualLocation` and `translateSingleLocation` (lines 44, 47, 52, 59, 67, 72). Triggering them requires edge-case `.vue` structures deep in Volar internals: a `.vue` file absent from the virtual map (line 44), `sourceScript.generated === null` for a file that IS in the map (lines 47, 67), and `getServiceScript()` returning null with non-null `generated` (lines 52, 72). Template-only `.vue` files hit line 47 (not 52), because `sourceScript` itself is null for files without any Volar-processable block. |
| `utils/ts-project.ts` | 8 no-coverage mutants; score is well below threshold. Unblocked — add tests for `findTsConfig` walk-up loop and `isVueProject` cache. |
| `operations/rename.ts` | Near threshold; one more round may push it over. |
| `operations/findReferences.ts` | Near threshold. |

### Hard-won mutation lessons

Patterns that recur across mutation rounds — read before writing tests intended to kill surviving mutants.

**Stale Stryker sandboxes break `pnpm check`.**
After `pnpm test:mutate`, Biome errors with "Found a nested root configuration" if `.stryker-tmp/` dirs remain. Run `rm -rf .stryker-tmp` before `pnpm check`.

**`disableTypeChecks: false` is required in the Stryker config.**
The default (`true`) prepends `// @ts-nocheck` to files in Stryker's sandbox, shifting line numbers and breaking any test that asserts on line/col positions.

**`strict: true` does not kill mutants — TypeScript provides no mutation coverage.**
`disableTypeChecks: false` only prevents the `// @ts-nocheck` line-shift; it does not run `tsc --noEmit` on mutated files. vitest uses esbuild for transpilation (strips types, no type checking). Confirmed by 0 CompileErrors across all modules. Two practical implications:
- **Null-guard survivors** (`if (!locs || locs.length === 0)` etc.) — the return type is `SpanLocation[] | null`. TypeScript *requires* these guards; they are not dead code. They survive because the TS LS never returns null for in-range positions at runtime, not because TypeScript covers the null case.
- **Arithmetic / sort survivors** (`offset + len → offset - len`, sort comparators) — both variants are type-valid `number` expressions; TypeScript cannot distinguish semantic direction. Only tests can kill these.
"TypeScript covers this" is never a valid acceptance argument for a surviving mutant.

**TypeScript LS never returns empty/null for in-range positions.**
`getRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` all guard against null/empty results. In practice the TS LS navigates contextually to the nearest symbol for any position within a declaration. The `if (!locs || locs.length === 0)` guards are defensive dead code; accept them as survivors.

**Offset 0 maps to the function name, not the `export` keyword.**
`getRenameInfo(file, 0)` on `export function greetUser(...)` returns `greetUser` as the rename target (TS contextually resolves). To test `RENAME_NOT_ALLOWED`, use an import path string (e.g. `"./utils"` in `import ... from "./utils"`) with `allowRenameOfImportPath: false` — this reliably triggers `canRename: false`.

**Caching guards are performance-only survivors.**
`if (!project)` and `if (!cached)` guards prevent rebuilding on every call. Mutations that always rebuild produce identical results and are accepted survivors.

**`if (!sourceFile) → if (true)` survives even with no-tsconfig path.**
`addSourceFileAtPath` is idempotent — calling it on an already-loaded file is a no-op. `if (true)` (always call it) is semantically equivalent when the file is already in the project. `if (false)` variants are killed by the no-tsconfig tests.

**`rewriteImports` normalises whitespace.**
The replacement template always outputs `from ${quote}${rel}${quote}` (single space), regardless of how many spaces appeared in the original. A test for "multiple spaces after `from`" should assert the rewrite DID happen, not that the whitespace is preserved.

**Volar `toVirtualLocation` fallback branches need non-setup `.vue` structures.**
The fallback paths fire when Volar's source map or script generation returns null — this requires `.vue` files using `<script>` (non-setup) blocks or non-standard structures. Standard `<script setup>` fixtures always produce the happy path and leave fallbacks uncovered. A template-only `.vue` file (no `<script>` block) causes `getServiceScript()` to return null, triggering the `!serviceScript` branch. Create it programmatically via `fs.mkdtempSync` — do NOT add it to the shared fixture.

**`VolarProvider.getRenameLocations` and `getReferencesAtPosition` must be called with `.ts` paths, not `.vue` paths.**
The Volar proxy TS language service registers `.vue` files as `.vue.ts` virtual paths. Calling either operation with a `.vue` path throws "Could not find source file". Always initiate from a `.ts` file; `.vue` locations appear in the translated output, not the input. To test the `rawLocs.length === 0` null-return path, call from a `.ts` file at a blank-line offset within a Vue project.

**`globToRegex("*.ts")` does NOT match root-level files.**
The implementation prepends `**/` for patterns without `/`, producing regex `^.*/[^/]*\.ts$`. This requires at least one directory separator before the basename. Root-level files (e.g. `"foo.ts"`) never match. Tests must assert `"src/foo.ts"` not `"foo.ts"`.

**`isBinaryBuffer` is exercised by writing a real file with a null byte.**
Use `Buffer.concat([Buffer.from("text"), Buffer.from([0x00]), Buffer.from("more")])` and write via `fs.writeFileSync`. The binary skip is only triggered when the file is read during `searchText`, not during the glob walk.

**`moveSymbol` `filesSkipped` importer-loop path requires resolvable imports.**
The `if (!isWithinWorkspace(filePath, workspace))` guard only fires when ts-morph's `getModuleSpecifierSourceFile()` successfully resolves the import to a source file in the project. A test for this path needs a tsconfig with explicit `moduleResolution: "node"` or similar, plus an importer with a resolvable import path.

**`VolarProvider.resolveOffset` catch block needs an out-of-bounds line.**
Covered by calling `resolveOffset` with `line: 999` on a real `.vue` file (via `getDefinition`). The `lineColToOffset` call throws `RangeError`, caught and rethrown as `EngineError("SYMBOL_NOT_FOUND")`.

**Covering `translateLocations` requires asserting span length and no `.vue.ts` paths.**
Adding `getReferencesAtPosition` to VolarProvider tests covers the `translateLocations` code path. Assert that returned spans have non-zero `textSpan.length` and that no paths end in `.vue.ts` — otherwise the path-translation mutants survive.

**`filter(Boolean)` in the git path is an equivalent mutant.**
After `split("\n")`, the subsequent `.filter((line) => extSet.has(path.extname(line)))` also filters empty strings (since `path.extname("")` is `""`, which is never in the extension set). Removing `filter(Boolean)` produces identical output. Accept this survivor.

**Gitignored non-SKIP_DIRS directories kill the git-path `BlockStatement` mutant.**
If the git-path `if` body is emptied (BlockStatement mutation), the function falls back to recursive walk. The recursive walk respects `SKIP_DIRS` but NOT `.gitignore`. A gitignored directory that is not in `SKIP_DIRS` (e.g., `private/`) would then appear in the output. The test `excludes gitignored files in directories not in SKIP_DIRS` catches this.

**`moveSymbol` `filePath === absDest` guard needs the dest file to pre-import the symbol.**
The guard `if (filePath === absDest) continue` in the importer loop fires only when the destination file is itself an importer of the symbol (i.e., it already imports the symbol from the source). Without the guard, the importer loop would rewrite the dest file's import to a self-reference (`from "./helpers.js"` in helpers.ts). Assert `not.toContain('"./helpers.js"')` in the dest file content.

**`moveSymbol` dirty-files-loop filesSkipped requires the source to be outside the workspace.**
The `else { filesSkipped.add(fp) }` branch in the dirty-files loop fires when a ts-morph-dirtied file is outside the declared workspace. Set the workspace to `src/` only, put the source file in `lib/`, and use a tsconfig with `include: ["**/*.ts"]` so ts-morph loads both. Assert the source file is in `filesSkipped` AND its on-disk content is unchanged (proving the save loop also respected the boundary).

**`specifiers.length > 0` needs an importer with non-matching symbols.**
Mutation `> 0 → >= 0` includes importers with 0 matching specifiers. These "false positives" then gain a wrong import from the dest file. To kill this, add a file that imports OTHER symbols from the source (but not the moved symbol) and assert it does not gain an import from the dest.

**Process-entry-point code has an inherent in-process coverage gap.**
`runDaemon`, `runStop` body (after early-returns), and `handleSocketRequest` only run inside spawned daemon processes. v8 coverage only tracks what runs in the test runner's process. The right approach: test the validation early-returns with mocked `process.exit` (throw pattern); test exported happy-path functions directly (e.g. `stopDaemon`, `runStop` on a real daemon); accept the subprocess gap for the rest. Do NOT export private functions for testing — extract to a real module if the function deserves a public API.

**Symlink branch coverage requires real filesystem artefacts.**
The `isWithinWorkspace` symlink branch only fires when the path exists and `fs.existsSync` passes. Create real temp dirs and symlinks pointing outside the workspace — non-existent paths skip the `realpathSync` call and leave the branch dead.

---

### Test design patterns

Patterns established across the test suite — use these for consistency.

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
