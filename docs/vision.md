# passed-on — Product Vision

## What it is

passed-on is a refactoring bridge between AI coding agents and the compiler APIs that understand your codebase.

AI agents can read and write files, but cross-file refactoring is expensive for them. Renaming a shared symbol or moving a file means loading every affected file into context, manually patching import paths, and hoping nothing is missed. It is slow, token-heavy, and error-prone.

passed-on removes that burden. An agent issues an intent — rename this symbol, move this file — and passed-on handles the cascade using the same compiler intelligence that powers IDE tooling. The agent gets back a semantic summary of what changed. It never needs to see the raw diffs.

The analogy: IntelliSense does for human developers what passed-on does for agents. A developer *could* manually find and update every reference. IntelliSense makes that unnecessary. passed-on is the same capability, surfaced as an agent tool.

## How it connects

passed-on runs as a background process, launched by the developer as part of their agent setup. It connects to the agent via the Model Context Protocol (MCP) over stdio. This means:

- The engine stays alive for the duration of the agent's session
- The agent calls tools just like any other MCP tool
- No subprocess-per-command overhead

The CLI also supports one-off operations directly from the shell, for scripting and manual use.

## What it does

- **Rename symbol** — rename any TypeScript or Vue symbol at a given file position and update all references project-wide, including across `.ts` and `.vue` file boundaries
- **Move file** — move a file to a new path and update all import statements that reference it

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

## Features — priority tiers

### Now (exists or in active development)
- CLI interface: `rename`, `move`
- TypeScript engine via ts-morph
- Vue SFC engine via Volar
- Zod-validated input
- JSON semantic output

### Next
- MCP server transport (stdio)

### Later
- Additional operations (e.g. extract, inline, move symbol)
- Multi-workspace support
- Post-operation diagnostics — surface type errors on affected files so the agent doesn't need to run a separate lint step
- Post-operation hook system — register scripts (e.g. tests) against the server that run after successful operations and return results in the response

### Unknowns / open questions
- Conflict detection before applying a rename (naming collisions)
