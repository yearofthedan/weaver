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
The Vue engine calls `ts.sys.readDirectory()` to find `.vue` files. Without filtering, it picks up files under `dist/`, `node_modules/`, etc., which breaks type resolution. `SKIP_DIRS` is exported from `vue-scan.ts` and applied in `buildService()`.

**`ts-engine.moveFile` uses the language service directly, not `sourceFile.move()`.**
`sourceFile.move()` + `project.save()` is an atomic API — it writes all dirty files with no per-file whitelist. Use `ls.getEditsForFileRename()` instead to get per-file control before any disk write, then apply edits manually and call `fs.renameSync`. This is the same pattern vue-engine already used. After the operation, call `invalidateProject()` to discard stale in-memory state.

**Engine output (collateral writes) must also be boundary-checked.**
The TS language service computes impacted files from the project graph (via tsconfig `include`). These may extend outside the workspace. Check each file against the workspace boundary before writing. Skip out-of-workspace files and return them in `filesSkipped` — do not throw, because the caller cannot know the impacted set in advance and a throw mid-write leaves partial state.

**`isWithinWorkspace` is in `src/daemon/workspace.ts`.**
Used at both the daemon dispatcher (input validation) and the engine layer (output filtering). Resolves symlinks via `fs.realpathSync` for existing paths to prevent symlink escape. Returns `false` if `path.relative(workspace, abs)` starts with `..`.

**`newName` regex must be enforced at the MCP layer too.**
`schema.ts` had the identifier regex but `serve.ts` only had `z.string()`. MCP input validation and schema.ts must stay consistent — check both when changing validation rules.

**`applyTextEdits` is in `src/engines/text-utils.ts`.**
Shared by both ts-engine and vue-engine. Takes a source string and `readonly { span: { start, length }, newText }[]`, applies edits in descending offset order.

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

**Do not introduce a `FileProvider` abstraction yet.**
The DIP argument (program to abstractions, not concretions) is valid in principle, but one implementation is just indirection. The signal to add it: a concrete second implementation (e.g. in-memory FS for unit tests) or real maintenance pain from scattered `fs` calls. The `RefactorEngine` interface is already the adapter pattern for the refactoring concern; that's sufficient for now. `rewriteImports` in `vue/scan.ts` is pure (string → string) and never needed FS anyway; `findVueFiles` is the only candidate and it has a natural home in `vue/scan.ts`.

**`moveSymbol` NOT_SUPPORTED in Vue projects is a router constraint, not a Volar limitation.**
`VueEngine.moveSymbol` throws `NOT_SUPPORTED` because the router routes all Vue-project files to `VueEngine`, and Volar has no "extract declaration" API. But `moveSymbol` doesn't need Volar — it is pure AST surgery (find statement, splice text, patch imports). The path to Vue support: (a) for `.ts`→`.ts` in a Vue project, delegate to `TsEngine` then call `updateVueImportsAfterMove` to catch `.vue` import strings; (b) for `.vue` source, use `@vue/compiler-sfc`'s `parse()` to locate and splice the `<script>` block — `@vue/compiler-sfc` is already a transitive dep. Moving *into* a `.vue` destination is not worth supporting.

**Per-workspace engine selection breaks down for `moveSymbol`.**
`router.ts` picks one engine for the whole workspace (VueEngine if any `.vue` files are present). This is correct for `rename` and `moveFile`, which need Volar's project graph. It is wrong for `moveSymbol`, which needs AST manipulation that VueEngine can't do. Future fix: per-operation engine selection, or a fallback path inside `VueEngine.moveSymbol` that delegates to `TsEngine`. Current approach is kept for simplicity; track in tech-debt.md when it matters.

**Dispatcher is engine-agnostic; use a command map, not per-engine dispatchers.**
`RefactorEngine` already abstracts over engine type — the dispatcher calls `engine.rename(...)` or `engine.moveFile(...)` without knowing which engine it has. Per-engine dispatchers (`VueDispatcher`, `TsDispatcher`) would leak engine knowledge into the dispatch layer. Instead, use a command map:
```typescript
const commands = { rename: handleRename, move: handleMove } satisfies Record<string, CommandHandler>
```
Each handler receives `(params, workspace, engine)`. The dispatcher resolves the engine once, then delegates.

**Commit body explains WHY, not WHAT.**
Code diffs show what changed. The body should explain decisions and tradeoffs. Don't enumerate changed files or re-describe the diff. Split commits at logical boundaries; don't force a split when a single file spans two concerns.

---

## Key files

| File | Purpose |
|------|---------|
| `src/daemon/paths.ts` | Socket and lockfile path utilities |
| `src/daemon/daemon.ts` | Daemon process; dispatches to engines with workspace param |
| `src/daemon/workspace.ts` | `isWithinWorkspace()` — shared boundary utility |
| `src/engines/text-utils.ts` | `applyTextEdits()` — shared by ts-engine and vue-engine |
| `src/mcp/serve.ts` | MCP server (connects to daemon) |
| `tests/helpers.ts` | `spawnAndWaitForReady`, `McpTestClient`, `killDaemon` |
| `tests/fixtures/cross-boundary/` | Fixture for testing cross-workspace boundary enforcement |
| `docs/security.md` | Threat model, controls, known limitations |
| `docs/tech/volar-v3.md` | How the Vue engine works — read before touching `vue-engine.ts` |
| `docs/tech/tech-debt.md` | Known structural issues in the engine layer |

---

## Memory storage

- `.claude/MEMORY.md` — project state and agent behaviour notes
- `docs/agent-memory.md` — this file; technical gotchas and decisions useful to humans
- `~/.claude/` — ephemeral, wiped on container rebuild; do not use
