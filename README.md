# weaver

A refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

> **Experimental**. This project is in active development. The goal is deterministic, token-reducing refactoring for AI agents through compiler-driven semantics. Core operations are stable and tested, but features will evolve as we explore better agentic patterns.

AI agents can read and write files, but struggle with cross-file structural changes. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. **Weaver** removes that burden. The agent issues an intent, weaver handles the cascade using deterministic compiler-driven resolution, and the agent gets back a semantic summary without ever seeing the raw diffs.

**[Why weaver?](docs/why.md)** — More detail on the thesis of speed, determinism, and context efficiency.

## Installation

```bash
pnpm add -D @yearofthedan/weaver@alpha
# or
npm install -D @yearofthedan/weaver@alpha
```

## How it works

- **Daemon**: A long-lived process that loads the project graph into memory and watches for changes. It stays warm between agent sessions for near-instant responses.
- **CLI**: The primary interface. Subcommands auto-spawn the daemon if needed and return JSON to stdout.
- **MCP Server**: A thin stdio process (`weaver serve`) that connects to the daemon for hosts supporting the Model Context Protocol.

## Agent Integration

### Using the CLI (Recommended)
Any agent with shell access can use **Weaver**. Install it as a dev dependency and call it directly from the agent's shell:

```bash
npx @yearofthedan/weaver rename '{"file": "src/utils.ts", "line": 10, "col": 5, "newName": "calculate"}'
```

The daemon auto-spawns on the first call and stays warm for subsequent operations.

### Using MCP (optional)

For agent hosts that support MCP, **Weaver** also exposes the same operations via `weaver serve`. Add a `.mcp.json` to your project root:

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

**Weaver** ships skill files that teach agents *when* to reach for each operation — not just what it does. These work with both CLI and MCP usage.

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



## Operations
**Weaver** provides a unified project graph across `.ts` and `.vue` files.

**Note:** Command are also available via MCP server. Tool names are in `camelCase` (e.g., `moveFile`).

| CLI Command | Description | Skill | Support |
| :--- | :--- | :--- | :---: |
| `rename` | Renames a symbol and all references project-wide. | `move-and-rename` | TS + Vue |
| `move-file` | Moves a file and rewrites all affected imports. | `move-and-rename` | TS + Vue |
| `move-directory` | Moves a directory and updates imports project-wide. | `move-and-rename` | TS + Vue |
| `move-symbol` | Moves a named export to another file. | `move-and-rename` | TS + Vue* |
| `delete-file` | Deletes a file and removes its references. | `move-and-rename` | TS + Vue† |
| `extract-function` | Extracts a block of code into a module-scope function. | `move-and-rename` | TS |
| `find-importers` | Returns every file that imports a specific file. | `code-inspection` | TS + Vue |
| `find-references` | Returns every reference to a specific symbol. | `code-inspection` | TS + Vue |
| `get-definition` | Returns the definition location(s) for a symbol. | `code-inspection` | TS + Vue |
| `get-type-errors` | Returns current project-wide type errors. | `code-inspection` | TS |
| `search-text` | Regex search across workspace with glob controls. | `search-and-replace` | n/a |
| `replace-text` | Regex replace-all or surgical exact-position edits. | `search-and-replace` | n/a |

\* `moveSymbol` supports moving exports from `.ts` sources and updates `.vue` importers.  
† `deleteFile` cleans up Vue SFC `<script>` blocks via regex scan.


Write operations return `filesModified` and `filesSkipped` (files outside the workspace boundary that were not touched). Type errors in modified files are checked automatically and returned in the response (`typeErrors`, `typeErrorCount`); pass `checkTypeErrors: false` to suppress.

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

## CLI Reference

These commands manage the weaver daemon and server instances.

- `weaver daemon --workspace <path>`: Manually start the daemon for a workspace.
- `weaver stop --workspace <path>`: Stop a running daemon for a workspace.
- `weaver serve --workspace <path>`: Start the MCP stdio server.

### Notes
- The daemon auto-spawns on first call if not already running. For faster first-call response, start it manually: `weaver daemon --workspace /path/to/project`.
- One daemon per workspace. It keeps running between agent sessions.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, build, test, and project structure.
