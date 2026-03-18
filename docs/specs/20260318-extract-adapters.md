# Extract `src/adapters/` for inbound entry points

**type:** change
**date:** 2026-03-18
**tracks:** handoff.md # Extract `src/adapters/` for CLI and MCP entry points → docs/features/mcp-transport.md, docs/features/daemon.md

---

## Context

`src/mcp/mcp.ts` and `src/cli.ts` are inbound adapters — they translate external protocols (MCP JSON-RPC, CLI args) into internal operation calls. Currently they live alongside domain code rather than in a dedicated boundary layer. The project already has `src/ports/` for outbound abstractions; creating `src/adapters/` for inbound counterparts makes the ports-and-adapters structure legible from the directory layout. The 372-line `mcp.ts` also has two clean extraction seams (tool definitions table, error classifier) and two "exported for testing only" exports that should be resolved.

## User intent

*As a contributor, I want inbound adapters grouped under `src/adapters/`, so that the ports-and-adapters boundary is visible in the directory layout without reading any source files.*

## Relevant files

- `src/cli.ts` — CLI entry point; imports from `./daemon/daemon.js` and `./mcp/mcp.js`; referenced in `package.json` bin/main/scripts
- `src/mcp/mcp.ts` — MCP server adapter; 372 lines; imports from `../daemon/`, `../schema.js`, `../security.js`
- `src/mcp/error-masking.integration.test.ts` — mislabeled unit test for `classifyDaemonError`; no I/O, should not be `.integration.`
- `src/mcp/*.integration.test.ts` (8 genuine integration tests) — colocated tests for the MCP adapter layer
- `package.json` — `bin`, `main`, `build` (includes `chmod +x dist/cli.js`), `dev` scripts all reference the current paths
- `src/daemon/ensure-daemon.ts` — exports `callDaemon` directly; `callDaemonForTest` in `mcp.ts` is a redundant re-export alias of it

### Red flags

- `src/mcp/mcp.ts` is 372 lines — above the 300-line review threshold. Two clean seams: the `TOOLS` data table (~235 lines) and `classifyDaemonError` (~15 lines). Extracting them brings `mcp.ts` under 130 lines.
- `classifyDaemonError` is exported with "for testing only" comment. It's pure logic and belongs in its own module with a real export.
- `callDaemonForTest` is a re-export alias of `callDaemon` from `ensure-daemon.ts`. Redundant — tests can import the real function directly.
- `error-masking.integration.test.ts` is misnamed — it contains pure unit tests (no I/O, no subprocesses, no sockets).

## Value / Effort

- **Value:** Contributors reading `src/` immediately see the ports-and-adapters structure. Removes "exported for testing only" hacks. Fixes a misnamed test file. Reduces `mcp.ts` from 372 to ~130 lines, making it easier to navigate and mutate.
- **Effort:** Pure structural change — no logic changes. ~14 files touched: 2 source files moved, 2 new files extracted, 8 test files moved, 1 test file renamed, `package.json` updated, handoff current-state updated. All changes are import paths, config strings, and cut-and-paste extractions.

## Behaviour

- [ ] `src/mcp/mcp.ts` is moved to `src/adapters/mcp/mcp.ts`; the `src/mcp/` directory no longer exists after the move; all import paths that previously resolved to `src/mcp/mcp.ts` resolve correctly at the new location.
- [ ] The 8 genuine integration tests (`src/mcp/*.integration.test.ts`, excluding `error-masking.integration.test.ts`) are moved to `src/adapters/mcp/`; their imports resolve correctly.
- [ ] `src/cli.ts` is moved to `src/adapters/cli/cli.ts`; `package.json` `bin`, `main`, `build` (including the `chmod +x` line), and `dev` script are updated to reference `dist/adapters/cli/cli.js` / `src/adapters/cli/cli.ts`.
- [ ] `classifyDaemonError` is extracted to `src/adapters/mcp/classify-error.ts` as a real named export (no "for testing only" qualifier); `error-masking.integration.test.ts` is moved to `src/adapters/mcp/classify-error.test.ts` and imports from `./classify-error.js`; the `callDaemonForTest` re-export is removed from `mcp.ts`; any test files that imported `callDaemonForTest` are updated to import `callDaemon` directly from `../../daemon/ensure-daemon.js`.
- [ ] The `TOOLS` array, `ToolDefinition` interface, and `TOOL_NAMES` constant are extracted from `mcp.ts` into `src/adapters/mcp/tools.ts`; `mcp.ts` imports from `./tools.js`; both files are under 200 lines after extraction.
- [ ] `pnpm check` (lint + build + test) passes with no behaviour changes.

## Interface

N/A — no public surface changes. The npm `bin` name (`light-bridge`) is unchanged; only the internal path of the compiled entry point changes (`dist/cli.js` → `dist/adapters/cli/cli.js`). MCP tool names, parameters, and responses are unchanged.

## Open decisions

None — the handoff entry specifies `src/adapters/mcp/` and `src/adapters/cli/` explicitly. Extraction targets are determined by the existing seams in the file.

## Security

- **Workspace boundary:** N/A — no file read/write paths change; security logic in `src/security.ts` is untouched.
- **Sensitive file exposure:** N/A — no new file reads.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — no response fields change.

## Edges

- The `build` script runs `chmod +x dist/cli.js` — this must target the new path or the binary won't be executable after `npm install`.
- The `main` field in `package.json` must update alongside `bin` — some tooling invokes the package via `main` directly.
- `callDaemon` is already a real export from `src/daemon/ensure-daemon.ts`; no new exports are needed there.
- After the move, `src/mcp/` must not remain as an empty directory.

## Done-when

- [ ] All ACs verified by tests
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated: handoff.md current-state layout section updated to show `src/adapters/` replacing `src/mcp/` and `src/cli.ts`
- [ ] `src/mcp/` directory is gone
- [ ] No "exported for testing only" exports remain in `src/adapters/mcp/mcp.ts`
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to relevant doc if discovered
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
