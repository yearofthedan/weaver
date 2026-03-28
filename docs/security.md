**Purpose:** Threat model and security controls for the weaver MCP server.
**Audience:** Security reviewers, developers implementing file operations, anyone touching workspace boundary logic.
**Status:** Current
**Related docs:** [Quality](quality.md) (reliability), [Features](features/) (per-operation constraints)

---

# Security

Threat model, controls, and known limitations for the weaver MCP server.

## Threat model

The primary actor is an **AI coding agent** running in a dev container, communicating with the MCP server over stdio. The agent is trusted but may be manipulated via prompt injection from source-file content (see below). The MCP server runs as the same user as the agent — there is no privilege boundary inside the container.

The key invariant we enforce: **the MCP server may only read and write files within the declared workspace directory.** Files outside the workspace (system files, other projects, secrets) must not be touched regardless of what the agent sends.

---

## Controls

### 1. Input path validation (daemon layer)

`src/security.ts` — `isWithinWorkspace(filePath, workspace)`

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

`schema.ts` defines `newName` as `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`, and `mcp.ts` reuses that schema for MCP tool registration. Invalid identifiers are rejected before reaching the daemon.

### 4. JSON framing integrity (wire protocol)

The daemon uses newline-delimited JSON over a Unix socket. All values are serialised with `JSON.stringify`, which escapes embedded newlines (`\n` → `\\n`). A malicious file path containing a newline cannot inject a second JSON command into the framing. Covered by regression test in `tests/mcp/security.test.ts`.

### 5. No shell execution of agent input

`spawnDaemon` in `mcp.ts` uses `spawn(cmd, args)` with an argument array and no `shell: true`. Agent-supplied values never reach a shell.

### 6. Unix socket access control

The daemon socket path is derived from a hash of the workspace path (`src/daemon/paths.ts`). Access is governed by OS filesystem permissions — only processes running as the same user can connect. No authentication beyond that is implemented, which is appropriate for a single-user dev container.

### 7. Workspace root validation (daemon startup)

`src/security.ts` — `validateWorkspace(workspacePath)`

At daemon startup, the declared workspace path is checked against a hardcoded blocklist of system directories (`/`, `/etc`, `/usr`, `/var`, `/bin`, …) and user credential directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.azure`). Symlinks are resolved via `fs.realpathSync()` before the check, preventing indirect access through an innocuous-looking symlink target.

A misconfigured or malicious MCP client config pointing the daemon at one of these paths is rejected at startup with `VALIDATION_ERROR` before any file operations are attempted.

---

## Known limitations

### Prompt injection via outbound content

The response `message` field includes `symbolName` (taken from `target.getText()` in the source file) and file paths. If a source file contains a symbol with a prompt-injection payload as its name (e.g. `IGNORE_PREVIOUS_INSTRUCTIONS…`), that string will appear in the MCP response the agent receives. This is the general LLM prompt-injection problem; it is not a bug in this codebase but is worth noting as a design-level risk.

Mitigations outside scope of this project: agent-side sandboxing, response sanitisation at the MCP host layer.

### Vue scan is regex-based (not semantic)

`updateVueImportsAfterMove` in `src/providers/vue-scan.ts` rewrites `.vue` imports after a move using import-string regexes. It enforces workspace boundaries before write, but it does not use semantic binding analysis like compiler-powered edits.

### 8. Sensitive file blocklist (`searchText` / `replaceText`)

`src/security.ts` — `isSensitiveFile(filePath)`

`searchText` and `replaceText` read raw file content and must never expose secrets. Before reading any file, both operations call `isSensitiveFile` which blocks:

- **`.env` variants** — `.env`, `.env.local`, `.env.production`, etc. (basename starts with `.env` followed by end-of-string, `.`, or `_`)
- **Private keys** — `id_rsa`, `id_ecdsa`, `id_ed25519`, `id_dsa`
- **Certificate / keystore extensions** — `.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.cert`, `.crt`
- **Credential files** — `credentials`, `.credentials`, `known_hosts`, `authorized_keys`

Sensitive files are silently skipped in `searchText` (not returned in matches) and cause `SENSITIVE_FILE` error in `replaceText` surgical mode (fail-fast before touching any file). Covered by `tests/security/sensitive-files.test.ts`.

### No rate limiting or request size limits

The daemon socket has no limit on request size or request rate. A misbehaving agent could send very large payloads or flood the socket. Acceptable for a single-user dev container; would need addressing for multi-tenant deployments.
