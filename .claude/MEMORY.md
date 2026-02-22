# Agent Memory — Project State

This file is the durable memory store for AI agents. It is git-tracked and
survives container rebuilds. Update it at the end of every session.

See `docs/agent-memory.md` for technical gotchas useful to humans too.

---

## Current state

- 59/59 tests passing
- Security controls complete — see `docs/security.md`
- Operations complete: `rename` (TS+Vue), `move` (TS+Vue), `moveSymbol` (TS only), `findReferences` (TS+Vue, read-only)
- Deps pinned; pnpm override deduplicates `@volar/language-core` to 2.4.28
- CI: `.github/workflows/ci.yml` runs `pnpm check` on push/PR to main

## Source layout

```
src/
  cli.ts          ← daemon + serve commands
  schema.ts
  workspace.ts    ← isWithinWorkspace() — shared boundary utility
  mcp.ts          ← MCP server (connects to daemon)
  daemon/
    daemon.ts     ← socket server; isDaemonAlive + removeDaemonFiles
    paths.ts      ← socketPath, lockfilePath, ensureCacheDir
    dispatcher.ts ← dispatchRequest; engine singletons; vue scan post-step
  engines/
    types.ts
    text-utils.ts ← applyTextEdits() shared utility
    ts/
      engine.ts   ← TsEngine (ts-morph)
      project.ts  ← findTsConfig, findTsConfigForFile, isVueProject
    vue/
      engine.ts   ← VueEngine (Volar)
      scan.ts     ← updateVueImportsAfterMove (regex scan for .vue SFCs)
```

## Next up

1. **`moveSymbol` for Vue projects** — currently NOT_SUPPORTED. Buildable: delegate to TsEngine for `.ts`→`.ts` moves + `updateVueImportsAfterMove`; use `@vue/compiler-sfc` for `.vue` source. See architecture note in `docs/handoff.md`.
2. Missing operations — candidates in `docs/handoff.md` (e.g., `getDefinition` is next highest agent value)

## Architecture watch: per-workspace vs per-operation engine selection

The dispatcher picks one engine per workspace. Correct for `rename`/`moveFile` (Volar needs the full project graph). Wrong for `moveSymbol` (pure AST surgery, Volar has nothing to offer). Future fix: per-operation selection or a fallback path inside `VueEngine.moveSymbol`. Tracked in `docs/handoff.md` and tech-debt.md.

## Vue awareness fix (completed this session)

`updateVueImportsAfterMove` was moved from both engine `moveFile()` implementations to the dispatcher's `move` handler as a post-step. Engines are now pure language-service wrappers. The scan runs once in the dispatcher regardless of which engine handled the move.

## MCP tool dogfooding note

`mcp__light-bridge__move` updates both project files (via `getEditsForFileRename`) and out-of-project files (via post-scan in `collectTsFiles`). Test files in `tests/` are handled automatically. `vitest.config.ts` excludes `tests/fixtures/**` so fixture files aren't picked up as test suites.

## Agent behaviour

**Commit body explains WHY, not WHAT.**
Code diffs show what changed. The body should explain decisions and tradeoffs —
not enumerate files or re-describe the diff. Split commits at logical boundaries;
don't force a split when one file spans two concerns.

**Do not use `~/.claude/` for memory.**
That path is ephemeral and wiped on container rebuild. Write here or to
`docs/agent-memory.md` instead. The memory storage rule in CLAUDE.md is
authoritative.
