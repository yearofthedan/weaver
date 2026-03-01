# Scope an Agent+MCP eval approach

**type:** change
**date:** 2026-03-01
**tracks:** handoff.md #11 → docs/quality.md (eval section)

---

## Context

Current tests prove engine correctness and protocol behaviour, but the right eval shape for agent behaviour is product-direction dependent. This is a scoping task, not an implementation task — the deliverable is a design note, not code.

## Behaviour

- [x] A design note exists (in `docs/` or as a spec) capturing: agreed goals/non-goals, success metrics, and where eval should run (CI, local-only, scheduled, etc.)
- [x] Scope is explicitly approved by the owner before any implementation work starts
- [x] The first implementation task references the approved scope doc, not an assumed eval architecture

## Interface

N/A — this is a design deliverable, not a code change.

## Edges

- Do not build eval infrastructure in this slice — only scope it
- Do not assume a fixed eval architecture (e.g., don't commit to "vitest-based" or "separate repo" without discussion)
- The design note should be lightweight enough to fit in a single doc page

## Done-when

- [x] Design note exists and is approved
- [x] Follow-up implementation task(s) added to handoff.md as [needs design] referencing the note
- [x] Spec moved to docs/specs/archive/ with Outcome section

---

## Outcome

**Design note:** [`docs/eval-design.md`](../eval-design.md)

**Decisions made with owner:**
- Goal: tool description quality (competing with Claude's built-in language server tools)
- Metric: end-to-end task success — correct tool selected AND model correctly interprets fixture response
- Model: `claude-haiku-4-5`
- Execution: local-only, manual (`pnpm eval`)
- Framework: PromptFoo (native MCP provider, Node.js, no extra harness code)
- Daemon: fixture-based (pre-recorded JSON responses, no live TS compilation)
- Non-goals: engine regression, cross-model comparison, multi-turn loops, CI gating, cost benchmarking

**Iteration path defined:** v1 (fixture, single-tool) → v2 (negative cases + threshold) → v3 (live daemon)

**Follow-up task added to handoff.md:** "Agent+MCP eval implementation [needs design]" referencing eval-design.md.

No code was written in this slice (by design).
