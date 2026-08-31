# weaver

A refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

AI agents can read and write files, but struggle with cross-file structural changes. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. **Weaver** removes that burden. The agent issues an intent, weaver handles the cascade using deterministic compiler-driven resolution, and the agent gets back a semantic summary without ever seeing the raw diffs.

**[Why weaver?](docs/why.md)** — the thesis: speed, determinism, context efficiency.

## Install

```bash
pnpm add -D @yearofthedan/weaver
# or
npm install -D @yearofthedan/weaver
```

Requires Node.js 22+. Supports `.ts`, `.tsx`, `.js`, `.jsx`, and `.vue` (Vue support requires Volar; auto-detected).

## Try it

Rename a symbol everywhere it's used — including across `.vue` files — in one call:

```bash
npx @yearofthedan/weaver rename '{"file": "src/utils.ts", "line": 10, "col": 5, "newName": "calculateTotal"}'
```

Response (stdout):

```json
{
  "status": "success",
  "filesModified": ["src/utils.ts", "src/main.ts", "src/components/Total.vue"],
  "filesSkipped": []
}
```

The first call auto-spawns a daemon for the workspace and warms it. Subsequent calls reuse the warm daemon.

## Commands

Full per-command reference: [`docs/commands/`](docs/commands/). Common shape: each command takes a JSON argument (or stdin) and returns JSON.

| Category | Commands |
| --- | --- |
| Refactor | [`rename`](docs/commands/rename.md) · [`move-file`](docs/commands/move-file.md) · [`move-directory`](docs/commands/move-directory.md) · [`move-symbol`](docs/commands/move-symbol.md) · [`delete-file`](docs/commands/delete-file.md) · [`extract-function`](docs/commands/extract-function.md) · [`set-export`](docs/commands/set-export.md) |
| Inspect | [`find-references`](docs/commands/find-references.md) · [`find-importers`](docs/commands/find-importers.md) · [`get-definition`](docs/commands/get-definition.md) · [`get-type-errors`](docs/commands/get-type-errors.md) |
| Search | [`search-text`](docs/commands/search-text.md) · [`replace-text`](docs/commands/replace-text.md) |
| Lifecycle | [`daemon`](docs/commands/daemon.md) · [`stop`](docs/commands/stop.md) |

Shared conventions: [response format](docs/reference/response-format.md) · [error codes](docs/reference/error-codes.md).

## Agent integration

### CLI

Any agent with shell access can call weaver directly. Install as a dev dependency, then invoke any command with a single JSON argument:

```bash
npx @yearofthedan/weaver move-file '{"oldPath": "src/old.ts", "newPath": "src/new.ts"}'
```

The daemon auto-spawns on the first call and stays warm for subsequent operations.

### Skills

Weaver ships skill files that teach agents *when* to reach for each operation. After installing the package, copy them into your project's skills directory:

```bash
npx @yearofthedan/weaver skills install
```

This copies the skills shipped with your installed version into `.claude/skills/` (override the location with `--dir`, overwrite local edits with `--force`). Because the skills come from the installed package, they always match your weaver version.

Or reference them manually from your agent's configuration (e.g. `CLAUDE.md`):

```markdown
## Refactoring
see `node_modules/@yearofthedan/weaver/.claude/skills/weaver-refactor`
see `node_modules/@yearofthedan/weaver/.claude/skills/weaver-code-inspection`
see `node_modules/@yearofthedan/weaver/.claude/skills/weaver-search-and-replace`
```

## Documentation

- [`docs/`](docs/README.md) — full doc index by role.
- [`docs/why.md`](docs/why.md) — what weaver is and why.
- [`docs/commands/`](docs/commands/) — per-command reference.
- [`docs/internals/`](docs/internals/) — implementation details and design decisions.
- [`docs/architecture.md`](docs/architecture.md) — provider/operation/dispatcher design.

## Security

To report a vulnerability, see [`SECURITY.md`](SECURITY.md). Threat model and controls are in [`docs/security.md`](docs/security.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
