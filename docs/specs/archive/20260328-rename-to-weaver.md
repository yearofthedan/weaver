# Rename project to Weaver

**type:** change
**date:** 2026-03-28
**tracks:** handoff.md # rename-to-weaver

---

## Context

The project is named "light-bridge" but the name doesn't communicate what the tool does. After brainstorming, the name **weaver** was chosen — it signals the tool's core behaviour (weaving compiler intelligence across files) and has an avatar quality that gives the project personality. The npm scope `@yearofthedan` stays.

## User intent

*As the project maintainer, I want the project renamed from light-bridge to weaver, so that the name communicates what the tool does and is memorable as a CLI command.*

## Relevant files

- `package.json` — package name, bin field, files field (skill dirs)
- `src/adapters/cli/cli.ts` — Commander program name
- `src/adapters/cli/operations.ts` — usage string in error message
- `src/adapters/mcp/mcp.ts` — MCP server name + instructions string
- `src/daemon/paths.ts` — cache directory name (`~/.cache/light-bridge`)
- `src/daemon/daemon.ts` — `LIGHT_BRIDGE_VERBOSE` env var
- `src/daemon/ensure-daemon.ts` — `LIGHT_BRIDGE_VERBOSE` env var
- `src/daemon/logger.test.ts` — cache dir in test
- `src/daemon/paths.test.ts` — cache dir in test
- `.mcp.json` — MCP server key
- `.cursor/mcp.json` — MCP server key
- `.claude/skills/search-and-replace/` — CLI command name in content
- `.claude/skills/move-and-rename/` — CLI command name in content
- `.claude/skills/code-inspection/` — CLI command name in content
- `README.md` — project heading, install commands, CLI examples, mermaid diagram
- `CLAUDE.md` — project heading, description, skill references
- `CONTRIBUTING.md` — project references, install commands
- `SECURITY.md` — GitHub advisory URL
- `docs/` — all markdown files referencing light-bridge
- `eval/` — promptfooconfig.yaml, run-eval.ts, fixture JSON files, test files
- `.devcontainer/devcontainer.json` — GitHub clone URL

### Red flags

- None — this is a mechanical rename with no logic changes.

## Value / Effort

- **Value:** The name becomes self-describing for new users and memorable as a CLI command. Eliminates the "what does light-bridge mean?" question.
- **Effort:** Wide but shallow — ~190 occurrences across ~45 files, all mechanical string replacements. No logic changes, no interface changes. Risk is completeness (missing a reference), not complexity.

## Behaviour

- [x] **AC1: Package identity.** `package.json` `name` is `@yearofthedan/weaver`. `bin` field maps `weaver` to the CLI entry point.
- [x] **AC2: CLI command name.** Commander program name is `weaver`. Error/usage strings reference `weaver` not `light-bridge`. Running `weaver rename '<json>'` works.
- [x] **AC3: Cache and socket paths.** `paths.ts` uses `~/.cache/weaver/` as the cache directory. Socket, lock, and log files live under this path. Tests in `paths.test.ts` and `logger.test.ts` assert the new path.
- [x] **AC4: Environment variable.** `LIGHT_BRIDGE_VERBOSE` → `WEAVER_VERBOSE` in `daemon.ts`, `ensure-daemon.ts`, and all documentation.
- [x] **AC5: MCP server name.** Server identifies as `weaver` in the MCP handshake (`mcp.ts`). `.mcp.json` and `.cursor/mcp.json` use `weaver` as the server key. MCP server instructions text references `weaver`.

## Interface

No interface changes. All operations, parameters, return types, and error codes remain identical. Only the package name, binary name, MCP server identity, cache paths, and environment variable name change.

## Open decisions

None — all decisions resolved during brainstorming:
- Name: `weaver` (not `ts-weave`, `ts-weaver`, or `code-weaver`)
- No short alias needed — `weaver` is already short
- Env var renamed (consolidation to flag-only deferred to separate task)

## Security

- **Workspace boundary:** N/A — no changes to file read/write logic.
- **Sensitive file exposure:** N/A — no changes to file content handling.
- **Input injection:** N/A — no new string parameters introduced.
- **Response leakage:** N/A — no changes to response content.

## Edges

- Existing daemon instances using `~/.cache/light-bridge/` sockets will not be found after the rename. This is acceptable — users restart the daemon after upgrading.
- GitHub repository URL references (SECURITY.md, devcontainer.json) should be updated only if/when the repo is actually renamed. If the repo stays `light-bridge` on GitHub, leave those URLs pointing to the current repo.

## Done-when

- [x] All ACs verified by tests
- [x] `pnpm check` passes (lint + build + test)
- [x] Skill file content updated (all `light-bridge` → `weaver` CLI command references)
- [x] README.md fully updated (heading, install commands, CLI examples, mermaid diagram, description)
- [x] CLAUDE.md updated (heading, description, skill references)
- [x] CONTRIBUTING.md updated
- [x] All `docs/` markdown files updated
- [x] `eval/` files updated (promptfooconfig.yaml, run-eval.ts, fixtures, test files)
- [x] `docs/handoff.md` current-state section updated (skill dir names, CLI references)
- [x] No remaining references to `light-bridge` in source or docs (verified by grep)
- [x] Spec moved to `docs/specs/archive/` with Outcome section

## Outcome

All 5 ACs completed. The rename touched ~190 occurrences across ~45 files — all mechanical string replacements with no logic changes.

**Reflection:**
- The rename was straightforward — wide but shallow, as predicted. No surprises in the source code changes.
- The only remaining `light-bridge` references are in archived spec files (historical records) and the GitHub repo URL (left intentionally, per the Edges section — repo hasn't been renamed on GitHub).
- The `replaceText` tool limitations discovered during this rename (silent skips on JSON files, root-level file glob failures, directory-prefixed glob failures) were captured as a P2 handoff entry for follow-up.
- Tests: 0 new tests added (no logic changes). Existing tests were updated to assert new paths/names.
- Mutation score: N/A — no logic changes to mutate.
