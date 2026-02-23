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

**File:** `src/providers/ts.ts:203-207`

**Problem:** Post-rename import rewriting does simple `replaceAll` on entire file contents:

```typescript
let updated = raw;
for (const ext of ["", ".js", ".ts", ".tsx"]) {
  updated = updated.replaceAll(relOldBase + ext, relNewBase + ext);
}
```

This matches inside comments, string literals, template strings — not just import statements. If a comment contains a relative path like `./foo/bar`, it gets silently rewritten.

**Example:**
```typescript
// TODO: move data from ./types to ./models
import { User } from "./types";
```

After renaming `./types` to `./models`, the comment becomes corrupted:
```typescript
// TODO: move data from ./models to ./models
import { User } from "./models";
```

**Impact:** Medium — silently corrupts non-code content. Unlikely but possible.

**Mitigation:** Parse the TypeScript AST (already done for `.ts` files by ts-morph) and only rewrite import specifiers, not raw string matching.

---

### 8. `spawnDaemon` stderr buffer management

**File:** `src/mcp.ts:308-320`

**Problem:** The stderr buffer accumulates and re-processes all previously-seen lines on every new chunk:

```typescript
child.stderr.on("data", (chunk) => {
  stderrBuf += chunk.toString();
  for (const line of stderrBuf.split("\n")) {
    try {
      const msg = JSON.parse(line.trim());
      if (msg.status === "ready") {
        // resolve...
      }
    } catch { }
  }
});
```

This is inefficient (re-parsing lines) and can leak memory if the daemon emits stderr after the ready signal. The child is `unref()`'d after ready, so the event listener remains attached and the buffer grows indefinitely.

**Impact:** Low — minor memory leak and inefficiency.

**Mitigation:**
- Track consumed position in buffer instead of re-splitting
- Remove the `data` listener after ready signal is found
- Or: consume from buffer incrementally

---

### 9. PID reuse in lockfile check

**File:** `src/daemon/daemon.ts:12-21`

**Problem:** `isDaemonAlive` checks liveness by calling `process.kill(pid, 0)`:

```typescript
const pid = parseInt(fs.readFileSync(lockfile, "utf8").trim(), 10);
if (Number.isNaN(pid)) return false;
process.kill(pid, 0); // throws if process doesn't exist
return true;
```

PIDs are recycled by the OS. If the daemon crashes without cleaning up and a new process takes the PID (unlikely but possible), `isDaemonAlive` returns `true` and the stale socket prevents a fresh daemon from starting.

**Impact:** Low — unlikely in practice, but prevents clean recovery from crash loops.

**Mitigation:** Add a nonce or creation timestamp to the lockfile. On startup, verify the daemon at the PID created the file recently (e.g., within the last 5 minutes).

---

## Low Severity / Improvement Opportunities

### 10. `protocol.ts` is dead code

**File:** `src/protocol.ts`

**Problem:** This file defines typed request/response interfaces:

```typescript
export interface RenameRequest {
  method: "rename";
  params: { file: string; line: number; col: number; newName: string; workspace: string };
}
```

But it's never imported anywhere. Grepping confirms zero references. The actual request typing happens via `as` assertions in `dispatcher.ts`.

**Impact:** Low — confusing for maintainers, creates false confidence that the wire protocol is typed.

**Mitigation:** Either wire `protocol.ts` into the dispatcher for runtime validation, or delete it.

---

### 11. Sensitive file detection gaps

**File:** `src/security.ts:36-59`

**Missing patterns:**
- `.npmrc` (npm auth tokens)
- `.netrc` (HTTP credentials)
- `service-account*.json`, `*-key.json` (GCP, AWS)
- `.vault-token` (HashiCorp Vault)
- `secrets.yaml`, `secrets.yml`
- `.htpasswd`
- `*.kdbx` (KeePass databases)

**Impact:** Low — unlikely to cause real-world harm given the tool's use case, but the blocklist is incomplete.

**Mitigation:** Add the patterns above to `SENSITIVE_BASENAME_EXACT` and `SENSITIVE_EXTENSIONS`.

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

**Files:** `src/schema.ts`, `src/mcp.ts`, `src/daemon/dispatcher.ts`

**Problem:** Input shapes are defined in three disconnected places with no shared source of truth:

1. **`schema.ts`** — Zod schemas (used only by CLI)
2. **`mcp.ts`** — inline Zod schemas (used for MCP tool registration)
3. **`dispatcher.ts`** — `as` type assertions (no validation)

A change to parameter names or types requires updating all three locations manually and risks silent inconsistency.

**Impact:** Low — maintenance burden and potential for bugs.

**Mitigation:** Export schemas from a single module and reuse in all three places.

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

1. **TOCTOU race** (Issue #6) — strengthen defense-in-depth (lower practical risk)
2. **Fix naive string replacement** (Issue #7) — prevent silent comment corruption
3. **Remove dead code** (Issue #10) — reduce confusion

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
