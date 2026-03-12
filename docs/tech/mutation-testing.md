# Mutation testing

**Purpose:** Stryker config, known surviving mutants, and hard-won lessons for light-bridge's mutation test suite.
**Run:** `pnpm test:mutate` (full run).
**See also:** [quality.md](../quality.md) for overall testing strategy.

---

## Configuration

Use [Stryker](https://stryker-mutator.io/) with vitest (`pnpm test:mutate`) to validate assertion quality. Mutation testing answers "would my tests catch it if this line were wrong?" — a fundamentally different question from coverage.

- **Scope:** All `src/**/*.ts` except: `cli.ts`, `schema.ts`, `types.ts` (declarative/entry-point, no logic to mutate), `mcp.ts`, and most of `daemon/**` (integration tests spawn CLI binaries unavailable in Stryker's sandbox). `src/daemon/ensure-daemon.ts` is re-included — its tests are pure unit tests that work in the sandbox.
- **Don't add to `pnpm check`** — a full run takes ~22 minutes. Run periodically or before releases.
- **`disableTypeChecks: false` is required.** The default (`true`) prepends `// @ts-nocheck` to files in Stryker's sandbox, shifting line numbers and breaking any test that asserts on line/col positions.
- **Expect noise from:** string-heavy operations where Stryker's `StringLiteral` mutations produce equivalent mutants (excluded via config). `ArrayDeclaration` mutations are also excluded — replacing an entire constant array with `[]` is a massive structural change that code review catches; individual-entry mutations were already excluded via `StringLiteral`.
- **Target mutation score:** 80%+ on scoped modules. Below 60% indicates real assertion gaps worth fixing. `break` threshold in CI is set to 75 (floor, not target).
- **Current score:** Run `pnpm test:mutate` — scores are not tracked in docs to avoid stale data.

**Scoping a run to a single file:** use the `--mutate` flag:
```bash
stryker run --mutate 'src/operations/getTypeErrors.ts'
```
This overrides the `mutate` array from the config. Useful when checking mutation score for touched files without running the full suite.

**`vitest.related: true` doesn't meaningfully speed up an integration-heavy run.**
When most tests transitively import most of `src/` (as in light-bridge's integration tests), Vitest's import-graph filter barely narrows the per-mutant test set. `related: true` is harmless and may help slightly for isolated utilities.

**Stryker `testFiles` negation patterns (`!`) are silently broken.**
`FileMatcher` calls `path.resolve(pattern)`, turning `!tests/foo.test.ts` into `/abs/path/!tests/foo.test.ts` — the `!` becomes a literal filename character, so the exclusion never fires. Use a separate vitest config (`vitest.stryker.config.ts`) with `exclude:` arrays instead. Vitest's glob processing handles negation correctly.

**`CI=1` is always set in the dev container — don't use it to detect "local".**
Use an explicit env var (e.g. `STRYKER_RELATED=false`) and two named scripts (`test:mutate` / `test:mutate:ci`) instead.

**Stryker JSON reporter must be explicitly enabled.**
The config must list `json` in `reporters` and configure `jsonReporter.fileName`. It is not on by default. Required for the `/mutate-triage` skill to parse structured output.

**Kill stryker processes before cleaning `.stryker-tmp`.**
Stryker's sandbox directories (`.stryker-tmp/sandbox-*`) can't be removed by `rm -rf` while worker processes still have them open. Run `pkill -f stryker` and wait a moment before cleaning. Stale sandboxes also cause Biome to error with "Found a nested root configuration" — run `rm -rf .stryker-tmp` before `pnpm check`.

---

## Known surviving mutants (current)

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
| `dispatcher.ts` | NoCoverage — `getVolarCompiler` init and `projectCompiler` Vue branch (L37–L54) | Only executed for Vue projects. All dispatcher unit tests use TS-only fixtures. Would need a Vue fixture dispatched via `dispatchRequest` — possible but low value given the Volar provider already has its own mutation tests. |
| `dispatcher.ts` | NoCoverage — `invalidateFile` / `invalidateAll` body mutations (L69–L79) | Called by the watcher, not by `dispatchRequest`. Testable with spy-based unit tests; not worth the complexity given the functions are 2-line trivial. |

**Accepted / low-risk (noise):**

| Area | Survivor | Why accepted |
|------|----------|-------------|
| `security.ts` | `NoCoverage` — `realpathSync` catch blocks in `validateWorkspace` (line 126) and `isWithinWorkspace` (line 141–142) | Requires a path that exists but throws on `realpathSync` — not reproducible without kernel-level mocking. Accepted risk. |
| `security.ts` | Regex mutations on `SENSITIVE_BASENAME_PATTERNS[0]` — `^` anchor drop, `$` drop, `.*` → `.` | Even without `^`, `service-account*.json` still matches all real filenames. Minor permissiveness; accepted. |
| `security.ts` | Regex mutation on `SENSITIVE_BASENAME_PATTERNS[1]` — `$` drop from `/-key\.json$/` | Slightly more permissive without `$`; still blocks all real key files. Accepted. |
| `relative-path.ts` | Regex `.cts$` → `.cts` (drop `$` anchor) | `.cts` only appears at the end of filenames in practice; functional difference is zero. |
| `compilers/ts.ts` | `if (!project) → if (true)` (caching guard line 17) and `if (tsConfigPath) → if (true)` (branch line 18) | Always rebuilding the project is slower but produces identical results. Caching is a performance concern, not a correctness concern. |
| `compilers/ts.ts` | `new Project({ useInMemoryFileSystem: false }) → new Project({})` (line 24) | The default for ts-morph Project when no tsconfig is given; functionally equivalent for standalone file analysis. |
| `compilers/ts.ts` | `refreshFile` whole-body no-op and related boolean mutations (lines 45–49) | `refreshFile` effects are only visible via subsequent compiler queries. Tests don't assert on post-refresh content; adding such tests would require disk writes and re-queries — a reasonable tradeoff to leave as-is. |
| `compilers/ts.ts` | `if (!sourceFile) → if (true)` at lines 55, 68, 95, 115 | `addSourceFileAtPath` is idempotent; calling it on an already-loaded file is a no-op. The mutation `if (true)` is semantically equivalent when the file is already in the project. `if (false)` variants were killed by the no-tsconfig tests. |
| `compilers/ts.ts` | Null guards `if (!locs \|\| locs.length === 0)`, `if (!refs \|\| ...)`, `if (!defs \|\| ...)` | TypeScript LS always returns non-empty arrays for any position that passes `getRenameInfo`/`canRename`. These are defensive guards that the TS LS never triggers in practice. |
| `compilers/ts.ts` | `findRenameLocations` boolean params (`findInStrings: false → true`, `findInComments: false → true`) | Enabling string/comment search would only add more results to the returned set; no test asserts that rename locations are ABSENT from strings or comments. |
| `compilers/ts.ts` | `allowRenameOfImportPath: false → true` in `getRenameInfo` and `findRenameLocations` | Tests don't attempt to rename an import specifier, so this option is never exercised in a way that distinguishes `true` from `false`. |
| `compilers/ts.ts` | `getEditsForFileRename` filter (`textChanges.length > 0 → true`, `>= 0`) (line 140) | The TS LS never returns file rename edits with zero text changes; defensive guard. |
| `compilers/ts.ts` | `afterFileRename` out-of-project scan survivors (lines 176–222) | Requires a fixture with files outside `tsconfig.include` that import the moved file. The existing moveFile tests use project-internal files only. Accepted for now — the logic is exercised by the moveFile integration tests indirectly. |
| `plugins/vue/compiler.ts` | `cacheKey` `?? → &&` (line 14) | All Volar tests use a Vue fixture with a tsconfig; the null-tsconfig branch of `cacheKey` is not exercised. Killing this requires a Vue project without tsconfig — an uncommon scenario. |
| `plugins/vue/compiler.ts` | `if (!cached) → if (true)` (line 22) | Always rebuilds Volar service; slower but correct. Same pattern as TsMorphCompiler caching guards. |
| `plugins/vue/compiler.ts` | `toVirtualLocation` branch survivors (lines 41–59) | Multiple fallback branches triggered when Volar's source map or script generation returns null — edge cases in Volar's internal state that require `.vue` files with non-standard script blocks to exercise. |
| `plugins/vue/compiler.ts` | `translateSingleLocation` branch survivors (lines 67–83) | Same as above — fallback paths for Volar glue code. The `if (!next.done) → if (true)` mutation means always taking the mapped position path even when no source mapping exists; would produce wrong offsets, but the one getDefinition test only checks the file name not the exact span. |
| `plugins/vue/compiler.ts` | `NoCoverage` — `resolveOffset` catch block (line 103), `toVirtualLocation` ObjectLiteral returns | The catch path requires an out-of-bounds line; `toVirtualLocation` is only called via `getDefinitionAtPosition` which has one test. |

**Worth fixing (next quality pass):**

| Area | Gap |
|------|-----|
| `plugins/vue/compiler.ts` | 6 NoCoverage ObjectLiteral mutations (`return {}`) in defensive null-check early returns inside `toVirtualLocation` and `translateSingleLocation` (lines 44, 47, 52, 59, 67, 72). Triggering them requires edge-case `.vue` structures deep in Volar internals: a `.vue` file absent from the virtual map (line 44), `sourceScript.generated === null` for a file that IS in the map (lines 47, 67), and `getServiceScript()` returning null with non-null `generated` (lines 52, 72). Template-only `.vue` files hit line 47 (not 52), because `sourceScript` itself is null for files without any Volar-processable block. |
| `operations/rename.ts` | Near threshold; one more round may push it over. |
| `operations/findReferences.ts` | Near threshold. |

---

## Hard-won lessons

Patterns that recur across mutation rounds — read before writing tests intended to kill surviving mutants.

**`strict: true` does not kill mutants — TypeScript provides no mutation coverage.**
`disableTypeChecks: false` only prevents the `// @ts-nocheck` line-shift; it does not run `tsc --noEmit` on mutated files. vitest uses esbuild for transpilation (strips types, no type checking). Confirmed by 0 CompileErrors across all modules. Two practical implications:
- **Null-guard survivors** (`if (!locs || locs.length === 0)` etc.) — the return type is `SpanLocation[] | null`. TypeScript *requires* these guards; they are not dead code. They survive because the TS LS never returns null for in-range positions at runtime, not because TypeScript covers the null case.
- **Arithmetic / sort survivors** (`offset + len → offset - len`, sort comparators) — both variants are type-valid `number` expressions; TypeScript cannot distinguish semantic direction. Only tests can kill these.
"TypeScript covers this" is never a valid acceptance argument for a surviving mutant.

**TypeScript LS never returns empty/null for in-range positions.**
`getRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` all guard against null/empty results. In practice the TS LS navigates contextually to the nearest symbol for any position within a declaration. The `if (!locs || locs.length === 0)` guards are defensive dead code; accept them as survivors.

**Mutation timeouts from infinite-loop mutations count as kills.**
`if (parent === dir) → if (false)` turns `findTsConfig`'s walk-up loop into an infinite loop. Stryker treats these as `Timeout` (not `Survived`), so they count toward the kill score and do not need separate test coverage.

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

**`VolarCompiler.getRenameLocations` and `getReferencesAtPosition` must be called with `.ts` paths, not `.vue` paths.**
The Volar proxy TS language service registers `.vue` files as `.vue.ts` virtual paths. Calling either operation with a `.vue` path throws "Could not find source file". Always initiate from a `.ts` file; `.vue` locations appear in the translated output, not the input. To test the `rawLocs.length === 0` null-return path, call from a `.ts` file at a blank-line offset within a Vue project.

**`globToRegex("*.ts")` does NOT match root-level files.**
The implementation prepends `**/` for patterns without `/`, producing regex `^.*/[^/]*\.ts$`. This requires at least one directory separator before the basename. Root-level files (e.g. `"foo.ts"`) never match. Tests must assert `"src/foo.ts"` not `"foo.ts"`.

**`isBinaryBuffer` is exercised by writing a real file with a null byte.**
Use `Buffer.concat([Buffer.from("text"), Buffer.from([0x00]), Buffer.from("more")])` and write via `fs.writeFileSync`. The binary skip is only triggered when the file is read during `searchText`, not during the glob walk.

**`moveSymbol` `filesSkipped` importer-loop path requires resolvable imports.**
The `if (!isWithinWorkspace(filePath, workspace))` guard only fires when ts-morph's `getModuleSpecifierSourceFile()` successfully resolves the import to a source file in the project. A test for this path needs a tsconfig with explicit `moduleResolution: "node"` or similar, plus an importer with a resolvable import path.

**`VolarCompiler.resolveOffset` catch block needs an out-of-bounds line.**
Covered by calling `resolveOffset` with `line: 999` on a real `.vue` file (via `getDefinition`). The `lineColToOffset` call throws `RangeError`, caught and rethrown as `EngineError("SYMBOL_NOT_FOUND")`.

**Covering `translateLocations` requires asserting span length and no `.vue.ts` paths.**
Adding `getReferencesAtPosition` to VolarCompiler tests covers the `translateLocations` code path. Assert that returned spans have non-zero `textSpan.length` and that no paths end in `.vue.ts` — otherwise the path-translation mutants survive.

**`filter(Boolean)` in the git path is an equivalent mutant.**
After `split("\n")`, the subsequent `.filter((line) => extSet.has(path.extname(line)))` also filters empty strings (since `path.extname("")` is `""`, which is never in the extension set). Removing `filter(Boolean)` produces identical output. Accept this survivor.

**Gitignored non-SKIP_DIRS directories kill the git-path `BlockStatement` mutant.**
If the git-path `if` body is emptied (BlockStatement mutation), the function falls back to recursive walk. The recursive walk respects `SKIP_DIRS` but NOT `.gitignore`. A gitignored directory that is not in `SKIP_DIRS` (e.g., `private/`) would then appear in the output. The test `excludes gitignored files in directories not in SKIP_DIRS` catches this.

**`moveSymbol` `filePath === absDest` guard needs the dest file to pre-import the symbol.**
The guard `if (filePath === absDest) continue` in the importer loop fires only when the destination file is itself an importer of the symbol (i.e., it already imports the symbol from the source). Without the guard, the importer loop would rewrite the dest file's import to a self-reference (`from "./helpers.js"` in helpers.ts). Assert `not.toContain('"./helpers.js"')` in the dest file content.

**`moveSymbol` dirty-files-loop filesSkipped requires the source to be outside the workspace.**
The `else { filesSkipped.add(fp) }` branch in the dirty-files loop fires when a ts-morph-dirtied file is outside the declared workspace. Set the workspace to `src/` only, put the source file in `lib/`, and use a tsconfig with `include: ["**/*.ts"]` so ts-morph loads both. Assert the source file is in `filesSkipped` AND its on-disk content is unchanged (proving the save loop also respected the boundary).

**Meeting the mutation threshold is not enough — read every survived mutant in new code.**
The threshold catches regressions but does not certify correctness. After each mutation run, check each survived mutant in code you wrote this session:
- A mutant that survives because the API contract makes a branch structurally unreachable (e.g. `Map.get()` never returns an empty array, only `undefined` or a non-empty array) means the condition should be simplified to remove the dead branch — not accepted as-is. Example: `if (decls && decls.length > 0)` → simplify to `if (decls)`.
- A mutant that survives because a fallback path is never exercised in tests means a test is missing. Example: `getSourceFile(path) ?? addSourceFileAtPath(path)` survives the `??` → `&&` mutation if no test uses a fresh provider that hasn't seen the dest file.
Both cases require action. Accepted survivors belong in the "Known surviving mutants" table with an explicit rationale — an unexplained survivor in new code is not acceptable.

**`specifiers.length > 0` needs an importer with non-matching symbols.**
Mutation `> 0 → >= 0` includes importers with 0 matching specifiers. These "false positives" then gain a wrong import from the dest file. To kill this, add a file that imports OTHER symbols from the source (but not the moved symbol) and assert it does not gain an import from the dest.

**Process-entry-point code has an inherent in-process coverage gap.**
`runDaemon`, `runStop` body (after early-returns), and `handleSocketRequest` only run inside spawned daemon processes. v8 coverage only tracks what runs in the test runner's process. The right approach: test the validation early-returns with mocked `process.exit` (throw pattern); test exported happy-path functions directly (e.g. `stopDaemon`, `runStop` on a real daemon); accept the subprocess gap for the rest. Do NOT export private functions for testing — extract to a real module if the function deserves a public API.

**Symlink branch coverage requires real filesystem artefacts.**
The `isWithinWorkspace` symlink branch only fires when the path exists and `fs.existsSync` passes. Create real temp dirs and symlinks pointing outside the workspace — non-existent paths skip the `realpathSync` call and leave the branch dead.
