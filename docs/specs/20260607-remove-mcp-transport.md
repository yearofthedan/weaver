# Remove MCP transport — CLI-only

**type:** change
**date:** 2026-06-07
**tracks:** handoff.md # Drop the MCP transport — go CLI-only → docs/internals/mcp-transport.md (to be deleted), docs/architecture.md

---

## Context

weaver currently ships two transports over the same persistent daemon: the CLI operation subcommands and an MCP server (`weaver serve`). Both are thin forwarders to `callDaemon` — the MCP path adds nothing the CLI lacks, while costing a dependency (`@modelcontextprotocol/sdk`), an `instructions`/tool-schema payload that consumes agent context, and a second surface to maintain. Following the [Playwright agent-cli](https://playwright.dev/agent-cli/introduction) model, we remove MCP and keep a single thin CLI over the warm daemon. The skills installer (separate `[needs design]` entry) is the natural next step but is out of scope here.

## User intent

*As an AI coding agent with shell access, I want weaver's refactoring operations exposed solely through a thin CLI over the persistent daemon, so that I don't pay the token cost of MCP tool schemas and the project ships one transport instead of two — with no loss of capability, guidance, or security guarantees.*

## Relevant files

- `src/adapters/cli/cli.ts` — entry point; remove the `serve` command and the `runServe` import.
- `src/adapters/cli/operations.ts` — re-point the `classify-error` import to its new location; add per-subcommand `--help` param breakdown rendered from the Zod schemas.
- `src/adapters/schema.ts` — currently **zero** `.describe()` calls; receives the 47 parameter descriptions relocated from `tools.ts`, and becomes the single source for `--help` rendering. Each op schema (`RenameArgsSchema`, etc.) is exported here.
- `src/adapters/mcp/mcp.ts` — MCP server + `runServe` + the `instructions` blurb (cross-cutting agent guidance to migrate). **Delete** after migration.
- `src/adapters/mcp/tools.ts` — `TOOLS` table: per-tool behavioural descriptions + 47 per-param `.describe()` strings. **Delete** after migration (behavioural → skills, param text → `schema.ts`). `TOOL_NAMES`/`TOOLS` have no non-MCP consumers.
- `src/adapters/mcp/classify-error.ts` + `classify-error.test.ts` — **not** MCP-specific (the CLI's `operations.ts` is its only consumer). Move to `src/adapters/cli/`.
- `src/adapters/mcp/security.integration.test.ts` — workspace-boundary + injection guards. **Port** to a CLI integration test (see AC3) before the folder is deleted.
- `src/adapters/mcp/call-daemon-timeout.integration.test.ts` — tests `callDaemon` (a daemon concern, not MCP). **Relocate** to `src/daemon/`.
- `src/adapters/mcp/{rename,move-file,move-symbol,get-definition,find-references}.integration.test.ts` — per-operation MCP transport tests. **Delete** (the operations have their own unit/integration coverage; the CLI transport is operation-agnostic and proven by `operations.test.ts`).
- `src/adapters/mcp/run-serve.integration.test.ts` — tests `runServe`. **Delete** with `serve`.
- `src/daemon/serve.integration.test.ts` — exercises the MCP `serve` path (`tools/call`). **Remove** the serve/MCP-specific assertions.
- `src/cli-workspace-default.integration.test.ts` — has a `serve` describe block (~line 67) asserting `weaver serve` becomes ready. **Remove** that block.
- `src/__testHelpers__/mcp-helpers.ts` — `McpTestClient`, `useMcpContext`, `parseMcpResult`. **Delete** once no test references it.
- `.claude/skills/{refactor,code-inspection,search-and-replace}/SKILL.md` — canonical agent-discovery surface; receive the behavioural + return-field guidance migrated from `tools.ts`/`mcp.ts`.
- `package.json` — remove `@modelcontextprotocol/sdk` from dependencies and `"mcp"` from `keywords`.
- `README.md` — remove the MCP/`weaver serve` section and the `.mcp.json` snippet (keep the Skills section).
- `docs/architecture.md` — update the Transport subgraph (drop the MCP node) and the dispatch flow (`tool call (MCP)` → CLI); reconcile the "MCP tool names use camelCase" note.
- `docs/internals/mcp-transport.md` — **delete**; remove its references from `docs/handoff.md` (Start-here list + architecture-detail table).
- `docs/agent-users.md` — reconcile any MCP mentions.
- `.mcp.json`, `.cursor/mcp.json` — **delete**.

### Red flags

- No oversized-file smells in the target area. `operations.test.ts` (~137 lines) grows with the new `--help` and ported-security cases — keep the security ports in a **separate** CLI integration test file (`src/adapters/cli/security.integration.test.ts`) rather than swelling `operations.test.ts`.
- `classify-error.ts` is small and pure; its move is mechanical.

**Layer-fit per AC:**
- AC1 — integration smoke (spawn built CLI, assert `serve` unknown) + package/file assertions.
- AC2 — unit (`classifyDaemonError` is a pure function; its test moves with it).
- AC3 — integration (real daemon socket boundary; use existing `spawnAndWaitForReady`/`runCliCommand`).
- AC4 — doc/source migration; verified by diff + existing skill-file checks. The `.describe()` relocation is mechanical and covered by AC5's tests.
- AC5 — unit/integration: `--help` output is rendered from schemas; assert one representative subcommand's help lists its fields with descriptions.

## Value / Effort

- **Value:** Agents stop paying the MCP tool-schema + `instructions` token cost on every session, and get the same operations through a single, simpler surface. Maintainers drop a dependency and a whole transport adapter (8 integration test files, the SDK, two config files). `--help` becomes genuinely useful (param breakdown), which it isn't today. Nothing the agent relies on is lost: guidance moves to its proper home (skills + `--help`), security guarantees are re-proven at the CLI boundary.
- **Effort:** Mostly deletion + relocation, plus two real pieces of new work: porting the security tests to the CLI (AC3) and rendering `--help` from schemas (AC5). No new infrastructure — both build on existing helpers (`spawnAndWaitForReady`, the `schema.ts` Zod schemas, Commander's `addHelpText`).

## Behaviour

- [ ] **`weaver serve` and the MCP server are removed.** `weaver serve` is no longer a registered command — invoking it produces an unknown-command `VALIDATION_ERROR` and exit 1. `@modelcontextprotocol/sdk` is gone from `package.json` dependencies and `"mcp"` from `keywords`. `src/adapters/mcp/mcp.ts`, `tools.ts`, `.mcp.json`, and `.cursor/mcp.json` no longer exist. `weaver daemon`, `weaver stop`, and every operation subcommand continue to work unchanged (proven by existing daemon/operations tests still passing).
  - *Laziest wrong impl:* deleting `mcp.ts` but leaving the `serve` command registered (would crash on a missing import) — the AC requires the command itself to be gone.

- [ ] **`classifyDaemonError` relocates to `src/adapters/cli/` and classifies identically.** `src/adapters/mcp/` ceases to exist; `operations.ts` imports `classifyDaemonError` from `../cli`-local path. Given a connection-refused / `DAEMON_STARTING` socket error, the CLI still maps it to `DAEMON_STARTING`; given an unrecognised error, to `INTERNAL_ERROR`. The relocated unit test passes unchanged (only its import path differs).

- [ ] **Workspace-security guarantees are preserved end-to-end through the CLI.** In a new `src/adapters/cli/security.integration.test.ts`, against a real daemon: (a) `rename` with a `file` outside the workspace → `status:"error"`, `error:"WORKSPACE_VIOLATION"`, exit 1; (b) `moveFile` with `oldPath` **or** `newPath` outside the workspace → `WORKSPACE_VIOLATION`; (c) a relative-segment traversal path (`../../etc/...`) → `WORKSPACE_VIOLATION`; (d) a newline embedded in a file-path param does **not** inject a second daemon command (socket-framing guard) — the request errors and a subsequent valid request still succeeds; (e) a non-identifier `newName` is rejected. The `call-daemon-timeout` test is relocated to `src/daemon/` and still passes.
  - *Type matrix:* both input path params of `moveFile` (`oldPath`, `newPath`) are tested, not just one.

- [ ] **No agent-facing guidance is lost; each kind goes to its proper home.** Per-tool *behavioural* guidance and *return-field* semantics from `tools.ts`/`mcp.ts` — when to reach for each op, `filesModified`/`filesSkipped`, `nameMatches`, `force`/`SYMBOL_EXISTS`, `truncated`, the `DAEMON_STARTING` retry, and the `typeErrors`/`typeErrorCount`/`typeErrorsTruncated`/`status:"warn"` contract, plus "reference graph tracks through re-exports, barrel files, type-only imports, Vue SFCs" — are present in the relevant `.claude/skills/*/SKILL.md` after the change (added where missing; not duplicated where already covered). The 47 per-parameter `.describe()` strings are relocated from `tools.ts` onto the corresponding fields in `src/adapters/schema.ts`. Skill files remain interface documentation, not playbooks (no "you should do X" prescriptions — see CLAUDE.md).

- [ ] **`weaver <operation> --help` renders the parameter breakdown.** For each operation subcommand, `--help` lists every JSON parameter with its name, type, and one-line description sourced from the `schema.ts` `.describe()` text (e.g. `weaver rename --help` shows `file`, `line`, `col`, `newName`, `checkTypeErrors` with descriptions), in addition to `--workspace`. Exit 0, no JSON error. The standalone P4 "CLI `--help` should break down the JSON params" chore is removed from handoff (folded in here).
  - *Laziest wrong impl:* hard-coding help text per subcommand — the AC requires it to be derived from the schemas so it can't drift.

## Interface

**Removed from the public surface:**
- `weaver serve` command and the MCP server (stdio JSON-RPC).
- `.mcp.json` integration path (documented in README).

**Changed:**
- `weaver <operation> --help` — previously showed only `--workspace`/`-h`; now also prints each JSON param (name, type, description). Output is human-facing help text on stdout, exit 0. Bounds: one block per subcommand, ≤ ~8 params each. Empty case: ops with no params beyond paths still show their path params. Adversarial: `--help` must never spawn a daemon or touch the filesystem.

**Unchanged:**
- Operation subcommand JSON contract (positional JSON arg or stdin), `--workspace` resolution, response shapes, error codes.
- `weaver daemon`, `weaver stop`, daemon auto-spawn (`ensureDaemon`), socket protocol.

## Open decisions

(none — scope, removal style, test-parity, and guidance routing resolved during speccing:)
- **Removal style:** hard removal now (pre-1.0; minimal external MCP adoption).
- **Test parity:** port security + relocate timeout only; drop per-operation MCP transport tests (operations independently covered; CLI transport is operation-agnostic and proven by `operations.test.ts`).
- **Guidance routing:** behavioural/return semantics → skill files; the 47 param `.describe()` strings → `schema.ts`; `--help` rendering folded into this spec (AC5).

## Security

- **Workspace boundary:** No new write paths. Removing a transport reduces attack surface. AC3 re-proves `WORKSPACE_VIOLATION` on out-of-workspace inputs and relative-segment traversal at the CLI→daemon boundary, where MCP previously held that coverage.
- **Sensitive file exposure:** Unchanged — no change to `isSensitiveFile` call sites (`searchText`/`replaceText`).
- **Input injection:** The socket-framing guard (newline in a path must not inject a second daemon command) is explicitly ported to the CLI integration test (AC3d) so the regression guard survives the MCP deletion.
- **Response leakage:** Unchanged — no change to error-message construction; `classifyDaemonError` moves verbatim.

## Edges

- `weaver daemon`, `weaver stop`, `ensureDaemon` auto-spawn, and the socket protocol must remain byte-for-byte compatible — only the transport in front of the daemon is removed.
- `call-daemon-timeout.integration.test.ts` must be **relocated, not deleted** — it covers `callDaemon` (daemon layer), which the CLI still uses.
- After all ports, `src/__testHelpers__/mcp-helpers.ts` must have **zero** importers before deletion (grep to confirm).
- `src/daemon/serve.integration.test.ts` and the `serve` block in `src/cli-workspace-default.integration.test.ts` must lose their MCP/`serve` assertions; keep any daemon-readiness coverage not tied to `serve`.
- `pnpm build` must succeed with no dangling imports to `adapters/mcp/*`.

## Done-when

- [ ] All 5 ACs verified by tests
- [ ] Mutation score ≥ threshold for touched source files (`schema.ts`, relocated `classify-error.ts`, `operations.ts` help rendering)
- [ ] `pnpm check` passes (lint + build + coverage + eval)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md` (security ports go in a new `src/adapters/cli/security.integration.test.ts`, not appended to `operations.test.ts`)
- [ ] Docs updated:
      - `README.md` — MCP/`weaver serve` section and `.mcp.json` snippet removed
      - `docs/architecture.md` — Transport subgraph + dispatch flow + camelCase-tool-names note reconciled
      - `docs/internals/mcp-transport.md` — deleted; references removed from `docs/handoff.md` (Start-here + architecture-detail table)
      - `docs/agent-users.md` — MCP mentions reconciled
      - `.claude/skills/{refactor,code-inspection,search-and-replace}/SKILL.md` — migrated guidance present (AC4)
      - `docs/handoff.md` — current-state section (remove `adapters/mcp/` layout block; update test count); P4 `--help` chore removed; this entry removed
- [ ] `eval/` — confirm the fixture server / promptfoo config doesn't depend on the MCP transport; update if it does
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Non-obvious gotchas recorded (or skipped if none)
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
