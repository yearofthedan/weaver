# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

Read the docs in this order:
1. `docs/vision.md` — what this is and where it's going
2. `docs/features/daemon.md` — understand the daemon before touching `serve`
3. `docs/features/mcp-transport.md` — how `serve` connects to the daemon
4. `docs/features/engines.md` — understand the engine boundary before touching anything
5. `docs/quality.md` — testing and reliability expectations

---

## Current state

**51/51 tests passing.** Security controls and project restructure complete. The file layout now reflects domain boundaries:

```
src/
  cli.ts          ← registers only: daemon, serve
  schema.ts
  workspace.ts    ← isWithinWorkspace() — shared boundary utility
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts     ← socket server; isDaemonAlive + removeDaemonFiles lifecycle fns
    paths.ts      ← socketPath, lockfilePath, ensureCacheDir only
    dispatcher.ts ← dispatchRequest; engine singletons; vue scan post-step
  engines/
    types.ts
    text-utils.ts ← applyTextEdits() — shared by both engines
    ts/
      engine.ts   ← TypeScript refactoring via ts-morph
      project.ts  ← findTsConfig, findTsConfigForFile, isVueProject
    vue/
      engine.ts   ← Vue/Volar refactoring
      scan.ts     ← updateVueImportsAfterMove (regex scan for .vue SFC imports)
```

**Completed this session:**
- File restructure via `mcp__light-bridge__move` (dogfooding)
- Vue awareness leak fixed: `updateVueImportsAfterMove` moved from engines to the dispatcher post-step
- `isVueProject` moved to `engines/ts/project.ts` alongside the other project utilities
- `isDaemonAlive` + `removeDaemonFiles` moved from `paths.ts` to `daemon.ts` (lifecycle vs. path derivation)
- `router.ts` deleted; engine singletons now live in `dispatcher.ts`
- `moveSymbol` self-import edge case fixed (skip dest file in importer loop)

**Known remaining gap** — `updateVueImportsAfterMove` (vue/scan) does not enforce workspace boundary on its regex scan. Low risk in practice (search root is clamped to tsconfig directory), tracked in tech-debt.md.

**Next things to build, in order:**

1. **`moveSymbol` operation** ✅ — shipped. Moves a named export from one file to another, updating all import references. Implemented in `TsEngine`; `VueEngine` throws `NOT_SUPPORTED`. See architecture note below on extending this to Vue projects.

2. **Project restructure** ✅ — complete (this session).

3. **Missing operations** — brainstorm and implement what's next (see below)
---

## Missing operations

The current tool surface is just `rename` and `move`. Before adding anything, brainstorm what an AI coding agent actually needs most. Some candidates to evaluate:

- `findReferences` — locate all usages of a symbol without modifying anything; useful for impact analysis before a refactor. **High priority.** The clearest signal: when an agent plans to reorganize files, it currently spawns an explore subagent to grep for imports of each file. Grep is brittle (misses re-exports, dynamic imports, type-only imports, aliased paths). `ls.findReferences()` / `ls.getReferencesAtPosition()` gives a compiler-verified answer. Light-bridge already handles the *write* side (move + rewrite imports); this closes the *read* side so agents can ask "who uses this symbol?" before acting.

  **Vue compatibility:** works for Vue projects with the same virtual-file translation already used by `rename`. The `VolarLanguageService` interface just needs `findReferences` declared — the underlying Volar proxy already supports it. The translation block in `vue-engine.ts` (virtual `.vue.ts` → real `.vue` source-map mapping) should be extracted into a shared helper before implementing this, since `findReferences` would need the same logic.

  **Two entry points to consider — keep them separate:**
  - *By symbol position* (like `rename`): clean, compiler-verified, works for both TS and Vue. Implement this first.
  - *By file path* ("who imports this file?"): a different question. `findReferences` operates on a symbol position, not a file path. Options: union references across all exports (expensive), use `getEditsForFileRename` as a dry-run proxy (already available from `moveFile`), or scan import strings with the compiler's module resolver. Worth a separate design pass — do not conflate with the symbol-position variant.
- `getDefinition` — jump-to-definition; lets an agent navigate to source before editing
- `extractFunction` — pull a selection into a named function, updating the call site
- `inlineVariable` / `inlineFunction` — collapse a trivially-used binding
- `deleteFile` — remove a file and clean up its imports in other files
- `createFile` — scaffolding with correct import paths inferred from location

For each candidate, consider: does the daemon's stateful engine make it meaningfully better than the agent just editing the file directly? `rename` and `move` benefit strongly because they require project-wide reference tracking. Operations with narrow blast radius (e.g. create a blank file) may not be worth the plumbing.

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer. Includes the `ensureDaemon` one-shot bug discovered during this session.
- **`@volar/language-core` version skew** — `@vue/language-core` and `@volar/typescript` previously depended on different patch versions (2.4.27 vs 2.4.28) of `@volar/language-core`, causing type mismatches that required `any` casts. Fixed via a `pnpm.overrides` entry in `package.json` pinning to 2.4.28. `@volar/language-core` is also a direct `devDependency` so TypeScript can resolve the `Language<string>` type import in `vue-engine.ts`.

---

## Architecture decisions

- **Per-workspace engine selection — a known limitation** — `router.ts` picks one engine per workspace: if any `.vue` files are present, `VueEngine` handles everything, including `.ts` files. This is correct for `rename` and `moveFile` (Volar understands the full project graph including `.vue` SFCs). But it means `moveSymbol` in a Vue project hits `NOT_SUPPORTED`, even when both source and dest are plain `.ts` files. The `NOT_SUPPORTED` guard is a router constraint, not a Volar one — Volar has no "extract declaration" API regardless. The fix is per-operation engine selection (or a fallback path inside `VueEngine.moveSymbol` that delegates to `TsEngine` for `.ts`→`.ts` moves, then calls `updateVueImportsAfterMove` to patch `.vue` import strings). The current approach is kept because it is simpler and the broken case is uncommon; track this in tech-debt.md when it becomes a priority.

- **`moveSymbol` for Vue sources (`.vue` → `.ts`) is buildable** — the declaration would be in a `<script setup>` block. Extract it with `@vue/compiler-sfc`'s `parse()`, splice the script block text, write the destination `.ts`, and patch importers. `@vue/compiler-sfc` is already a transitive dependency. Moving *into* a `.vue` destination is not worth supporting — injecting TS declarations into an SFC in the right position is fragile.

- **MCP transport uses `@modelcontextprotocol/sdk`** — the agent-facing stdio layer uses the official SDK (`@modelcontextprotocol/sdk@^1.26.0`). The internal daemon↔serve socket uses plain newline-delimited JSON, no library needed.
- **SDK wire format is newline-delimited JSON — NOT Content-Length framed** — `StdioServerTransport` sends/reads `JSON.stringify(msg) + '\n'`. There is no `Content-Length` header. `McpTestClient` must match this format.
- **SDK is Zod v3/v4 agnostic** — the SDK ships `zod-compat` and accepts both Zod v3 and v4 schemas. Pass Zod v3 schemas from `src/schema.ts` directly to `registerTool`. No version conflict.
- **Daemon socket: one connection per call** — `serve` opens a fresh Unix socket connection per tool call, writes one JSON line, reads one JSON line, closes.
- **`callDaemon` error → `DAEMON_STARTING`** — if the socket connection fails (e.g. daemon not yet ready), return `{ ok: false, error: "DAEMON_STARTING", message: "..." }` to the agent.
- **`ensureDaemon` fires once at startup** — if the daemon dies after `serve` starts, tool calls return `DAEMON_STARTING` permanently. See tech-debt.md for the fix.
- **Test helper: `McpTestClient`** — a small class in `tests/helpers.ts` that handles newline-delimited framing and the initialize handshake. Keeps test bodies clean.
- **`spawnAndWaitForReady` takes `{ pipeStdin: true }`** — required for MCP tests that need to write to the process's stdin.
- **Vertical slice tests assert before and after** — always read the fixture files before the operation to confirm the original state, then assert both the old string is gone and the new string is present. Avoids false-positive tests.
- **`filesSkipped` in engine results** — when a collateral write would land outside the workspace, engines skip it and list the path in `filesSkipped`. The daemon includes this in the response. Agents should surface it to the user.
- **`ts-engine.moveFile` uses language service directly** — `sourceFile.move()` + `project.save()` has no per-file whitelist API; it would write all dirty files atomically. Instead we call `ls.getEditsForFileRename()` and apply edits file-by-file, then `fs.renameSync`. This matches what vue-engine already did. The tradeoff: ts-morph's in-memory project is stale after the operation, but we immediately call `invalidateProject()` so it's rebuilt on the next call.
