# Tool description standard

**type:** change
**date:** 2026-03-02
**tracks:** handoff.md # tool-description-standard → docs/agent-users.md, src/mcp.ts

---

## Context

MCP tool descriptions are the sole discovery mechanism for agents. light-bridge has 9 tools with good but inconsistent descriptions — some lead with value, others with mechanics; some repeat shared boilerplate (DAEMON_STARTING, typeErrors), others don't. There are no codified principles, so each new tool reinvents the format. Every tool description is loaded into context on every request, so verbosity has a direct cost.

## Value / Effort

- **Value:** Consistent, concise descriptions help agents pick the right tool on the first try and reduce wasted context. Principles give spec authors a reference when writing descriptions for new tools. Moving shared boilerplate to server `instructions` saves ~30 tokens per mutating tool description (5 tools × ~30 tokens = ~150 tokens reclaimed per session).
- **Effort:** Small. Two files touched: `docs/agent-users.md` (new section) and `src/mcp.ts` (rewrite descriptions + move DAEMON_STARTING to server instructions). No new infrastructure, no code logic changes. The existing descriptions are close — this is editing, not greenfield.

## Behaviour

- [x] **AC1: Principles section exists.** `docs/agent-users.md` contains a new section "Writing tool descriptions" after the existing "Applying this to design" section. It states actionable principles (not a rigid template) that a spec author can evaluate a draft description against. At minimum the principles must address: (a) leading with value/when-to-use, (b) stating what the compiler gives you over alternatives, (c) surfacing constraints that prevent failed calls, (d) describing what the agent gets back, (e) balancing informativeness against context cost — every description is loaded on every request.

- [x] **AC2: All 9 tool descriptions rewritten.** Every `description` string in the `TOOLS` array in `src/mcp.ts` follows the principles from AC1. Descriptions are at least as informative as today (no loss of critical guidance) but more concise where current text is redundant or mechanical.

- [x] **AC3: DAEMON_STARTING moved to server instructions.** The `instructions` field in the `McpServer` constructor includes DAEMON_STARTING retry guidance. Individual tool descriptions no longer mention DAEMON_STARTING. The typeErrors convention for mutating tools stays in each tool's description (agents need it per-tool to know what fields to expect).

## Interface

No public interface change — tool names, parameter schemas, and response shapes are unchanged. This spec only changes description text and server instructions text.

## Edges

- **No tool renames or parameter changes.** This is a description-only change. Any existing agent integration that references tool names continues to work.
- **Server instructions must not exceed ~200 words.** The instructions field is read once per session; it should carry project-level context, not per-tool detail.
- **Descriptions must not lose critical guidance.** Specifically: filesSkipped surfacing, checkTypeErrors opt-out, endCol semantics for extractFunction, surgical vs pattern mode for replaceText. These are in current descriptions and must survive the rewrite.

## Done-when

- [x] All ACs verified by tests (description content assertions in existing mcp test file if applicable; otherwise manual review)
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated: agent-users.md (new section), features/README.md if needed
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

Added "Writing tool descriptions" section to `docs/agent-users.md` with 5 actionable principles: lead with when-to-use, state compiler advantage over alternatives, surface constraints, describe response shape, keep shared conventions in server instructions. Rewrote all 9 tool descriptions in `src/mcp.ts` — each leads with the situation, critical guidance preserved (filesSkipped, checkTypeErrors, endCol, surgical/pattern modes), DAEMON_STARTING removed from individual descriptions. DAEMON_STARTING retry guidance moved to server `instructions` field (~65 words, well under 200 word limit).
