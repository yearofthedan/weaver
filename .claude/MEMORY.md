# Agent Memory — Project State

This file is the durable memory store for AI agents. Git-tracked; survives container rebuilds.
Update at the end of every session. Keep this file as a signpost — details live in the docs.

---

## Current state

- 125/125 tests passing
- All five operations shipped: `rename`, `move`, `moveSymbol` (TS only), `findReferences`, `getDefinition`
- Core architecture complete: daemon, MCP server, both engines, security controls, provider/engine separation, data-driven dispatch
- CI: `.github/workflows/ci.yml` runs `pnpm check` on push/PR to main

**Next work:** see `docs/handoff.md` (filesystem watcher, lazy init, extractFunction, etc.)

---

## Source layout

```
src/
  cli.ts          ← daemon + serve commands
  schema.ts       ← Zod schemas for all operations
  workspace.ts    ← isWithinWorkspace() — shared boundary utility
  mcp.ts          ← MCP server (TOOLS table drives registration)
  daemon/
    daemon.ts     ← socket server; mutex; isDaemonAlive + removeDaemonFiles
    paths.ts      ← socketPath, lockfilePath, ensureCacheDir
    dispatcher.ts ← OPERATIONS table drives dispatch; engine singletons; vue scan post-step
  engines/
    errors.ts     ← EngineError + ErrorCode union
    types.ts      ← result types + LanguageProvider interface
    engine.ts     ← BaseEngine: rename, findReferences, getDefinition, moveFile
    text-utils.ts ← applyTextEdits(), offsetToLineCol()
    file-walk.ts  ← walkFiles(dir, extensions) + SKIP_DIRS
    providers/
      ts.ts       ← TsProvider (ts-morph)
      volar.ts    ← VolarProvider (Volar proxy + virtual↔real translation)
    ts/engine.ts  ← TsEngine: adds moveSymbol (ts-morph AST)
    ts/project.ts ← findTsConfig, isVueProject
    vue/engine.ts ← VueEngine: moveSymbol stub (NOT_SUPPORTED)
    vue/scan.ts   ← updateVueImportsAfterMove (regex scan for .vue SFCs)
    vue/service-builder.ts ← buildVolarService()
```

---

## Key docs

| Doc | Purpose |
|-----|---------|
| `docs/handoff.md` | Next work, architecture decisions, technical context |
| `docs/agent-memory.md` | Technical gotchas and implementation decisions |
| `docs/vision.md` | What's shipped and what comes next |
| `docs/security.md` | Threat model, controls, known limitations |
| `docs/tech/volar-v3.md` | How the Vue engine works — read before touching `vue/engine.ts` |
| `docs/tech/tech-debt.md` | Known structural issues |
| `docs/features/` | Per-operation docs (rename, move, moveSymbol, findReferences, getDefinition) |

---

## Agent behaviour

**Commit body explains WHY, not WHAT.** Split commits at logical boundaries.

**Do not use `~/.claude/` for memory.** That path is wiped on container rebuild.
Write here or to `docs/agent-memory.md` instead.

**Parallel agents with `isolation: "worktree"` cannot create files or run Bash without approval.**
Use `subagent_type: "general-purpose"` for tasks that write files.

---

## Notable constraints

- `moveSymbol` in Vue projects returns `NOT_SUPPORTED` — router sends all Vue-project files to
  `VueEngine`, which has no "extract declaration" API. Not a Volar limitation; fix is per-operation
  engine selection or delegation inside `VueEngine.moveSymbol`. Tracked in `docs/tech/tech-debt.md`.
- `updateVueImportsAfterMove` does not enforce workspace boundary on its scan (low risk, search
  root is clamped to tsconfig dir). Tracked in `docs/security.md` and `docs/tech/tech-debt.md`.
