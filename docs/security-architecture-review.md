# Security & Architecture Review

**Status:** Current
**Purpose:** High-priority security and architectural issues for agents implementing features. Read this before starting work.
**Audience:** Engineers implementing features, security-conscious AI agents.

---

## Critical Issues

All critical issues have been fixed. See git history for details.

## Medium Severity

## Medium Severity (continued)

### 6. TOCTOU race in symlink checks

**File:** `src/security.ts:123-130`

**Problem:** `isWithinWorkspace` checks if a file exists and resolves symlinks at check time, but the actual operation happens later:

```typescript
if (fs.existsSync(abs)) {
  const real = fs.realpathSync(abs);  // ← Check
  if (path.relative(workspace, real).startsWith("..")) return false;
}
// ... later, file is written ...
```

Between the check and the write, a symlink could be replaced to point outside the workspace.

**Impact:** Low in practice (tool is local-only, no multi-tenant), but weakens defense-in-depth.

**Mitigation:** This is difficult to solve robustly. Options:
- Use `O_NOFOLLOW` on write operations (Unix-specific)
- Add final symlink re-check immediately before write
- Accept the race as acceptable risk given the use case

---

### 7. Naive string replacement in `TsProvider.afterFileRename`

**Fixed.** `afterFileRename` now uses ts-morph to parse each out-of-project file in-memory and updates only `ImportDeclaration`/`ExportDeclaration` module specifiers. Comments and string literals are no longer touched.

---

### 8. `spawnDaemon` stderr buffer management

**Fixed.** Lines are now consumed incrementally using a byte offset; the `data` listener is removed after the ready signal is found, so the buffer cannot grow after `child.unref()`.

---

### 9. PID reuse in lockfile check

**Fixed.** Lockfile format changed from a bare PID string to `{pid, startedAt}` JSON. `isDaemonAlive` now also verifies the socket file exists — a running daemon always has a socket, so a live PID with no socket means a recycled PID or a crashed daemon that didn't clean up.

---

## Low Severity / Improvement Opportunities

### 10. `protocol.ts` is dead code

**Fixed.** `src/protocol.ts` deleted — confirmed zero imports across the codebase.

---

### 11. Sensitive file detection gaps

**Fixed.** Added `.npmrc`, `.netrc`, `.vault-token`, `.htpasswd`, `secrets.yaml`, `secrets.yml`, `.kdbx`, `service-account*.json`, and `*-key.json` to `isSensitiveFile`. The last two use a new `SENSITIVE_BASENAME_PATTERNS` regex array for wildcard-style matching.

---

### 12. Process-lifetime caches with no invalidation

**File:** `src/utils/ts-project.ts:5,50`

**Problem:** Two caches live for the daemon's entire lifetime with no invalidation:

```typescript
const cache = new Map<string, string | null>();  // findTsConfig results
const vueProjectCache = new Map<string, boolean>(); // isVueProject results
```

If a `tsconfig.json` is created, deleted, moved, or `.vue` files are added to a previously non-Vue project during the daemon's lifetime, the daemon serves stale results.

The file watcher triggers `invalidateAll()` on the *providers* but never clears these discovery caches.

**Impact:** Low — unlikely during normal development (tsconfig is usually static), but could cause confusion after monorepo restructuring.

**Mitigation:** Add invalidation hooks triggered by the file watcher for tsconfig changes and new `.vue` files.

---

### 13. Three-way schema duplication

**Fixed.** `mcp.ts` input schemas are now derived from `schema.ts` shapes using `.describe()` — no duplicated regexes or field definitions. `dispatcher.ts` already imported from `schema.ts` (this was fixed in the action-centric refactor). `schema.ts` is now the single source of truth for all field validation.

---

## What's Done Well

✓ Workspace boundary enforcement consistently applied in most write paths
✓ Symlink-following with `realpathSync` in `isWithinWorkspace` and `validateWorkspace`
✓ Restricted workspace roots as defense-in-depth against misconfigured MCP clients
✓ Request serialization via promise-chain mutex prevents interleaved writes
✓ Binary file detection before text operations
✓ `git ls-files` preference with fallback — respects `.gitignore` by default
✓ Clean error type hierarchy with `EngineError` and typed codes
✓ Sensitive file skipping in search/replace operations

---

## Recommended Priority Order

1. **TOCTOU race** (Issue #6) — strengthen defense-in-depth (lower practical risk; only remaining open issue)

---

## Testing Strategy

For each fix, add test cases that verify:

- **ReDoS guard:** Pattern rejected immediately; no hang on pathological input
- **Runtime validation:** Malformed params rejected with clear error; valid params pass through
- **Workspace boundary:** Operations outside workspace raise `WORKSPACE_VIOLATION`, don't silently modify files
- **Socket timeout:** Timeout fires and rejects promise after 30s
- **Error codes:** Distinguish `DAEMON_STARTING` (connection failed, retry) from operation-specific errors (don't retry)
- **TOCTOU:** Symlink created after check is not followed during write (requires filesystem-level testing or mock)

---
