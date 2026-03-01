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

- [ ] All ACs verified by running `pnpm eval` (the eval IS the end-to-end test)
- [ ] Vitest unit tests cover the fixture daemon's socket protocol (ping, fixture lookup,
      unknown method) — these run under `pnpm test`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `package.json` gains an `eval` script
- [ ] README.md project structure updated with `eval/` entry
- [ ] handoff.md entry removed; current-state section updated with `eval/` in the layout
- [ ] Spec archived to `docs/specs/archive/` with Outcome section
