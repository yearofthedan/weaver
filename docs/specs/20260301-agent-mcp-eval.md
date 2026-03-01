# Scope an Agent+MCP eval approach

**type:** change
**date:** 2026-03-01
**tracks:** handoff.md #11 → docs/quality.md (eval section)

---

## Context

Current tests prove engine correctness and protocol behaviour, but the right eval shape for agent behaviour is product-direction dependent. This is a scoping task, not an implementation task — the deliverable is a design note, not code.

## Behaviour

- [ ] A design note exists (in `docs/` or as a spec) capturing: agreed goals/non-goals, success metrics, and where eval should run (CI, local-only, scheduled, etc.)
- [ ] Scope is explicitly approved by the owner before any implementation work starts
- [ ] The first implementation task references the approved scope doc, not an assumed eval architecture

## Interface

N/A — this is a design deliverable, not a code change.

## Edges

- Do not build eval infrastructure in this slice — only scope it
- Do not assume a fixed eval architecture (e.g., don't commit to "vitest-based" or "separate repo" without discussion)
- The design note should be lightweight enough to fit in a single doc page

## Done-when

- [ ] Design note exists and is approved
- [ ] Follow-up implementation task(s) added to handoff.md as [needs design] referencing the note
- [ ] Spec moved to docs/specs/archive/ with Outcome section
