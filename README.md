# weaver

A refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

> **Experimental.** This project is in active development. The goal is deterministic, token-reducing refactoring for AI agents through compiler-driven semantics, drawing inspiration from IDE integration patterns. Core operations are stable and tested, but some features remain incomplete or will evolve as we explore better approaches.

AI agents can read and write files, but cross-file refactoring is expensive. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. weaver removes that burden — the agent issues an intent, weaver handles the cascade, and the agent gets back a semantic summary without ever seeing the raw diffs.

**[Why weaver?](docs/why.md)** — speed, determinism, and context efficiency; how it fits into the AI coding ecosystem.

## How it works

**Daemon** — a long-lived process that loads the project graph into memory and watches the filesystem for changes. It stays alive between agent sessions so the engine is always warm. Start it once; it handles the rest.

**CLI subcommands** (`weaver rename '...'`) — the primary interface. Each subcommand connects to the running daemon (auto-spawning if needed) and prints the JSON response to stdout. Any agent that can shell out can use weaver.

**MCP server** (`weaver serve`) — an alternative transport for agent hosts that support MCP. A thin stdio process that connects to the same daemon and exposes the same operations as MCP tools.

The underlying language intelligence comes from ts-morph (pure TypeScript projects) and Volar (projects containing Vue files), covering both `.ts` and `.vue` files in a unified project graph.

## Installation

```bash
pnpm add -D @yearofthedan/weaver@alpha
# or
npm install -D @yearofthedan/weaver@alpha
```

Or install from GitHub for unreleased builds:

```bash
pnpm add -D github:yearofthedan/weaver
```

## CLI Commands

### `weaver daemon`

Start the daemon for a workspace. Loads the project graph, starts the filesystem watcher, and listens for connections from `serve` instances.

```bash
weaver daemon --workspace /path/to/project
```

Output (stderr):

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

The daemon runs until terminated with SIGTERM or SIGINT. It does not exit when agent sessions end.

### `weaver serve`

Start the MCP server for an agent session. Connects to the running daemon (spawning it if needed) and accepts tool calls over stdio.

```bash
weaver serve --workspace /path/to/project
```

Output (stderr):

```json
{ "status": "ready", "workspace": "/absolute/path/to/project" }
```

Terminates cleanly on SIGTERM. The daemon continues running after the session ends.

### `weaver stop`

Stop a running daemon for a workspace.

```bash
weaver stop --workspace /path/to/project
```

Output (stdout):

```json
{ "ok": true, "stopped": true }
```

## Operations

All operations are available as both CLI subcommands and MCP tools. The CLI uses kebab-case (`move-file`); MCP uses camelCase (`moveFile`).

```bash
weaver rename '{"file": "src/a.ts", "line": 5, "col": 3, "newName": "bar"}'
weaver move-file '{"oldPath": "src/old.ts", "newPath": "src/new.ts"}'
weaver find-references '{"file": "src/a.ts", "line": 10, "col": 5}'
```

Path params can be relative (resolved against `--workspace` or cwd). The daemon auto-spawns if not already running. Exit code is `0` for success/warn, `1` for errors.

| Operation | TS | Vue | Read-only | Notes |
|---|---|---|---|---|
| `rename` | ✓ | ✓ | no | Renames a symbol at a given position; updates every reference project-wide |
| `move-file` | ✓ | ✓ | no | Moves a file; rewrites all import paths that reference it |
| `move-directory` | ✓ | ✓ | no | Moves an entire directory; rewrites all imports across the project |
| `move-symbol` | ✓ | ✓* | no | Moves a named export to another file; updates all importers |
| `delete-file` | ✓ | ✓† | no | Deletes a file; removes every import and re-export of it across the workspace |
| `extract-function` | ✓ | — | no | Extracts a selected block of statements into a new named function at module scope |
| `find-importers` | ✓ | ✓ | yes | Returns every file that imports a given file |
| `find-references` | ✓ | ✓ | yes | Returns every reference to the symbol at a given position |
| `get-definition` | ✓ | ✓ | yes | Returns definition location(s) for the symbol at a given position |
| `get-type-errors` | ✓ | — | yes | Returns type errors for a single file or whole project (capped at 100) |
| `search-text` | n/a | n/a | yes | Regex search across workspace files with optional glob/context controls |
| `replace-text` | n/a | n/a | no | Regex replace-all (pattern mode) or exact-position edits (surgical mode) |

Write operations return `filesModified` and `filesSkipped` (files outside the workspace boundary that were not touched). Type errors in modified files are checked automatically and returned in the response (`typeErrors`, `typeErrorCount`); pass `checkTypeErrors: false` to suppress.

\* `moveSymbol` supports moving exports from `.ts`/`.tsx` sources inside Vue workspaces and updates `.vue` importers in a post-step. Moving symbols from a `.vue` source file is still pending.

† `deleteFile` removes imports and re-exports from `.ts`/`.tsx`/`.js`/`.jsx` files (via ts-morph) and Vue SFC `<script>` blocks (via regex scan).

## Response format

Every response contains a `status` field: `"success"`, `"warn"`, or `"error"`.

```json
{
  "status": "success",
  "filesModified": ["src/utils/math.ts", "src/index.ts"]
}
```

`"warn"` means the operation completed but left type errors — check `typeErrors` in the response:

```json
{
  "status": "warn",
  "filesModified": ["src/utils/math.ts"],
  "typeErrorCount": 2,
  "typeErrors": [...]
}
```

On failure:

```json
{
  "status": "error",
  "error": "SYMBOL_NOT_FOUND",
  "message": "Could not find symbol at line 5, column 10"
}
```

## Error codes

- `VALIDATION_ERROR` — invalid command arguments
- `FILE_NOT_FOUND` — source file does not exist
- `SYMBOL_NOT_FOUND` — symbol not found at specified position
- `RENAME_NOT_ALLOWED` — symbol cannot be renamed (e.g. built-in types)
- `NOT_SUPPORTED` — requested operation shape is not supported
- `WORKSPACE_VIOLATION` — path is outside the workspace boundary
- `SENSITIVE_FILE` — operation attempted on a blocked sensitive file
- `TEXT_MISMATCH` — surgical replace precondition failed (`oldText` mismatch)
- `PARSE_ERROR` — malformed request payload or invalid regex
- `REDOS` — unsafe regex rejected
- `NOT_A_DIRECTORY` — path exists but is not a directory
- `DESTINATION_EXISTS` — destination directory already exists and is non-empty
- `MOVE_INTO_SELF` — destination is inside the source directory
- `INTERNAL_ERROR` — unexpected server-side failure
- `DAEMON_STARTING` — daemon is still initialising; retry the tool call

## When NOT to use this

weaver is a specialised tool. Use the right tool for the job:

| Alternative | Use instead when… | weaver wins when… |
|---|---|---|
| Base agent tools (grep, read/write) | The change is in one file, or the agent's context window can hold everything comfortably | The change fans out across many files; missing one import breaks the build |
| Claude's built-in `typescript-lsp` plugin | You only need diagnostics and navigation (jump to definition, find references) | You need to *apply* structural changes (rename, move, extract) — the two complement each other, not compete |
| IntelliJ MCP | You're already running IntelliJ and want the full IDE refactoring suite | You're in a devcontainer, CI, or remote environment where a GUI IDE isn't available |

See [docs/why.md](docs/why.md) for a broader look at where weaver fits in the AI coding ecosystem.

## Agent integration

Any agent that can run shell commands can use weaver — no MCP required. This makes it work in environments like Claude Code (desktop and web), Roo Code, Cursor, and CI pipelines.

### Using the CLI

Install weaver as a dev dependency, then call it from your agent's shell:

```bash
npx @yearofthedan/weaver rename '{"file": "src/a.ts", "line": 5, "col": 3, "newName": "bar"}'
```

The daemon auto-spawns on the first call and stays warm for subsequent operations. No configuration needed.

### Using MCP (optional)

For agent hosts that support MCP, weaver also exposes the same operations via `weaver serve`. Add a `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "weaver": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yearofthedan/weaver", "serve", "--workspace", "."]
    }
  }
}
```

### Skill files

weaver ships skill files that teach agents *when* to reach for each operation — not just what it does. These work with both CLI and MCP usage.

| Skill | Covers | Path in package |
|---|---|---|
| `search-and-replace` | `search-text`, `replace-text` | `.claude/skills/search-and-replace` |
| `move-and-rename` | `rename`, `move-file`, `move-directory`, `move-symbol`, `delete-file`, `extract-function` | `.claude/skills/move-and-rename` |
| `code-inspection` | `find-references`, `get-definition`, `get-type-errors` | `.claude/skills/code-inspection` |

**Install with the [skills CLI](https://github.com/vercel-labs/skills)**, which works across multiple agents:

```bash
npx skills add yearofthedan/weaver
```

Or reference them manually from your agent's configuration (e.g. `CLAUDE.md` for Claude Code):

```markdown
## Refactoring

Load the weaver skills for compiler-aware refactoring guidance:
see `node_modules/@yearofthedan/weaver/.claude/skills/search-and-replace`
see `node_modules/@yearofthedan/weaver/.claude/skills/move-and-rename`
see `node_modules/@yearofthedan/weaver/.claude/skills/code-inspection`
```

### Notes
- The daemon auto-spawns on first call if not already running. For faster first-call response, start it manually: `weaver daemon --workspace /path/to/project`.
- One daemon per workspace. It keeps running between agent sessions.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build, test, and project structure.
