**Purpose:** Technical gotchas, hard-won lessons, and non-obvious architectural decisions.
**Audience:** Engineers and AI agents implementing features or debugging issues.
**Status:** Current
**Related docs:** [Handoff](handoff.md) (current state + roadmap), [Architecture](architecture.md) (provider/operation architecture), [Quality](quality.md) (test lessons), [Tech Debt](tech/tech-debt.md) (known issues)

---

# Agent Memory

Durable notes for AI agents working on this project. Update when sessions surface new gotchas or decisions.

---

## Technical gotchas

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

**Test helpers are split into three files by concern.**
`tests/helpers.ts` — fixture I/O only (`copyFixture`, `cleanup`, `readFile`, `fileExists`, `PROJECT_ROOT`). `tests/process-helpers.ts` — CLI spawn and daemon helpers (`spawnAndWaitForReady`, `waitForDaemon`, `killDaemon`, `callDaemonSocket`, `runCliCommand`). `tests/mcp-helpers.ts` — MCP client (`McpTestClient`, `parseMcpResult`, `useMcpContext`). Import from the appropriate module; `mcp-helpers` imports from both others.

---

## Architecture decisions

*(For the provider/operation/dispatcher architecture, see `docs/architecture.md`. Entries here cover things not in that doc.)*

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
Both the daemon (ping handler) and `mcp.ts` (`ensureDaemon`) import it from there. `ensureDaemon` uses a `versionVerified` module-level flag so the ping check runs only once per daemon process lifetime. Reset the flag whenever the daemon is detected as dead so the next spawn is re-verified.

**`stopDaemon` is the canonical way to kill a daemon from `mcp.ts`.**
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

**Do not record test-run scores in docs — they go stale immediately.**
Tracking per-module mutation scores in `docs/quality.md` caused real harm: a doc-update commit copied stale round-3 numbers (80.46%) into the round-4 section, then a rebase conflict resolver chose the "newer" (wrong) main-branch version, silently discarding the actual round-4 result (76.80%). The `break` threshold in `stryker.config.mjs` is the only authoritative, machine-verified floor. Everything else belongs to the "Worth fixing" and "Accepted survivors" sections, which describe *why* a gap exists and *how* to fix it — information that doesn't go stale between runs.

---

## Memory storage

- `.claude/MEMORY.md` — project state and agent behaviour notes
- `docs/agent-memory.md` — this file; technical gotchas and decisions useful to humans
- `~/.claude/` — ephemeral, wiped on container rebuild; do not use
