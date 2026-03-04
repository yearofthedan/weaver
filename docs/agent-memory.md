**Purpose:** Technical gotchas, hard-won lessons, and non-obvious architectural decisions.
**Audience:** Engineers and AI agents implementing features or debugging issues.
**Status:** Current
**Related docs:** [Handoff](handoff.md) (current state + roadmap), [Architecture](architecture.md) (provider/operation architecture), [Quality](quality.md) (test lessons), [Tech Debt](tech/tech-debt.md) (known issues)

---

# Agent Memory

Durable notes for AI agents working on this project. Update when sessions surface new gotchas or decisions.

---

## Technical gotchas

**Stryker JSON reporter must be explicitly enabled — it is not on by default.**
The Stryker config only listed `html`, `clear-text`, and `progress` reporters initially. The `json` reporter (required for the `/mutate-triage` skill to parse structured output) must be added to `reporters` and configured via `jsonReporter.fileName`. Added in the mutation-triage-ci slice.

**`anthropics/claude-code-action@v1` uses `claude_args` for CLI flags, not separate action inputs.**
Model selection (`--model`), tool allowlist (`--allowedTools`), and turn limit (`--max-turns`) are all passed via the single `claude_args` string. Use YAML block scalar (`>-`) to split across lines cleanly. The `GH_TOKEN` needed for `gh` commands is provided automatically by the action — no separate secret needed.

**The `/mutate-triage` skill extends the existing `quality-feedback.yml` — there is no separate `mutation.yml`.**
Spec originally named the target file `mutation.yml`, but the mutation test setup already existed in `quality-feedback.yml`. Extending the existing workflow avoids duplicating checkout/install/build steps. Noted in spec archive.

**`docs/architecture.md` replaced `docs/features/engines.md`.**
The architecture reference was renamed for clarity. Update links/searches that still point to `features/engines.md`.

**Keep committed `.mcp.json` path-portable; put machine-local paths in user-level config.**
Hardcoded workspace roots in repo config (for example `/workspace/...` or `/workspaces/...`) break MCP startup on other hosts. Keep the committed config root-relative (for example `--workspace .`), and store machine-specific absolute-path overrides in user-level MCP settings (`claude mcp add ...`) rather than version-controlled files.

**Use `pnpm agent:check` for policy and `pnpm agent:doctor` for runtime setup checks.**
`agent:check` is a static conventions check (safe for CI): validates committed MCP config shape and portability policy. `agent:doctor` is a local runtime liveness check (spawn + initialize + tools/list) and should be run during environment setup/debugging, not on every push.

**`child.pid` is the tsx wrapper PID, not the script's PID.**
When you spawn a process with `spawn('tsx', ...)`, `child.pid` is the PID of the tsx wrapper, not `process.pid` inside the script. To check if a lockfile PID is alive, use `process.kill(pid, 0)` — don't compare to `child.pid`.

**Invalidate the engine cache after `moveFile`.**
ts-morph and Volar both cache project state. After calling `moveFile`, the old path may still resolve from cache, causing move-back (rename to original name) to fail. Explicitly invalidate/refresh the project after a move.

**MCP server must start before the daemon auto-spawns.**
In `serve`, bring the MCP server up before triggering daemon auto-spawn. If the daemon starts first and the socket connect happens before the MCP server is listening, the call times out.

**Test race: daemon socket not yet open when test connects.**
After spawning the daemon process, the socket file may not exist yet. Use `waitForDaemon` (or equivalent retry logic) before sending the first socket request in tests.

**`@volar/language-core` version skew requires a pnpm override.**
`@vue/language-core` and `@volar/typescript` can depend on different patch versions of `@volar/language-core`, making `Language<string>` a different nominal type in each. Fix with a `pnpm.overrides` entry in `package.json` pinning to the same version. Also add `@volar/language-core` as a direct `devDependency` so TypeScript can resolve the `import type { Language }` in `volar.ts`.

**`pnpm format` does not fix import ordering.**
`pnpm format` runs `biome format --write`, which fixes whitespace/style but not `organizeImports` assists. To fix everything in one pass, run `pnpm exec biome check --write .`.

**`dist/` and other build dirs must be excluded from `readDirectory`.**
The Vue service calls `ts.sys.readDirectory()` to find `.vue` files. Without filtering, it picks up files under `dist/`, `node_modules/`, etc., which breaks type resolution. `SKIP_DIRS` is exported from `src/utils/file-walk.ts` and applied in `buildVolarService()`.

**`VolarProvider.getDefinitionAtPosition` requires explicit `.vue` → `.vue.ts` translation.**
Unlike `findRenameLocations` and `getReferencesAtPosition`, Volar's proxy for `getDefinitionAtPosition` does NOT auto-translate real `.vue` paths to their virtual `.vue.ts` equivalents before calling TypeScript's internal implementation. Calling with a `.vue` path throws `Could not find source file: App.vue`. Fix: call `toVirtualLocation` first to map the path and position into the virtual coordinate space, then call `getDefinitionAtPosition` with the translated values. Results still go through `translateLocations` for the `.vue.ts` → `.vue` reverse mapping. Any future read-only operation that hits the same error needs this treatment.

**`walkFiles` is the single file-collection entry point.**
`src/utils/file-walk.ts` exports `walkFiles(dir, extensions)` and `SKIP_DIRS`. In git workspaces it shells out to `git ls-files --cached --others --exclude-standard` — respects gitignore by construction, no skip-list to maintain. Falls back to a recursive readdir walk using `SKIP_DIRS` for non-git workspaces. Both the `moveFile` operation (post-scan) and `vue-scan.ts` (`updateVueImportsAfterMove`) call `walkFiles`.

**`moveFile` uses the language service directly, not `sourceFile.move()`.**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Use `ls.getEditsForFileRename()` instead to get per-file control before any disk write, then apply edits manually and call `fs.renameSync`. After the operation, call `invalidateProject()` to discard stale in-memory state.

**Engine output (collateral writes) must also be boundary-checked.**
The TS language service computes impacted files from the project graph (via tsconfig `include`). These may extend outside the workspace. Check each file against the workspace boundary before writing. Skip out-of-workspace files and return them in `filesSkipped` — do not throw, because the caller cannot know the impacted set in advance and a throw mid-write leaves partial state.

**`isWithinWorkspace` and `isSensitiveFile` are both in `src/security.ts`.**
`isWithinWorkspace` is used at both the daemon dispatcher (input validation) and the operation layer (output filtering). Resolves symlinks via `fs.realpathSync` for existing paths to prevent symlink escape.
`isSensitiveFile` is called by `searchText` (silently skips) and `replaceText` surgical mode (throws `SENSITIVE_FILE` before touching any file).

**`globToRegex` splits on `**` before replacing `*`.**
Naive single-pass replacement (`**` → placeholder → `.*`, `*` → `[^/]*`) requires a control character placeholder, which Biome rejects. Instead, split the pattern string on `**`, convert each part independently, then join with `.*`. This avoids any placeholder characters and is cleaner.

**`replaceText` surgical mode sorts edits descending before applying.**
Multiple edits to the same file must be applied last-position-first so that byte offsets of earlier edits remain valid after each write. Sort by `(line DESC, col DESC)` before the loop.

**`newName` regex must be enforced at the MCP layer too.**
`schema.ts` had the identifier regex but `mcp.ts` previously only had `z.string()`. MCP input validation and schema.ts must stay consistent — check both when changing validation rules.

**`VolarProvider.getRenameLocations` / `getReferencesAtPosition` require `.ts` file paths, not `.vue` paths.**
The Volar proxy TS language service registers `.vue` files as `.vue.ts` virtual paths internally. Calling `findRenameLocations` or `getReferencesAtPosition` with a `.vue` path throws "Could not find source file: X.vue". Both operations must be initiated from a `.ts` file; `.vue` results in the output are then translated via `translateLocations`. Only `getDefinitionAtPosition` requires explicit `.vue` → `.vue.ts` translation on input (via `toVirtualLocation`) because Volar doesn't auto-translate it.

**Template-only `.vue` files (no `<script>` block) exercise `toVirtualLocation` fallback branches.**
A `.vue` file with only a `<template>` block has `sourceScript.generated.languagePlugin.typescript?.getServiceScript()` return null (no TypeScript service script generated). This triggers the `if (!serviceScript) return { fileName: virtualPath, pos }` fallback in `toVirtualLocation`. Useful for mutation testing coverage of those branches. Create via `fs.mkdtempSync` with a minimal tsconfig; the `buildVolarService` directory scan picks up all `.vue` files in the project root automatically.

**`getTypeErrorsForFiles` must call `refreshFromFileSystemSync()` before checking diagnostics.**
When post-write diagnostics run against a file that the TsProvider project already has cached (e.g. from a previous operation in the same daemon lifetime), ts-morph will see stale content unless `refreshFromFileSystemSync()` is called first. `getTypeErrorsForFiles` always does this. For fresh TsProvider instances (new projects loaded for the first time), the file is read directly from disk and no refresh is needed — but calling `refreshFromFileSystemSync()` on a newly-added source file is a safe no-op.

**Stryker run scoped to a single file: use `--mutate` flag.**
`stryker run --mutate 'src/operations/getTypeErrors.ts'` overrides the `mutate` array from the config and runs mutation tests only for that file. Useful when you want to check mutation score for touched files without running the full suite. The `--testFiles` equivalent is runner-specific; for vitest, the config-level `testFiles` filter is the only supported path.

**`getTypeErrors` uses `TsProvider` directly, not `LanguageProvider`.**
Vue SFC diagnostics via Volar are deferred (handoff P4 item 16). The operation signature takes `TsProvider` instead of the generic `LanguageProvider` interface. The dispatcher calls `registry.tsProvider()` (always returns `TsProvider`, even in Vue projects). This matches the pattern used by `moveSymbol`.

**ts-morph bundles its own TypeScript instance; use `{ ts }` from `ts-morph`, not `import * as ts from "typescript"`.**
`project.getLanguageService().compilerObject` returns TypeScript objects typed against ts-morph's bundled TypeScript (`@ts-morph/common`). If you import `typescript` directly and annotate with its types, TypeScript rejects the assignment: `SyntaxKind.SourceFile` from one instance is not assignable to the other. Use `import { ts } from "ts-morph"` for any types that touch the compiler object's return values. The standalone `typescript` import is fine for utilities that don't touch ts-morph project objects (e.g. `ts.sys.readDirectory` in `ts-project.ts`).

**`TsProvider.getProjectForDirectory(dir)` vs `getProjectForFile(file)` — the difference is `findTsConfig(dir)` vs `findTsConfigForFile(file)`.**
`findTsConfigForFile` walks up from `path.dirname(file)`, so passing a directory path gives the parent's config (wrong). `getProjectForDirectory` calls `findTsConfig(dir)` directly, which starts from the directory itself. Use `getProjectForDirectory` whenever you have a workspace root, not a specific file.

**Test helpers are split into three files by concern.**
`tests/helpers.ts` — fixture I/O only (`copyFixture`, `cleanup`, `readFile`, `fileExists`, `PROJECT_ROOT`). `tests/process-helpers.ts` — CLI spawn and daemon helpers (`spawnAndWaitForReady`, `waitForDaemon`, `killDaemon`, `callDaemonSocket`, `runCliCommand`). `tests/mcp-helpers.ts` — MCP client (`McpTestClient`, `parseMcpResult`, `useMcpContext`). Import from the appropriate module; `mcp-helpers` imports from both others.

---

## Architecture decisions

*(For the provider/operation/dispatcher architecture, see `docs/architecture.md`. Entries here cover things not in that doc.)*

**Do not jump from architecture discussion straight to spec without consent.**
For non-trivial design discussions, stay in advice mode unless the user asks for
a spec (or confirms moving to implementation workflow). When requested, create a
changeset spec under `docs/specs/` and add a linked `docs/handoff.md` entry.
Keep acceptance criteria in specs, not in `docs/features/*` reference docs.

**MCP tool names and daemon method names are intentionally 1:1.**
The MCP handler passes `tool.name` directly as the daemon method. There is no translation layer. A proposal to split naming (e.g. "file rename" vs "symbol rename") was rejected: the daemon is an internal IPC detail with no independent users, and "file rename" is already `moveFile`. Splitting would add a translation table for no benefit.

**`VolarProvider.translateLocations` is the shared virtual→real mapping helper.**
Extracted from the inline loop in `rename`; reused by `findReferences` and `getDefinition`. Any future operation that reads positions from a Vue project should call this method rather than duplicating the source-map traversal.

**SDK wire format is newline-delimited JSON, not Content-Length framed.**
`StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` in `tests/mcp-helpers.ts` must match this format.

**SDK is Zod v3/v4 agnostic.**
The SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool` — no version conflict.

**Daemon socket: one connection per call.**
`serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, then closes. No persistent connection.

**`ping` is a meta-operation handled before `dispatchRequest`.**
`handleSocketRequest` in `daemon.ts` intercepts `method === "ping"` before calling `dispatchRequest`, returning `{ ok: true, version: PROTOCOL_VERSION }` directly. This avoids adding `ping` to the `OPERATIONS` table and keeps the dispatcher clean of protocol-level concerns.

**`PROTOCOL_VERSION` lives in `daemon.ts`; increment it whenever the operation set changes.**
Both the daemon (ping handler) and `ensure-daemon.ts` (`ensureDaemon`) import it from there. `ensureDaemon` uses a `versionVerified` module-level flag so the ping check runs only once per daemon process lifetime. Reset the flag whenever the daemon is detected as dead so the next spawn is re-verified.

**`mockReturnValue` vs `mockImplementation` for fake child processes with async gaps.**
If the code under test calls an async operation (e.g. a socket ping) before calling `spawn`, the fake child returned by `mockReturnValue(makeFakeChild())` will have its `setTimeout(0)` fire *before* `child.stderr.on("data", ...)` is registered — the ready event is missed and `spawnDaemon` times out. Fix: use `mockImplementation(() => makeFakeChild())` so the child (and its timer) is created at the moment `spawn` is called, not at test-setup time. Rule of thumb: whenever there is an `await` between calling `mockReturnValue` and the code that sets up event listeners on the returned object, use `mockImplementation` instead.

**`vi.resetModules()` + dynamic `import()` in `beforeEach` is the correct pattern for module-level state reset.**
`ensure-daemon.ts` (and similar modules) use a module-level `let versionVerified = false`. Tests that exercise the "already verified" path require controlling this flag between test cases. The correct approach: call `vi.resetModules()` in `beforeEach`, then `const mod = await import("...")` to get a fresh module instance. Registered `vi.mock()` factories remain active after `vi.resetModules()` (mock registry is separate from module instance cache), so mocked dependencies continue to work. Do NOT export the flag for testing — that is the antipattern this pattern replaces.

**`stopDaemon` is the canonical way to kill a daemon from `ensure-daemon.ts`.**
Exported from `daemon.ts`. Reads the lockfile PID, sends SIGTERM, polls until `isDaemonAlive` returns false (up to 5s), then calls `removeDaemonFiles`. Avoids duplicating the kill-and-wait logic from `runStop`.

**Process-entry-point coverage gap is inherent, not a test gap.**
`runDaemon`, `runStop` body (after the early-returns), and `handleSocketRequest` all run inside spawned daemon processes. Coverage only tracks what runs in the test runner's process, so these lines will always show as uncovered in unit tests — the existing integration tests (which spawn subprocesses) exercise them correctly. Don't export private functions to reach them; that's an antipattern. Instead: (a) test the early-return validation paths directly by mocking `process.exit` to throw; (b) test the happy path for fully exported functions like `stopDaemon` and `runStop` (the happy path never calls `process.exit` so no mocking needed); (c) extract genuinely reusable logic into a proper module.

**Mocking `process.exit` — use the throw pattern.**
`vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("EXIT"); }) as () => never)` is the standard pattern for testing code that calls `process.exit` on failure. The throw stops execution at the point the real exit would have, keeping the test hermetic. Always restore with `vi.restoreAllMocks()` in `afterEach`. For paths that do NOT call `process.exit` (happy paths), no mock is needed — await the function directly.

**`callDaemon` failure returns `DAEMON_STARTING`.**
If the socket connection fails (daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent rather than throwing.

**MCP server `instructions` field for tool adoption.**
The `McpServer` constructor takes an optional `instructions` string (part of the MCP spec's `InitializeResult`). Clients like Cursor and Claude Desktop surface this as a system prompt hint. Keep it short — it's injected on every turn alongside all tool descriptions. Per-tool trigger guidance ("when to use this") belongs in individual tool descriptions, not here.

**Tool descriptions should lead with triggers, not capabilities.**
"Before modifying a symbol, call this" is more effective than "Find all references to a symbol" because it matches the agent's situation at the point of decision. Avoid naming specific agent tools (grep, shell mv, search-and-replace) — frame the consequence of not using the tool instead ("leaves broken imports", "text search would find the re-export, not the actual definition").

**Feature specs must describe each output field's content and bounds, not just its type.**
For fields that wrap compiler or external-API output, "string" as a type is not enough. The spec must state: what the string contains, whether it is bounded (and if so, how), and at least one example. This is especially important for fields that could balloon (e.g. message text from a `DiagnosticMessageChain`) — the spec is where the "top-level node only" decision is recorded and justified, so implementors don't rediscover the question mid-implementation. When writing ACs for a new operation, walk each output field and ask: "could this be unbounded? what does it actually contain?" If the answer isn't obvious, probe the API first.

**Test comments must add meaning the test name doesn't already provide — otherwise delete them.**
Pre-`it` block comments that restate the test name (e.g. `// Guard: when nothing is written…` before `it("produces no typeErrors fields when no files are modified")`) are noise. Inline param comments that state what the code already shows (e.g. `// checkTypeErrors omitted — default is on` next to an absent field) are noise. Comments that go stale with the code they describe are worse than no comment. Only write a comment when it explains something that cannot be inferred from the surrounding code and test name.

**`checkTypeErrors` defaults to ON — the guard is `!== false`, not `=== true`.**
Write operations (`rename`, `moveFile`, `moveSymbol`, `replaceText`) run post-write type diagnostics by default. The `checkTypeErrors` param is `true` unless explicitly set to `false`. Rationale: the primary users are AI coding agents who need immediate compiler feedback after every write and will not know to opt in. `checkTypeErrors: false` is the explicit opt-out for callers that want to skip the check (e.g. batch operations where the agent will call `getTypeErrors` separately). Do not flip the guard back to `=== true` without understanding this user-profile decision.

**Do not record test-run scores in docs — they go stale immediately.**
Tracking per-module mutation scores in `docs/quality.md` caused real harm: a doc-update commit copied stale round-3 numbers (80.46%) into the round-4 section, then a rebase conflict resolver chose the "newer" (wrong) main-branch version, silently discarding the actual round-4 result (76.80%). The `break` threshold in `stryker.config.mjs` is the only authoritative, machine-verified floor. Everything else belongs to the "Worth fixing" and "Accepted survivors" sections, which describe *why* a gap exists and *how* to fix it — information that doesn't go stale between runs.

**PromptFoo eval step-2 tests use a JSON messages array in `vars.task`, not a plain string.**
When `vars.task` renders to a valid JSON array, promptfoo submits it as a full conversation history (multi-turn). Use this for two-step eval tests: seed step-1's tool call and fixture response, then assert step-2 tool selection. The fixture JSON in `tool_result` must match the corresponding `eval/fixtures/{method}.json` so the model sees realistic output to act on. If `task` is a plain string, promptfoo wraps it in a single user message (single-turn).

**`tool-call-f1` penalises extra tool calls — an F1 of 0.67 fails the 0.8 threshold.**
`tool-call-f1` measures precision × recall. If the expected set is `[rename]` but the model calls `[searchText, rename]`, precision = 0.5, recall = 1.0, F1 = 0.67 — a test failure. When a model adds a sensible-but-unexpected precursor call, either (a) add the precursor to the expected set, or (b) split into two tests (step-1 asserts precursor, step-2 seeds the result and asserts the action). Don't set thresholds below 0.8 to paper over the mismatch — fix the expected set or the tool description.

**`--filter-pattern` for single eval tests: call the runner directly, not via `pnpm eval`.**
Use `node_modules/.bin/tsx eval/run-eval.ts --filter-pattern "test name"`. Do NOT use `pnpm eval -- --filter-pattern` — pnpm intercepts `eval` as a built-in subcommand and errors with "too many arguments". The `pnpm run eval` form works for a full run only.

**PromptFoo requires `better-sqlite3` native bindings — build scripts are blocked by default in this dev container.**
`pnpm install` silently ignores build scripts for `better-sqlite3`. After installing promptfoo, run `node /home/user/light-bridge/node_modules/.pnpm/prebuild-install@7.1.3/node_modules/prebuild-install/bin.js` from the project root to download the pre-built binary. Without this step, `promptfoo --version` fails with "Could not locate the bindings file". Add to container setup docs if adding more native dependencies.

**`pnpm eval` conflicts with pnpm's built-in `eval` subcommand — use `pnpm run eval` instead.**
`pnpm eval` is intercepted by pnpm itself and never reaches the npm script. Use `pnpm run eval` to invoke the eval entry point (`tsx eval/run-eval.ts`).

**Fixture server must write the lockfile in-process, not as a subprocess.**
The real daemon writes `{ pid: process.pid, ... }` to the lockfile. The fixture server impersonates the daemon from within the `run-eval.ts` process, so `process.pid` in the lockfile is `run-eval.ts`'s own PID. `isDaemonAlive` calls `process.kill(pid, 0)` — the `run-eval.ts` process is alive while promptfoo runs, so this returns true. Never spawn the fixture server as a detached subprocess unless you also update the lockfile PID and manage the subprocess lifecycle.

**PromptFoo MCP provider config key is `mcp.server`, not `mcp.servers`.**
When configuring a single MCP server, use `mcp.server: { command, args, name }`. Using `mcp.servers` (plural) is a different config shape for multiple servers — mixing the two silently fails to connect.

**Evaluate "does this update call sites?" before speccing any write operation.**
The high-value operations (`moveSymbol`, `moveFile`, `rename`) all share one property: they update every reference project-wide. A refactoring that extracts/moves code but can't rewrite callers always leaves broken code — the agent still has to fix call sites manually, which it could have done with `searchText` + `replaceText` in the first place. Before speccing a new write operation, ask: "does this do something the agent can't chain together from existing tools?" If the answer is "it saves AST extraction but leaves broken callers," the value is probably too low to justify the implementation.

**`extractFunction`: `endCol` must cover the last character of the last selected statement.**
TypeScript's `getApplicableRefactors` returns an empty array (no "Extract Symbol" refactor) when the selection's `end` offset falls before the end of the last statement in a multi-statement selection. For example, pointing `endCol` at `)` in `console.log(msg);` silently yields no refactors — it must point at the `;` (or the last token if the codebase uses no-semi style). This is a quirk of how the TS compiler considers a statement "selected". For single-statement selections the compiler is more lenient.

**`deleteFile` deletes the file AFTER writing all importer edits — never before.**
ts-morph's `getModuleSpecifierSourceFile()` needs the file present on disk to resolve module specifiers during the in-project scan. Deleting first would make Phase 1 blind to importers. The implementation follows: Phase 1 (in-project ts-morph scan) → Phase 2 (out-of-project walk) → Phase 3 (Vue SFC regex) → Phase 4 (physical delete) → Phase 5 (cache invalidation).

**ts-morph: re-query declarations after each `remove()` call on the same SourceFile.**
After calling `node.remove()`, sibling node references captured before the removal may be stale. Iterating `[...getImportDeclarations(), ...getExportDeclarations()]`, calling `remove()` on the first match, then `break`-ing and re-querying is the safe pattern. O(n²) per file, but safe; import counts per file are small.

**`deleteFile` out-of-project scan uses manual path resolution, not `getModuleSpecifierSourceFile()`.**
In a per-file in-memory ts-morph project, the target file isn't in the project graph, so `getModuleSpecifierSourceFile()` always returns `undefined`. Instead: `stripExt(path.resolve(fromDir, specifier)) === targetNoExt`. This correctly handles bare specifiers (`'./foo'`), `.ts`, `.js`, `.tsx`, `.jsx` extensions.

---

**`ts-project.ts` module-level caches survive across tests — use unique `mkdtempSync` paths per test.**
`findTsConfig` and `isVueProject` store results in module-level `Map`s that persist for the process lifetime. Tests that exercise the cache must use unique temporary directories (from `fs.mkdtempSync`) so earlier test runs don't pre-populate the cache for later ones. To test that the cache is *used*, mutate the filesystem between the two calls (delete the tsconfig or `.vue` file after the first call) — the second call should still return the cached value.

**Mutation timeouts from infinite-loop mutations are counted as kills.**
`if (parent === dir) → if (false)` turns `findTsConfig`'s walk-up loop into an infinite loop. Stryker treats these as `Timeout` (not `Survived`), so they count toward the kill score and do not need separate test coverage.

**`src/cli.ts` is excluded from mutation testing — use subprocess integration tests instead.**
`cli.ts` is declared as a declarative entry-point with no logic to mutate in `stryker.config.mjs`. CLI behaviour changes (like making `--workspace` optional) are covered by integration tests that spawn the actual process (`spawnAndWaitForReady` / `runCliCommand` with a `cwd` option). Those tests cannot run inside Stryker's sandbox (no subprocess spawning), so there is no mutation coverage for `cli.ts` — that's intentional and accepted.

**`spawnAndWaitForReady` and `runCliCommand` accept a `cwd` option.**
Pass `{ cwd: dir }` to spawn the CLI process with a different working directory. Required when testing the `--workspace` default (which falls back to `process.cwd()`).

**`moveFile` updates import paths but not test file imports when test files are outside `tsconfig.include`.**
After moving a test file with `moveFile`, always check the type errors in the tool response — the moved file's own imports will not be rewritten if it is outside the ts-morph project (which only includes `src/`). Fix them manually.

**Skill files ship in the npm package at `skills/` — update `package.json` `files` array when adding new ones.**
The `files` field controls what npm publishes. The `dist` and `skills` directories are both included. If a new skill file directory is added outside `skills/`, it won't ship unless `files` is updated. Skill files are markdown — no build step needed.

**Skill file tests are static content assertions, not unit tests of behaviour.**
The tests in `tests/scripts/skill-file.test.ts` verify file existence, packaging config, frontmatter format, tool name coverage, response-handling keyword presence, host-agnosticism, and dogfooding references. They're fast (~4ms) but brittle to exact wording. If the skill file is rewritten substantially, update the test assertions to match the new content rather than fighting them.

**`LanguagePlugin.supportsProject()` is project-level, not file-level.**
In a Vue project, even `.ts` file operations go through VolarProvider because Volar's language service sees `.vue` importers that ts-morph doesn't. The detection checks the project's tsconfig (does this project contain `.vue` files?), not the input file's extension. A file-level `supports(file)` would break this pattern — a `.ts` file rename would bypass Volar and miss `.vue` importer updates.

**`registry.tsProvider()` is not subject to plugin resolution — it always returns TsProvider.**
Operations like `moveSymbol`, `extractFunction`, and `deleteFile` need direct ts-morph AST access that framework-specific providers (Volar, future Svelte) can't offer. The `tsProvider()` accessor on `ProviderRegistry` bypasses the plugin registry entirely and returns the built-in TsProvider singleton. Don't route it through plugin resolution.

**Language plugin invalidation hooks must be error-isolated.**
`invalidateFile` and `invalidateAll` iterate all registered plugins. Each plugin's hook is wrapped in try/catch so a crash in one plugin (e.g. Volar service bug) doesn't prevent other plugins from refreshing their state. The TS provider is invalidated separately (before the plugin loop) since it's not a plugin.

---

## Memory storage

- `.claude/MEMORY.md` — project state and agent behaviour notes
- `docs/agent-memory.md` — this file; technical gotchas and decisions useful to humans
- `~/.claude/` — ephemeral, wiped on container rebuild; do not use
