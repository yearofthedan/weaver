# Agent Memory — Project State

This file is the durable memory store for AI agents. It is git-tracked and
survives container rebuilds. Update it at the end of every session.

See `docs/agent-memory.md` for technical gotchas useful to humans too.

---

## Current state

- 43/43 tests passing
- Security controls complete — see `docs/security.md`
- Deps pinned; pnpm override deduplicates `@volar/language-core` to 2.4.28
- CI: `.github/workflows/ci.yml` runs `pnpm check` on push/PR to main

## Next up

1. Engine refactor — see `docs/tech/tech-debt.md` (may be out of date since last refactor)
2. Dogfooding — update guidance to ensure we dogfood
3. Missing operations — brainstorm + implement (see `docs/handoff.md` for candidate list)

## Agent behaviour

**Commit body explains WHY, not WHAT.**
Code diffs show what changed. The body should explain decisions and tradeoffs —
not enumerate files or re-describe the diff. Split commits at logical boundaries;
don't force a split when one file spans two concerns.

**Do not use `~/.claude/` for memory.**
That path is ephemeral and wiped on container rebuild. Write here or to
`docs/agent-memory.md` instead. The memory storage rule in CLAUDE.md is
authoritative.
