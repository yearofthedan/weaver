# Agent Memory — Project State

This file is the durable memory store for AI agents. It is git-tracked and
survives container rebuilds. Update it at the end of every session.

See `docs/agent-memory.md` for technical gotchas useful to humans too.

---

## Current state

- 51/51 tests passing
- Security controls complete — see `docs/security.md`
- `moveSymbol` shipped: `TsEngine` full implementation; `VueEngine` stub throws `NOT_SUPPORTED`
- Deps pinned; pnpm override deduplicates `@volar/language-core` to 2.4.28
- CI: `.github/workflows/ci.yml` runs `pnpm check` on push/PR to main

## Next up

1. **Project restructure** — dogfood using `move` + `moveSymbol`. Full target layout in `docs/handoff.md`.
2. Missing operations — further candidates in `docs/handoff.md`
3. **`moveSymbol` for Vue projects** — currently NOT_SUPPORTED. Buildable: delegate to TsEngine for `.ts`→`.ts` moves + `updateVueImportsAfterMove`; use `@vue/compiler-sfc` for `.vue` source. See architecture note in `docs/handoff.md`.

## Architecture watch: per-workspace vs per-operation engine selection

The router picks one engine per workspace. Correct for `rename`/`moveFile` (Volar needs the full project graph). Wrong for `moveSymbol` (pure AST surgery, Volar has nothing to offer). Future fix: per-operation selection or a fallback path inside `VueEngine.moveSymbol`. Tracked in `docs/handoff.md` and tech-debt.md.

## Agent behaviour

**Commit body explains WHY, not WHAT.**
Code diffs show what changed. The body should explain decisions and tradeoffs —
not enumerate files or re-describe the diff. Split commits at logical boundaries;
don't force a split when one file spans two concerns.

**Do not use `~/.claude/` for memory.**
That path is ephemeral and wiped on container rebuild. Write here or to
`docs/agent-memory.md` instead. The memory storage rule in CLAUDE.md is
authoritative.
