# Align tool feature docs to template

**type:** change
**date:** 2026-03-03
**tracks:** handoff.md # Deepen tool feature docs → docs/features/*

---

## Context

The ten tool feature docs describe interfaces well but drift from the `feature.md` template in structure. Multi-phase operations (moveFile, moveSymbol, extractFunction, deleteFile) have no call-chain diagrams; "Key concepts", "Supported file types", and "Security & workspace boundary" are ad-hoc section names that don't match the template; and the template itself lives in `docs/specs/templates/` rather than alongside the docs it templates.

## Value / Effort

- **Value:** Makes each doc useful for debugging and extending — not just calling the tool. A developer hitting a silent failure in `moveSymbol` should be able to open `moveSymbol.md`, trace the flow to the right phase, and know which file to read next.
- **Effort:** Docs-only. No source changes. Ten files to rewrite (structure + diagrams), three files to update (change.md, spec SKILL.md, features README), one file to move (feature.md template).

## Behaviour

- [ ] All ten tool docs use the template section structure: **How it works**, **Security**, **Constraints**, **Technical decisions**. Non-template sections (Key concepts, Supported file types, Security & workspace boundary, Constraints & limitations) are gone or absorbed.
- [ ] `moveFile.md`, `moveSymbol.md`, `extractFunction.md`, and `deleteFile.md` each have an ASCII call-chain flow diagram under "How it works", matching the style in `watcher.md` and the template example.
- [ ] `docs/specs/templates/feature.md` moves to `docs/features/_template.md`. References in `change.md` Done-when and `spec/SKILL.md` step 2 are updated to the new path.

## Interface

N/A — no public API changes.

## Edges

- MCP call JSON examples are kept in each doc.
- Tool-specific response fields are kept; standard fields (`ok`, `filesModified`, `filesSkipped`) need not be re-documented since they are in `mcp-transport.md`.
- The README "Supported file types summary" section stays; individual docs reference it rather than duplicating per-tool tables.

## Done-when

- [x] All ten tool docs follow the template structure
- [x] Four multi-phase docs have call-chain flow diagrams
- [x] `feature.md` template moved; all references updated
- [x] `docs/features/README.md` updated (add `_template.md` note)
- [x] `pnpm check` passes
- [x] Spec moved to `docs/specs/archive/` with Outcome section
- [x] handoff.md entry removed

## Outcome

**Docs changed:** 10 tool feature docs rewritten; 1 template moved; 3 reference files updated (change.md, spec/SKILL.md, README.md); 1 README entry added.

**Key decisions made during implementation:**
- MCP call JSON examples were kept in each doc (most useful quick-reference for callers); only duplicated standard response fields (`ok`, `filesModified`, `filesSkipped`) were trimmed in favour of pointers to `mcp-transport.md`.
- `deleteFile.md` already had the best content (three-phase description) — it got the flow diagram treatment and section renaming but the substance was preserved.
- The `getDefinition.md` "Vue requires explicit virtual-path pre-translation" note was promoted into the flow diagram with a comment that any future read-only operation hitting "Could not find source file: *.vue" needs the same fix — this is the most operationally important debugging clue in the doc.
- `moveSymbol.md` Technical decisions gained a "Why snapshot importers before mutating the AST?" entry that wasn't in the original, captured from reading the source.
