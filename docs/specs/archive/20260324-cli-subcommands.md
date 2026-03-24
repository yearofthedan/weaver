# CLI-first transport: expose operations as CLI subcommands

**type:** change
**date:** 2026-03-24
**tracks:** handoff.md # CLI-first transport → docs/features/cli.md

---

## Context

Operations are only reachable via MCP today. Adding CLI subcommands gives agents a zero-setup, zero-token-overhead way to call operations by shelling out. The daemon architecture already supports this — the new layer is thin (arg parsing → daemon request → JSON output).

## User intent

*As an AI coding agent, I want to invoke light-bridge operations via CLI subcommands, so that I can use compiler-aware refactoring without MCP setup overhead or per-turn schema token cost.*

## Relevant files

- `src/adapters/cli/cli.ts` — existing CLI entry point; registers `daemon`, `serve`, `stop` commands
- `src/daemon/ensure-daemon.ts` — `ensureDaemon()` + `callDaemon()` + `socketPath()`
- `src/daemon/dispatcher.ts` — `OPERATIONS` table; defines all operation names and schemas
- `src/adapters/schema.ts` — Zod schemas for all operations
- `src/adapters/mcp/tools.ts` — `TOOLS` table; has the 11 tool names
- `docs/features/cli.md` — CLI command reference (needs updating)

### Red flags

- `src/adapters/cli/cli.ts` is 57 lines — plenty of room, but adding 11 subcommands inline would bloat it. Extract a data-driven registration loop into a separate module (e.g. `src/adapters/cli/operations.ts`).

## Value / Effort

- **Value:** Agents can call `light-bridge rename '{"file": "src/a.ts", "line": 5, "col": 3, "newName": "bar"}'` directly — no MCP server running, no tool schemas consuming context tokens on every turn, works with any agent that can shell out. Enables Unix composition (`light-bridge find-references '...' | jq '.references[]'`).
- **Effort:** Thin adapter layer. One new module for the data-driven subcommand registration. Touches `cli.ts` (add subcommands), `ensure-daemon.ts` (reuse existing functions), and `cli.md` + `README.md` (docs). No new concepts — plumbing through existing `callDaemon` + `OPERATIONS` patterns.

## Behaviour

- [ ] **AC1: Data-driven subcommand registration.** Given the existing `OPERATIONS` table keys, all 11 operations are registered as kebab-case CLI subcommands (e.g. `rename`, `move-file`, `find-references`, `get-type-errors`, `replace-text`). Each subcommand accepts a single positional JSON argument or reads JSON from stdin (when stdin is not a TTY). The JSON keys match the Zod schema field names for that operation. The subcommand calls `ensureDaemon`, sends the parsed JSON to `callDaemon` with the camelCase method name, and prints the daemon's JSON response to stdout followed by a newline. Exit code is 0 when `status` is `"success"` or `"warn"`, 1 when `"error"`.

- [ ] **AC2: Relative path resolution.** Given a JSON param whose key is listed in the operation's `pathParams` (e.g. `file`, `oldPath`, `newPath`, `sourceFile`, `destFile`), if the value is not absolute, it is resolved to an absolute path against `--workspace` (or cwd) before sending to the daemon. This lets callers pass `"file": "src/a.ts"` instead of `"file": "/workspaces/project/src/a.ts"`.

- [ ] **AC3: Daemon connection errors.** Given the daemon is not running and auto-spawn fails (e.g. no project at the workspace path), the CLI prints a JSON error to stdout (`{ "status": "error", "error": "DAEMON_STARTING", "message": "..." }`) and exits with code 1. Given the daemon is running but returns an error response, the CLI prints that response verbatim and exits with code 1.

- [ ] **AC4: Invalid JSON input.** Given malformed JSON as the positional argument or on stdin, the CLI prints `{ "status": "error", "error": "VALIDATION_ERROR", "message": "Invalid JSON: ..." }` to stdout and exits with code 1.

## Interface

### CLI syntax

```
light-bridge [--workspace <path>] <operation> [json-string]
```

- `--workspace` defaults to cwd (inherited from parent command, same as today)
- `<operation>` is kebab-case: `rename`, `move-file`, `move-directory`, `move-symbol`, `extract-function`, `find-references`, `get-definition`, `get-type-errors`, `search-text`, `replace-text`, `delete-file`
- `[json-string]` is optional positional arg; if absent and stdin is not a TTY, read from stdin

### Subcommand → daemon method mapping

Kebab-case subcommand names map to camelCase daemon method names: `move-file` → `moveFile`, `find-references` → `findReferences`, etc. The mapping is mechanical (split on `-`, camelCase-join).

### JSON input

Keys match the Zod schema field names exactly (camelCase): `file`, `line`, `col`, `newName`, `oldPath`, `newPath`, `sourceFile`, `destFile`, `symbolName`, `pattern`, `replacement`, `glob`, `edits`, `checkTypeErrors`, `force`, `context`, `maxResults`, `startLine`, `startCol`, `endLine`, `endCol`, `functionName`.

Path-valued keys (`file`, `oldPath`, `newPath`, `sourceFile`, `destFile`) are resolved to absolute paths against the workspace root if not already absolute.

### JSON output

Identical to the daemon's response — same shape as MCP responses. The CLI adds nothing and removes nothing.

```jsonc
// success
{ "status": "success", "filesModified": [...], ... }

// warn (type errors after write)
{ "status": "warn", "filesModified": [...], "typeErrors": [...], ... }

// error
{ "status": "error", "error": "VALIDATION_ERROR", "message": "..." }
```

### Exit codes

- `0` — `status` is `"success"` or `"warn"`
- `1` — `status` is `"error"`, or CLI-level failure (bad JSON, daemon unreachable)

### Empty/zero cases

- No JSON arg and stdin is a TTY → print usage help for that subcommand and exit 1
- Empty JSON object `{}` → forwarded to daemon; Zod validation will reject missing required fields and the daemon's `VALIDATION_ERROR` response is printed

### Adversarial cases

- Paths with spaces, unicode, symlinks → handled by existing `isWithinWorkspace` + `validateFilePath` in the daemon dispatcher; the CLI just forwards
- Extremely large JSON input → no explicit cap; bounded by socket buffer and daemon timeout (30s default)

## Decisions

### Kebab-case subcommands (resolved)

**Chosen:** Kebab-case CLI subcommands (`move-file`, `find-references`) mapped to camelCase daemon methods. Standard CLI convention; the mapping is a trivial string transform. Human-friendly flags can layer on top of these subcommands later without changing the command names.

### JSON params over flags (resolved)

**Chosen:** Single JSON positional argument (or stdin). Agents already construct JSON for MCP calls — same mental model. Eliminates flag naming conventions, handles complex nested params (`replaceText.edits`), and keeps the CLI layer trivially thin. Human-friendly `--flag` interfaces can be added later as syntactic sugar that constructs the same JSON.

## Security

- **Workspace boundary:** N/A at CLI layer — the CLI forwards JSON to the daemon, which enforces all path validation and workspace boundary checks. No new file I/O in the CLI adapter.
- **Sensitive file exposure:** N/A — the CLI does not read file contents; it passes params through.
- **Input injection:** The JSON string is parsed with `JSON.parse` and forwarded as a structured object over the Unix socket. No shell interpolation, no path concatenation. The daemon's Zod validation and `validateFilePath` handle malicious values.
- **Response leakage:** The CLI prints the daemon's response verbatim. The daemon already controls what goes into responses (no raw file contents in error messages). No new leakage surface.

## Edges

- The CLI must not import engine code — it only talks to the daemon via socket. This keeps the CLI startup fast (no ts-morph, no Volar).
- `--workspace .` must work (resolved to cwd, same as `daemon`/`serve`/`stop`).
- Operations that have no required path params (`searchText`, `replaceText`, `getTypeErrors`) still need the workspace for `ensureDaemon` and `callDaemon` — they get it from `--workspace`.
- The `checkTypeErrors` field in the JSON input is forwarded as-is; the daemon handles the default (`true` when absent).

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score >= threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
      - `docs/features/cli.md` — add operation subcommands section, remove "out of scope" note about direct CLI invocation
      - `docs/features/README.md` — update "All tools are invoked through the MCP server" to mention CLI subcommands
      - `README.md` — add CLI usage examples
      - `docs/handoff.md` current-state section — add `cli/operations.ts` to layout
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Tests added:** 5 integration tests (end-to-end rename, relative path resolution, daemon error exit, invalid JSON, empty stdin).

**Mutation score:** Not yet run for operations.ts.

**Reflection:**

The execution agent was dispatched for AC1 and produced a working-but-flawed implementation (74 tool calls, 3 discarded test strategies). Issues it missed: bare `exitOverride()` inconsistent with existing pattern, no output on missing input, no daemon error handling, `require()` in ESM test. These are judgment calls — matching codebase patterns, anticipating edge cases — that the "write failing test → make it pass" loop doesn't catch. The main conversation fixed the code directly. A P1 handoff entry was added to address the execution agent quality problem systemically.

AC2 (relative path resolution) was folded into the same module since it's a 5-line addition to the action handler. AC3 (daemon errors) and AC4 (invalid JSON) were similarly trivial — all four ACs landed in one module.

Discovered a pre-existing flaky test (`stop.integration.test.ts` timeout) — added to handoff as P1.
