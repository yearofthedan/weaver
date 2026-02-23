**Purpose:** Threat model and security controls for the light-bridge MCP server.
**Audience:** Security reviewers, developers implementing file operations, anyone touching workspace boundary logic.
**Status:** Current
**Related docs:** [Quality](quality.md) (reliability), [Features](features/) (per-operation constraints)

---

# Security

Threat model, controls, and known limitations for the light-bridge MCP server.

## Threat model

The primary actor is an **AI coding agent** running in a dev container, communicating with the MCP server over stdio. The agent is trusted but may be manipulated via prompt injection from source-file content (see below). The MCP server runs as the same user as the agent — there is no privilege boundary inside the container.

The key invariant we enforce: **the MCP server may only read and write files within the declared workspace directory.** Files outside the workspace (system files, other projects, secrets) must not be touched regardless of what the agent sends.

---

## Controls

### 1. Input path validation (daemon layer)

`src/workspace.ts` — `isWithinWorkspace(filePath, workspace)`

All file paths supplied by the agent (`file`, `oldPath`, `newPath`) are validated before the engine is called. Validation:
- Resolves to absolute path via `path.resolve()`
- Checks that `path.relative(workspace, abs)` does not start with `..`
- For existing paths, re-checks using `fs.realpathSync()` to catch symlink escapes

Violations return `{ ok: false, error: "WORKSPACE_VIOLATION", message: "..." }` and the engine is never called.

### 2. Output path enforcement (engine layer)

The TypeScript language service may compute import rewrites in files that are in the project graph (via tsconfig `include`) but physically outside the workspace directory. Both engines enforce the workspace boundary before writing each affected file:

- **`ts-engine` `rename`**: dirty source files are saved individually via `sf.save()`. Files outside the workspace are not saved and appear in `filesSkipped`.
- **`ts-engine` `moveFile`**: uses `languageService.getEditsForFileRename()` directly (not `sourceFile.move()`) to get per-file control before any disk write. Files outside the workspace are skipped.
- **`vue-engine` `rename` / `moveFile`**: files are written in a loop; out-of-workspace files are skipped before `fs.writeFileSync`.

Skipped files are returned to the agent in `result.filesSkipped` so it has visibility.

### 3. `newName` identifier validation (MCP layer)

`serve.ts` validates `newName` against `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/` at the MCP input schema level, consistent with `schema.ts`. Invalid identifiers are rejected before reaching the daemon.

### 4. JSON framing integrity (wire protocol)

The daemon uses newline-delimited JSON over a Unix socket. All values are serialised with `JSON.stringify`, which escapes embedded newlines (`\n` → `\\n`). A malicious file path containing a newline cannot inject a second JSON command into the framing. Covered by regression test in `tests/mcp/security.test.ts`.

### 5. No shell execution of agent input

`spawnDaemon` in `serve.ts` uses `spawn(cmd, args)` with an argument array and no `shell: true`. Agent-supplied values never reach a shell.

### 6. Unix socket access control

The daemon socket path is derived from a hash of the workspace path (`src/daemon/paths.ts`). Access is governed by OS filesystem permissions — only processes running as the same user can connect. No authentication beyond that is implemented, which is appropriate for a single-user dev container.

### 7. Workspace root validation (daemon startup)

`src/workspace.ts` — `validateWorkspace(workspacePath)`

At daemon startup, the declared workspace path is checked against a hardcoded blocklist of system directories (`/`, `/etc`, `/usr`, `/var`, `/bin`, …) and user credential directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.azure`). Symlinks are resolved via `fs.realpathSync()` before the check, preventing indirect access through an innocuous-looking symlink target.

A misconfigured or malicious MCP client config pointing the daemon at one of these paths is rejected at startup with `VALIDATION_ERROR` before any file operations are attempted.

---

## Known limitations

### Prompt injection via outbound content

The response `message` field includes `symbolName` (taken from `target.getText()` in the source file) and file paths. If a source file contains a symbol with a prompt-injection payload as its name (e.g. `IGNORE_PREVIOUS_INSTRUCTIONS…`), that string will appear in the MCP response the agent receives. This is the general LLM prompt-injection problem; it is not a bug in this codebase but is worth noting as a design-level risk.

Mitigations outside scope of this project: agent-side sandboxing, response sanitisation at the MCP host layer.

### Vue scan does not enforce workspace boundary

`updateVueImportsAfterMove` in `src/engines/vue/scan.ts` rewrites `.vue` imports after a move by scanning the project root directory. Its search root is clamped to `path.dirname(tsconfig)`, which is within the workspace when the tsconfig is in the workspace. If a tsconfig is placed outside the workspace (unusual), the scan could reach outside. No fix currently; tracked in `docs/tech/tech-debt.md`.

### Sensitive file detection not yet implemented

The current operations (rename, moveFile, moveSymbol, findReferences, getDefinition) work on AST nodes and do not expose raw file content, so the risk of leaking secrets is low. However, planned text search/replace operations will read and return file content. When those are added, a sensitive file pattern blocklist (`.env`, `*.pem`, `id_rsa`, cloud credential files, etc.) should be enforced before returning any content — similar to the approach used in grepika's `security.rs`. This is a prerequisite for the text search/replace slice, not a nice-to-have.

### No rate limiting or request size limits

The daemon socket has no limit on request size or request rate. A misbehaving agent could send very large payloads or flood the socket. Acceptable for a single-user dev container; would need addressing for multi-tenant deployments.
