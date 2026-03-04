# Ship a refactoring skill file with the package

**type:** change
**date:** 2026-03-04
**tracks:** handoff.md # agent adoption → README.md

---

## Context

Agents connected to light-bridge via MCP see tool descriptions but don't get workflow guidance — when to reach for a compiler-aware tool vs editing directly, how to act on responses (`typeErrors`, `filesSkipped`), or common sequences (check references before deleting). The CLAUDE.md snippet in the README helps but requires manual copy-paste and only covers Claude Code. Skill files are becoming a cross-agent convention (Claude Code, Roo, and likely others) and give project owners opt-in control over which guidance their agents receive.

## Value / Effort

- **Value:** Agents that load the skill file get workflow-level guidance that tool descriptions can't provide — decision heuristics ("use rename instead of search-and-replace for symbol renames"), response-handling patterns ("act on typeErrors, surface filesSkipped"), and common sequences. This fills the gap between "tools are available" and "agent uses them effectively." Project owners control adoption by choosing whether to reference the skill file.
- **Effort:** Low. One markdown file to author, one line in `package.json` `files`, one section in README. No new code, no new infrastructure. The eval suite can validate tool selection improvement but that's a follow-up, not a blocker.

## Behaviour

- [x] Given the npm package is installed, a skill file exists at `node_modules/@yearofthedan/light-bridge/skills/refactoring/SKILL.md` and is loadable by agents that support skill files (Claude Code, Roo).
- [x] Given an agent loads the skill file, it contains decision guidance for when to use light-bridge tools vs manual editing — at minimum covering: symbol rename, file move, file delete, symbol move, and extract function.
- [x] Given an agent loads the skill file, it contains response-handling guidance — at minimum: don't read files to verify `filesModified`, act on `typeErrors` as an action item, surface `filesSkipped` to the user, and retry on `DAEMON_STARTING`.
- [x] Given this project's own CLAUDE.md, it references the shipped skill file instead of the inline tool list, dogfooding the same artifact external users get.

## Interface

No public API changes. The skill file is a static markdown file shipped in the npm package.

**Skill file path:** `skills/refactoring/SKILL.md` (relative to package root). The nested directory follows the convention used by Claude Code and Roo for skill discovery.

**`package.json` `files` field:** Updated from `["dist"]` to `["dist", "skills"]` so the skill directory ships with npm.

**Frontmatter:** Standard skill file format:
```yaml
---
name: light-bridge-refactoring
description: Guides agents to use light-bridge compiler-aware refactoring tools instead of manual file editing.
---
```

**Content structure:**
- When to use light-bridge vs editing directly (decision table or heuristics)
- Per-tool guidance for the write operations (rename, moveFile, moveSymbol, deleteFile, extractFunction)
- Light-touch guidance for read operations (findReferences, getDefinition, getTypeErrors)
- Response handling patterns
- Common sequences

**Bounds:** The skill file should be under ~200 lines. Longer than that and it's competing with the agent's context window rather than helping it. Tool descriptions carry the per-tool detail; the skill file covers workflow and decision-making.

## Edges

- The skill file must not duplicate tool descriptions — it complements them with workflow guidance that descriptions can't carry.
- The skill file must not assume a specific agent host. References like "mcp__light-bridge__rename" are Claude Code-specific; the skill should use plain tool names or be host-agnostic.
- Tool names in the skill file must match actual MCP tool names. If a tool is renamed, the skill file must be updated. No automated enforcement in this slice — but a stale reference is a bug, not a feature.
- The skill file is opt-in. It must not be auto-loaded or auto-injected. Project owners reference it explicitly.

## Done-when

- [x] All ACs verified by tests
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated:
      - README.md (document skill file location and how to reference it; replace inline CLAUDE.md snippet with skill file reference)
      - handoff.md entry updated
- [x] This project's CLAUDE.md updated to reference the skill file
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

- **Tests added:** 16 (file existence, packaging, format, decision guidance per write operation, response handling patterns, host-agnosticism, dogfooding reference)
- **Mutation score:** N/A — no production code to mutate (markdown file + one `package.json` line)
- **Skill file:** 83 lines, well under the 200-line budget. Covers decision table (7 tools with "use this / not that" framing), response handling (filesModified, filesSkipped, typeErrors), common sequences (5 workflows), and error codes.
- **Design decision:** One skill file rather than per-tool or per-category files. Refactoring workflows cross tool boundaries (findReferences → deleteFile → check typeErrors), so splitting would fragment the guidance.
- **Design decision:** The README's inline CLAUDE.md snippet was replaced with skill file reference instructions for Claude Code and Roo. The skill file is the canonical source of refactoring guidance; the CLAUDE.md snippet was duplicating a subset of it.
