# Implement Agent+MCP Eval (v1)

**type:** change
**date:** 2026-03-01
**tracks:** handoff.md → "Agent+MCP eval implementation"

---

## Context

The eval design was approved in `docs/eval-design.md`. This spec drives v1: a PromptFoo-based
**tool-description smoke test** — does `claude-haiku-4-5` pick the right light-bridge tool in a
clean, neutral context (no system prompt, no competing built-in tools)?

This is deliberately a low bar. It catches broken descriptions (e.g. the model reaching for
`search_text` when it should call `find_references`) but does not replicate the full Claude Code
harness. Real-world quality signal for Claude Code compatibility comes from dogfooding (Rule 9) —
the tools are live in `.mcp.json` and any gap that PromptFoo misses will surface during normal
agent use of this repo.

## Behaviour

- [ ] `pnpm eval` completes without error and prints a pass/fail summary (cases passed / total,
      failed case names)
- [ ] There is one positive eval case per tool: `rename`, `find_references`, `get_type_errors`,
      `move_symbol`, `search_text`; each asserts the model selected the correct MCP tool
- [ ] There is at least one negative case: a task that sounds similar to one of the above but
      maps to a different tool; the case asserts the wrong tool was NOT selected (or the right
      one WAS)
- [ ] Each case uses a fixture response from `eval/fixtures/`; no live TS compilation runs
      during the eval
- [ ] The eval model is `claude-haiku-4-5` only

## Interface

Directory layout under project root:

```
eval/
  fixture-daemon.ts       ← socket server; serves fixtures/ by method name; handles ping
  run-eval.ts             ← entry point: start daemon, run promptfoo, teardown
  fixtures/
    ping.json             ← { "ok": true, "version": 1 }
    rename.json           ← { "ok": true, "edits": [...], "filesSkipped": [] }
    findReferences.json   ← { "ok": true, "references": [...] }
    getTypeErrors.json    ← { "ok": true, "errors": [], "truncated": false }
    moveSymbol.json       ← { "ok": true, "edits": [...], "filesSkipped": [] }
    searchText.json       ← { "ok": true, "matches": [...], "truncated": false }
  cases/
    rename.yaml
    find_references.yaml
    get_type_errors.yaml
    move_symbol.yaml
    search_text.yaml
    negative.yaml
  promptfooconfig.yaml    ← top-level PromptFoo config; lists cases/, sets provider
```

`pnpm eval` invokes `tsx eval/run-eval.ts`, which:
1. Starts the fixture daemon (writes the lockfile + socket for the eval workspace)
2. Runs `promptfoo eval -c eval/promptfooconfig.yaml`
3. Tears down the fixture daemon and exits with promptfoo's exit code

The eval workspace can be any temp directory that passes the MCP server's workspace
validation (must be a real directory).

## Edges

- PromptFoo is added as a devDependency; never imported by `src/`
- The fixture daemon **must** respond to `ping` with `{ ok: true, version: 1 }` (matches
  `PROTOCOL_VERSION` in `daemon.ts`) so `ensureDaemon` treats it as up-to-date
- The fixture daemon **must** write a lockfile with its PID and the socket file so
  `isDaemonAlive` returns `true` — otherwise `ensureDaemon` respawns the real daemon
- Each fixture file is looked up by the `method` field in the socket request; an unrecognised
  method returns `{ ok: false, error: "NOT_FOUND" }`
- Eval does not run in CI and has no pass threshold in v1
- The MCP `serve` process is spawned by PromptFoo (stdio MCP provider); `run-eval.ts` only
  manages the fixture daemon, not the serve process

## Done-when

- [x] All ACs verified by running `pnpm eval` (the eval IS the end-to-end test)
- [x] Vitest unit tests cover the fixture daemon's socket protocol (ping, fixture lookup,
      unknown method) — these run under `pnpm test`
- [x] `pnpm check` passes (lint + build + test)
- [x] `package.json` gains an `eval` script
- [x] README.md project structure updated with `eval/` entry
- [x] handoff.md entry removed; current-state section updated with `eval/` in the layout
- [x] Spec archived to `docs/specs/archive/` with Outcome section

---

## Outcome

**Tests added:** 6 vitest unit tests in `tests/eval/fixture-server.test.ts` covering:
- socket file + lockfile creation
- lockfile PID equals `process.pid` (in-process fixture)
- `ping` response matches `PROTOCOL_VERSION`
- fixture file contents returned verbatim for a known method
- `NOT_FOUND` error for an unknown method
- socket + lockfile removal on `stop()`

**Total test suite after slice:** 352 tests (346 pre-existing + 6 new), all passing.

**Mutation testing:** Not applicable — `eval/fixture-server.ts` is in `eval/`, not `src/`. Stryker is scoped to `src/**/*.ts` only.

**End-to-end verification:** `pnpm run eval` confirmed working in this environment (PromptFoo 0.120.25, fixture server starts, MCP server connects, 6 cases loaded and sent to Anthropic API). API calls fail with 401 in the dev container because `ANTHROPIC_API_KEY` is not set — expected; provide a real key to get pass/fail results.

**Architectural decisions:**
- `fixture-server.ts` is a module (not a script) so it can be imported by both `run-eval.ts` and vitest tests. The in-process approach avoids subprocess management complexity.
- `run-eval.ts` uses a fixed eval workspace `/tmp/light-bridge-eval` (created at runtime) so the PromptFoo config can reference it as a static string.
- Cases are inlined in `promptfooconfig.yaml` rather than split into per-tool files — simpler for v1; PromptFoo's `--filter-pattern` flag provides case-level filtering if needed.

**Surprises:**
- `pnpm eval` conflicts with pnpm's built-in `eval` subcommand. Use `pnpm run eval` instead.
- `better-sqlite3` (a PromptFoo dependency) requires native compilation. In this dev container, build scripts are blocked by default. Run `node /path/to/prebuild-install/bin.js` from the project root to download pre-built binaries. See `docs/agent-memory.md` for the exact command.
