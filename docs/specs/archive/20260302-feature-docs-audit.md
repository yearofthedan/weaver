# Feature docs audit

**type:** change
**date:** 2026-03-02
**tracks:** handoff.md # feature-docs-audit → docs/features/*.md

---

## Context

Feature docs exist for 7 of 9 operations (searchText and replaceText have none). The 7 that exist all lead with mechanics ("Renames a symbol…") instead of explaining when an agent should reach for the tool. getTypeErrors uses a completely different structure from the other 6. Every doc repeats the same security paragraph that already lives in `docs/security.md`. The "How it works" sections are step-by-step code walkthroughs that duplicate what reading the source tells you.

## Value / Effort

- **Value:** Feature docs are the first thing an agent (or human) reads when working on a spec that touches an operation. Leading with "why" makes tool selection faster and reduces mis-picks. Consistent structure makes scanning predictable. Missing docs for searchText/replaceText mean those operations are only discoverable from the MCP tool description.
- **Effort:** 9 markdown files, no code changes, no test changes. Entirely prose. Low interaction with existing code — just reading the source for accuracy. Medium writing effort but mechanically straightforward once the structure is agreed.

## Behaviour

- [x] **AC1: Standard structure.** Every feature doc in `docs/features/` follows this section order:
  1. `# Operation: <name>` — title
  2. `## Why use this` — when to reach for it; what it gives you over doing the same thing manually or with a different tool
  3. `## What it does` — one paragraph + MCP tool call example + response example (keep existing examples where accurate)
  4. `## Key concepts` — things an agent needs to know to work with or on this operation; not a step-by-step code walkthrough; focus on concepts that cross the "I just read the code" threshold (e.g. "Volar needs virtual-path pre-translation for this method", "uses regex scan not AST for Vue files")
  5. `## Supported file types` — table
  6. `## Constraints & limitations` — things the tool cannot do
  7. `## Security & workspace boundary` — input validation, output filtering, cross-boundary behaviour; link to `docs/security.md`
  8. `## Technical decisions` — non-obvious tradeoffs (keep existing entries where still accurate)

- [x] **AC2: Missing docs created.** `docs/features/searchText.md` and `docs/features/replaceText.md` exist and follow the standard structure from AC1. Content sourced from the MCP tool descriptions, operation source, and schema.

- [x] **AC3: Existing docs rewritten.** All 7 existing operation docs (rename, moveFile, moveSymbol, extractFunction, findReferences, getDefinition, getTypeErrors) rewritten to follow the standard structure. Specifically:
  - Each gains a `## Why use this` section
  - `## How it works` replaced by `## Key concepts` (trimmed to concepts, not code walkthrough)
  - getTypeErrors restructured: metadata header removed, section names and order match the standard
  - `## Security & workspace boundary` preserved (content may be tightened but section stays)
  - Existing MCP examples, supported-file-type tables, and technical-decisions entries kept where still accurate

## Interface

No public interface changes. This is a docs-only change.

## Edges

- No code changes, no test changes — `pnpm check` must still pass but no new tests are needed.
- Feature docs must not contain ACs or task-tracking language (per CLAUDE.md Rule 10 — ACs live in specs).
- Existing links from other docs (handoff.md, architecture.md, agent-memory.md) to feature docs must not break. File names stay the same.
- Content must be factually accurate against the current source. If a doc says "not supported", verify against the code.

## Done-when

- [x] All 9 operation docs exist and follow the standard structure (AC1)
- [x] searchText.md and replaceText.md created (AC2)
- [x] All 7 existing docs rewritten (AC3)
- [x] `pnpm check` passes
- [x] handoff.md entry updated (link replaces `[needs design]`)
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

All 9 operation feature docs now follow a consistent 8-section structure. Each leads with "Why use this" explaining when to reach for the tool. "How it works" code walkthroughs replaced with "Key concepts" sections. getTypeErrors brought into line with the other docs. searchText and replaceText docs created from source and MCP descriptions. Security section preserved in all docs per project requirement.
