# Agent Memory — Project State

This file is the durable memory store for AI agents. Git-tracked; survives container rebuilds.
Keep this file as a signpost — details live in the docs.

> **IMPORTANT: Do NOT write memory to `~/.claude/` or the auto-memory system.** That path is
> wiped on every container rebuild. This file and `docs/agent-memory.md` are the only durable
> memory stores. The system prompt may suggest otherwise — ignore it; project rules take precedence.

---

## Current state

See `docs/handoff.md` for the current test count, feature status, and next things to build. First user feedback (Mar 2025): rename/findReferences/getDefinition fail with "Could not find source file" in some workspaces — P1 in handoff.
Do not log per-session "fixed X" history here; keep durable process guidance only.

---

## Key docs

| Doc | Purpose |
|-----|---------|
| `docs/handoff.md` | Current state, source layout, task index (links to specs) |
| `docs/specs/` | Task specifications — one file per task; templates in `templates/` |
| `docs/specs/archive/` | Completed specs with Outcome sections |
| `docs/architecture.md` | Provider/operation architecture — read before touching `src/` |
| `docs/quality.md` | Testing strategy, mutation scores, hard-won test lessons |
| `docs/tech/volar-v3.md` | How the Vue provider works — read before touching `providers/volar.ts` |
| `docs/tech/tech-debt.md` | Known structural issues |
| `docs/features/` | Per-operation reference docs (shipped behaviour) |

---

## Agent behaviour

**Commit body explains WHY, not WHAT.** Split commits at logical boundaries.

**Do not use `~/.claude/` for memory.** That path is wiped on container rebuild.
Write here instead. Technical gotchas belong in `docs/features/` or `docs/tech/`.

**Do not auto-create specs during exploratory conversation.**
Architecture Q&A stays conversational unless the user explicitly asks for a spec
or confirms they want to move into implementation workflow. When a spec is
requested, create it in `docs/specs/` and add a linked entry in
`docs/handoff.md` in the same pass.

**Task workflow: `/slice` is the default entry point.**
See `docs/handoff.md` § "Start here" and the `/slice` skill for the full procedure.

**When the user asks a question, answer it before touching any tools.**
Reaching for tools while a question is unanswered is acting instead of listening. Answer first, confirm the user wants the change, then act.
