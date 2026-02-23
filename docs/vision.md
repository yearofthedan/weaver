**Purpose:** Product-level overview of what light-bridge is, why it exists, and what's planned next.
**Audience:** Everyone — developers, users, and decision-makers.
**Status:** Current
**Related docs:** [Handoff](handoff.md) (current work), [Features](features/) (operations reference)

---

# light-bridge — Product Vision

## What it is

light-bridge is a refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

AI agents can read and write files, but cross-file refactoring is expensive for them. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. It is slow, token-heavy, and error-prone.

light-bridge removes that burden. An agent issues an intent — rename this symbol, move this file — and light-bridge handles the cascade using the same compiler intelligence that powers IDE tooling. The agent gets back a semantic summary of what changed. It never needs to see the raw diffs.

## How it connects

light-bridge has two layers:

**Daemon** — a long-lived background process that loads the project graph into memory and keeps it warm across sessions. It is launched explicitly by the developer, or auto-spawned on demand when an agent session starts.

**MCP server** (`light-bridge serve`) — a thin process started by the agent host (e.g. Claude, Cursor) for each session. It connects to the running daemon via a local socket, receives tool calls from the agent over stdio, and forwards them to the daemon. If the daemon is still starting, it rejects tool calls immediately with a `DAEMON_STARTING` error so the agent can retry rather than receiving stale results.

The CLI (`daemon` and `serve`) is how both layers are started. All refactoring operations are invoked through the MCP tool interface, not as direct CLI subcommands.

## What it does

- **Rename symbol** — rename any TypeScript or Vue symbol at a given file position and update all references project-wide, including across `.ts` and `.vue` file boundaries
- **Move file** — move a file to a new path and update all import statements that reference it
- **Move symbol** — move a named export from one file to another and update all importers (TypeScript projects; Vue projects currently return `NOT_SUPPORTED`)
- **Find references** — return all references to a symbol by position, without modifying files
- **Get definition** — return the definition location for a symbol by position, without modifying files

Supported file types: `.ts`, `.tsx`, `.js`, `.jsx`, `.vue`

## What it returns

Every operation returns a JSON summary:

```json
{
  "ok": true,
  "filesModified": ["src/components/Button.vue", "src/App.vue"],
  "message": "Renamed 'Button' to 'BaseButton' in 2 files"
}
```

The agent receives confirmation of what changed and where. It does not need to inspect the modified files. Its context window stays clean.

## Shipped

Core architecture is complete: the daemon, MCP server, both engines (TypeScript and Vue), security controls, and all five operations are live.

### Operations

| Operation | TS | Vue | Notes |
|-----------|----|----|-------|
| `rename` | ✓ | ✓ | Renames a symbol at a given position and updates all references project-wide |
| `moveFile` | ✓ | ✓ | Moves a file and rewrites all import paths that reference it |
| `moveSymbol` | ✓ | — | Moves a named export from one file to another; Vue projects return `NOT_SUPPORTED` (router constraint, not a Volar limitation — see `docs/features/moveSymbol.md`) |
| `findReferences` | ✓ | ✓ | Read-only; returns all references to a symbol by file position |
| `getDefinition` | ✓ | ✓ | Read-only; returns the definition location(s) for a symbol by file position |

### Infrastructure

- **Daemon** — long-lived process per workspace; loads the project graph once and keeps it warm across sessions
- **MCP server** (`light-bridge serve`) — thin stdio client; auto-spawns the daemon if none is running; forwards tool calls over a local Unix socket
- **CLI** — `daemon` and `serve` subcommands; all refactoring operations are invoked through the MCP server
- **Security** — workspace boundary enforced at both dispatcher (input) and engine (output) layers; see `docs/security.md`
- **CI** — `pnpm check` (biome + build + 125 tests) runs on push/PR to main

## Next work

Evaluated against the same bar: does the daemon's stateful engine make this meaningfully better than the agent editing directly?

- **Filesystem watcher** — the daemon's in-memory project graph goes stale if files are edited outside light-bridge (e.g. in an editor, via `git checkout`). Use chokidar to watch the workspace; debounce at ~200 ms; invalidate the affected engine on change. Design notes in `docs/handoff.md`.
- **Lazy engine initialisation** — the daemon currently warms both TS and Vue engines at startup regardless of project type. Engines should initialise on first use; the dispatcher already selects the correct engine per workspace so the change is deferring `warmupEngine()` until the first request arrives.
- **`findReferences` by file path** — "who imports this file?" is a different question from "who uses this symbol?". Options: union references across all exports; use `getEditsForFileRename` as a dry-run proxy; scan import strings via the module resolver. Warrants a separate design pass.
- **`extractFunction`** — pull a selection into a named function, updating the call site
- **`inlineVariable` / `inlineFunction`** — collapse a trivially-used binding
- **`deleteFile`** — remove a file and clean up its imports in referencing files
- **`createFile`** — scaffold a file with correct import paths inferred from its location
- **`moveSymbol` for Vue projects** — currently `NOT_SUPPORTED`; path to fixing: for `.ts`→`.ts` in a Vue project, delegate to `TsEngine` then run `updateVueImportsAfterMove` to catch `.vue` import strings; for `.vue` source, use `@vue/compiler-sfc`'s `parse()` to locate and splice the `<script>` block (already a transitive dep, no new dependency needed)
- **Rollback / `--dry-run`** — multi-file operations have no all-or-nothing guarantee; documented precondition is a clean git working tree. A `--dry-run` flag returning the full changeset without applying it would let the caller verify before committing.
