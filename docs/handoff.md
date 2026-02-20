# Handoff Notes

Context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

Read the docs in this order:
1. `docs/vision.md` — what this is and where it's going
2. `docs/features/daemon.md` — the primary next feature; understand this before touching `serve`
3. `docs/features/mcp-transport.md` — how `serve` connects to the daemon
4. `docs/features/engines.md` — understand the engine boundary before touching anything
5. `docs/quality.md` — testing and reliability expectations

---

## Current state

**33/33 tests passing.** `rename` and `move` are fully implemented and tested. The `serve` command is scaffolded (validates workspace, pre-warms engine, keeps stdin open) but the daemon and MCP message loop are not yet implemented.

**Next things to build, in order:**

1. **Daemon** — see `docs/features/daemon.md`
2. **Engine refactor** — see `docs/tech/tech-debt.md`
3. **MCP transport** — see `docs/features/mcp-transport.md`

---

## Technical context

- **`docs/tech/volar-v3.md`** — how the Vue engine works around TypeScript's refusal to process `.vue` files. Read this before touching `src/engines/vue-engine.ts`.
- **`docs/tech/tech-debt.md`** — known structural issues in the engine layer to address after the daemon and MCP transport are stable.
