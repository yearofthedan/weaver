# Feature: MCP Transport

## What it does

Exposes passed-on's refactoring tools via the Model Context Protocol over stdio, keeping the engine alive for the duration of an agent session.

## How it works

- Server process is launched with the workspace root as a CLI argument
- Project is parsed into memory on startup
- Agent calls tools over stdio for the session lifetime
- Server shuts down when the session ends

## Tool interface

Tools use position-based parameters, consistent with the LSP standard:

- `rename(file, line, col, newName)`
- `move(oldPath, newPath)`

## Response contract

Every tool call returns a JSON object. The agent should be able to act on the response without reading any modified files.

Success:
```json
{
  "ok": true,
  "filesModified": ["path/to/file.ts"],
  "message": "Human-readable summary of what changed"
}
```

Failure:
```json
{
  "ok": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description of the problem"
}
```

The agent receives confirmation of what changed and where. It does not need to inspect the files.

## Assumptions

- One server instance per agent session
- Workspace root is known at startup
- Agent session lifetime equals server process lifetime

## Out of scope

- Multiple concurrent sessions — requires session isolation or AST locking, which is a different product
- Multi-workspace — requires multiple project instances and a routing layer; revisit once single-workspace is proven
- Non-stdio transports (HTTP, SSE) — no current consumer; revisit if the use case emerges

## TBD

- Startup UX: whether the slow initial parse needs a progress signal back to the agent
- Security review (deferred)
