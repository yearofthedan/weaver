**Purpose:** Technical gotchas, hard-won lessons, and architectural decisions useful to engineers and AI agents working on this project.
**Audience:** Engineers and AI agents implementing features or debugging issues.
**Status:** Current
**Related docs:** [Handoff](handoff.md) (roadmap), [Tech Debt](tech/tech-debt.md) (known issues), [MEMORY](../.claude/MEMORY.md) (quick state snapshot)

---

# Agent Memory

Durable notes for AI agents working on this project. Update when sessions surface new gotchas or decisions.

---

## Technical gotchas

**`child.pid` is the tsx wrapper PID, not the script's PID.**
When you spawn a process with `spawn('tsx', ...)`, `child.pid` is the PID of the tsx wrapper, not `process.pid` inside the script. To check if a lockfile PID is alive, use `process.kill(pid, 0)` — don't compare to `child.pid`.

**Invalidate the engine cache after `moveFile`.**
ts-morph and Volar both cache project state. After calling `moveFile`, the old path may still resolve from cache, causing move-back (rename to original name) to fail. Explicitly invalidate/refresh the project after a move.

**MCP server must start before the daemon auto-spawns.**
In `serve`, bring the MCP server up before triggering daemon auto-spawn. If the daemon starts first and the socket connect happens before the MCP server is listening, the call times out.

**Test race: daemon socket not yet open when test connects.**
After spawning the daemon process, the socket file may not exist yet. Use `waitForDaemon` (or equivalent retry logic) before sending the first socket request in tests.

**`@volar/language-core` version skew requires a pnpm override.**
`@vue/language-core` and `@volar/typescript` can depend on different patch versions of `@volar/language-core`, making `Language<string>` a different nominal type in each. Fix with a `pnpm.overrides` entry in `package.json` pinning to the same version. Also add `@volar/language-core` as a direct `devDependency` so TypeScript can resolve the `import type { Language }` in `vue-engine.ts`.

**`pnpm format` does not fix import ordering.**
`pnpm format` runs `biome format --write`, which fixes whitespace/style but not `organizeImports` assists. To fix everything in one pass, run `pnpm exec biome check --write .`.

**`dist/` and other build dirs must be excluded from `readDirectory`.**
The Vue engine calls `ts.sys.readDirectory()` to find `.vue` files. Without filtering, it picks up files under `dist/`, `node_modules/`, etc., which breaks type resolution. `SKIP_DIRS` is exported from `src/engines/file-walk.ts` and applied in `buildService()`.

**`VueEngine.getDefinitionAtPosition` requires explicit `.vue` → `.vue.ts` translation.**
Unlike `findRenameLocations` and `getReferencesAtPosition`, Volar's proxy for `getDefinitionAtPosition` does NOT auto-translate real `.vue` paths to their virtual `.vue.ts` equivalents before calling TypeScript's internal implementation. Calling with a `.vue` path throws `Could not find source file: App.vue`. Fix: call `toVirtualLocation(absPath, pos, language, vueVirtualToReal)` first to map the path and position into the virtual coordinate space, then call `getDefinitionAtPosition` with the translated values. Results still go through `translateLocations` for the `.vue.ts` → `.vue` reverse mapping. Any future read-only operation that hits the same error needs this treatment.

**`walkFiles` is the single file-collection entry point.**
`src/engines/file-walk.ts` exports `walkFiles(dir, extensions)` and `SKIP_DIRS`. In git workspaces it shells out to `git ls-files --cached --others --exclude-standard` — respects gitignore by construction, no skip-list to maintain. Falls back to a recursive readdir walk using `SKIP_DIRS` for non-git workspaces. Both `ts/engine.ts` (post-scan in `moveFile`) and `vue/scan.ts` (`updateVueImportsAfterMove`) call `walkFiles`.

**`ts-engine.moveFile` uses the language service directly, not `sourceFile.move()`.**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Use `ls.getEditsForFileRename()` instead to get per-file control before any disk write, then apply edits manually and call `fs.renameSync`. This is the same pattern vue-engine already used. After the operation, call `invalidateProject()` to discard stale in-memory state.

**Engine output (collateral writes) must also be boundary-checked.**
The TS language service computes impacted files from the project graph (via tsconfig `include`). These may extend outside the workspace. Check each file against the workspace boundary before writing. Skip out-of-workspace files and return them in `filesSkipped` — do not throw, because the caller cannot know the impacted set in advance and a throw mid-write leaves partial state.

**`isWithinWorkspace` is in `src/workspace.ts`.**
Used at both the daemon dispatcher (input validation) and the engine layer (output filtering). Resolves symlinks via `fs.realpathSync` for existing paths to prevent symlink escape. Returns `false` if `path.relative(workspace, abs)` starts with `..`.

**`newName` regex must be enforced at the MCP layer too.**
`schema.ts` had the identifier regex but `serve.ts` only had `z.string()`. MCP input validation and schema.ts must stay consistent — check both when changing validation rules.

**`applyTextEdits` is in `src/engines/text-utils.ts`.**
Shared by all action functions. Takes a source string and `readonly { span: { start, length }, newText }[]`, applies edits in descending offset order.

---

## Architecture decisions

**MCP transport uses `@modelcontextprotocol/sdk`.**
The agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`). The internal daemon↔serve socket uses plain newline-delimited JSON — no library needed.

**SDK wire format is newline-delimited JSON, not Content-Length framed.**
`StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` in `tests/helpers.ts` must match this format.

**SDK is Zod v3/v4 agnostic.**
The SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool` — no version conflict.

**Daemon socket: one connection per call.**
`serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, then closes. No persistent connection.

**`callDaemon` failure returns `DAEMON_STARTING`.**
If the socket connection fails (daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent rather than throwing.

**Vertical slice tests assert before and after.**
Always read fixture files before the operation to confirm original state, then assert both that the old string is gone and the new string is present. This catches false positives.

**Action-centric architecture — Phase 3 complete; no more engine classes.**
All five operations (rename, findReferences, getDefinition, moveFile, moveSymbol) are standalone functions in `src/engines/actions/`, each taking provider arguments rather than being methods on a class. `BaseEngine`, `TsEngine`, and `VueEngine` are all deleted. The dispatcher calls action functions directly after resolving providers via the registry. `moveSymbol` now works in Vue projects: ts-morph AST surgery handles `.ts` importers; `VolarProvider.afterSymbolMove` handles `.vue` SFC script-block importers via `updateVueNamedImportAfterSymbolMove` (surgical — only the moved symbol, unlike the path-level rewrite in `afterFileRename`). `TsProvider.getProjectForFile()` exposes the ts-morph `Project` to `moveSymbol` for direct AST access.

**`ProviderRegistry` lives in `src/engines/types.ts`.**
`ProviderRegistry` has two slots: `projectProvider()` (Volar for Vue projects, TsProvider otherwise) and `tsProvider()` (always TsProvider for AST operations). `makeRegistry(filePath)` factory is in `dispatcher.ts`; provider singletons (lazy-loaded, module-scoped) live alongside it.

**Do not introduce a `FileProvider` abstraction yet.**
The DIP argument (program to abstractions, not concretions) is valid in principle, but one implementation is just indirection. The signal to add it: a concrete second implementation (e.g. in-memory FS for unit tests) or real maintenance pain from scattered `fs` calls. The `RefactorEngine` interface is already the adapter pattern for the refactoring concern; that's sufficient for now. `rewriteImports` in `vue/scan.ts` is pure (string → string) and never needed FS anyway; `findVueFiles` is the only candidate and it has a natural home in `vue/scan.ts`.

**`moveSymbol` uses both providers: `tsProvider` for AST surgery, `projectProvider` for the post-step.**
`moveSymbol(tsProvider, projectProvider, ...)` separates concerns: ts-morph (`tsProvider`) finds and moves declarations, patches `.ts` importers via AST edits. The `projectProvider.afterSymbolMove(...)` hook handles files the TS language service doesn't see. For TS projects, `TsProvider.afterSymbolMove` is a no-op. For Vue projects, `VolarProvider.afterSymbolMove` runs `updateVueNamedImportAfterSymbolMove` to rewrite the specific named import in `.vue` SFC script blocks.

**Per-operation provider selection is the dispatcher model.**
Each OPERATIONS `invoke` calls `registry.projectProvider()` for compiler-aware operations (rename/moveFile/findReferences/getDefinition), and both `registry.tsProvider()` + `registry.projectProvider()` for `moveSymbol`.

**Dispatcher is engine-agnostic; use a command map, not per-engine dispatchers.**
`RefactorEngine` already abstracts over engine type — the dispatcher calls `engine.rename(...)` or `engine.moveFile(...)` without knowing which engine it has. Per-engine dispatchers (`VueDispatcher`, `TsDispatcher`) would leak engine knowledge into the dispatch layer. This is realised as an `OPERATIONS` descriptor table in `dispatcher.ts`: each entry owns `pathParams` (for workspace validation), `invoke`, and `format`. The first `pathParams` entry determines the engine.

**Data-driven MCP registration and dispatcher.**
`TOOLS` table in `mcp.ts` drives all `registerTool` calls. Each entry has `name`, `description`, and `inputSchema: ZodRawShape`. The loop handler passes `params as Record<string, unknown>` directly to `callDaemon` — no per-operation destructuring needed. `OPERATIONS` table in `dispatcher.ts` drives all dispatch: `pathParams` (first = engine selector) → workspace validation loop → `invoke` → `format`. Adding a new operation is now a single table entry in each file.

**Commit body explains WHY, not WHAT.**
Code diffs show what changed. The body should explain decisions and tradeoffs. Don't enumerate changed files or re-describe the diff. Split commits at logical boundaries; don't force a split when a single file spans two concerns.

---

## Key files

| File | Purpose |
|------|---------|
| `src/workspace.ts` | `isWithinWorkspace()` — shared boundary utility |
| `src/mcp.ts` | MCP server (connects to daemon) |
| `src/daemon/paths.ts` | Socket and lockfile path utilities |
| `src/daemon/daemon.ts` | Socket server; `isDaemonAlive` + `removeDaemonFiles` lifecycle fns |
| `src/daemon/dispatcher.ts` | `dispatchRequest`; `makeRegistry`; provider singletons; `invalidateFile`/`invalidateAll` |
| `src/daemon/watcher.ts` | `startWatcher(root, extensions, callbacks)`; chokidar + 200ms debounce |
| `src/engines/actions/rename.ts` | `rename(provider, filePath, line, col, newName, workspace)` |
| `src/engines/actions/findReferences.ts` | `findReferences(provider, filePath, line, col)` |
| `src/engines/actions/getDefinition.ts` | `getDefinition(provider, filePath, line, col)` |
| `src/engines/actions/moveFile.ts` | `moveFile(provider, oldPath, newPath, workspace)` |
| `src/engines/actions/moveSymbol.ts` | `moveSymbol(tsProvider, projectProvider, sourceFile, symbolName, destFile, workspace)` |
| `src/engines/file-walk.ts` | `walkFiles()`, `SKIP_DIRS`, `TS_EXTENSIONS`, `VUE_EXTENSIONS` |
| `src/engines/text-utils.ts` | `applyTextEdits()`, `offsetToLineCol()` — shared utilities |
| `src/engines/providers/ts.ts` | `TsProvider`: compiler calls via ts-morph Project; `refreshFile()` |
| `src/engines/providers/volar.ts` | `VolarProvider`: compiler calls via Volar proxy; virtual↔real translation; `afterSymbolMove` scans `.vue` files |
| `src/engines/ts/project.ts` | `findTsConfig`, `findTsConfigForFile`, `isVueProject` |
| `src/engines/vue/scan.ts` | `updateVueImportsAfterMove`, `updateVueNamedImportAfterSymbolMove` (regex scans for .vue SFC imports) |
| `src/engines/vue/service-builder.ts` | `buildVolarService()` — Volar service factory |
| `tests/helpers.ts` | `spawnAndWaitForReady`, `McpTestClient`, `killDaemon` |
| `tests/fixtures/cross-boundary/` | Fixture for testing cross-workspace boundary enforcement |
| `docs/security.md` | Threat model, controls, known limitations |
| `docs/tech/volar-v3.md` | How the Vue engine works — read before touching `vue/` files |
| `docs/tech/tech-debt.md` | Known structural issues in the engine layer |

---

## Reference documentation

Always check `package.json` for the installed version before reading docs — web docs may not match what's installed.

| Package | Docs | Notes |
|---------|------|-------|
| `ts-morph` | https://ts-morph.com/ | Generally tracks the release well |
| TypeScript compiler API | https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API | Raw TS API (used in vue-engine); wiki is thin — source in `node_modules/typescript/lib/typescript.d.ts` is more reliable |
| `@vue/language-core` / `@volar/typescript` | (no stable docs site) | Published docs lag releases significantly — read source in `node_modules/` directly |
| `@modelcontextprotocol/sdk` | https://modelcontextprotocol.io/ | Covers the protocol; for SDK-specific API read the package source |
| Biome | https://biomejs.dev/ | Covers CLI flags, config schema, rule list |

---

## Memory storage

- `.claude/MEMORY.md` — project state and agent behaviour notes
- `docs/agent-memory.md` — this file; technical gotchas and decisions useful to humans
- `~/.claude/` — ephemeral, wiped on container rebuild; do not use
