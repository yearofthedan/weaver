# Purify the domain layer (read-side port migration, slice 1)

**type:** change
**date:** 2026-06-18
**tracks:** handoff.md # read-side FileSystem-port migration → docs/architecture.md

---

## Context

The `FileSystem` port exists so the workspace's file I/O is substitutable (`NodeFileSystem` in prod, `InMemoryFileSystem` in tests). It is wired through `WorkspaceScope` for *writes*, but the *read* side still hits disk directly: ~17 non-test files import `node:fs`. The worst offender is `src/domain/security.ts` — the **domain layer itself** doing `existsSync`/`statSync`/`realpathSync`, including a `realpathSync` at module-load time. In hexagonal terms the engine, plugins, ports, and daemon are adapters and may do I/O; the domain must not. This slice purifies the domain and establishes a guard so it stays pure. Operations-core and the `readdir` port gap are deliberately deferred to slice 2.

## User intent

*As a maintainer of a hexagonal codebase, I want the domain layer to contain only pure logic with no direct filesystem access, so that domain rules are testable without disk and the ports-and-adapters boundary actually holds.*

## Relevant files

- `src/domain/security.ts` — the target. `isWithinWorkspace` + `validateWorkspace` + the module-level `RESTRICTED_WORKSPACE_ROOTS` realpath are the I/O to remove; `isSensitiveFile`, `validateFilePath`, and the sensitive-name constants are already pure.
- `src/domain/workspace-scope.ts` — holds `this.fs` and calls `isWithinWorkspace` in `contains()`. New home for the symlink-resolution orchestration.
- `src/daemon/dispatcher.ts:273` — second caller of `isWithinWorkspace`; has a scope available, reuses the `WorkspaceScope` orchestration rather than re-resolving.
- `src/daemon/daemon.ts:85,137` — only production caller of `validateWorkspace` (startup). The relocation target / injection point.
- `src/ports/filesystem.ts` + `node-filesystem.ts` + `in-memory-filesystem.ts` — `realpath`, `exists`, `stat` already exist on the port; no port change needed this slice.
- `src/domain/security.test.ts` — covers all three functions; will move/adjust with the relocation.

### Red flags

- `RESTRICTED_WORKSPACE_ROOTS` does `fs.realpathSync` inside a module-level `flatMap` at import time — ambient I/O on first import, impossible to substitute in tests. Folds into the relocated `validateWorkspace`, computed via the injected `FileSystem`.
- **Layer-fit per AC:** AC1 (`isWithinWorkspace`) becomes a pure function — unit-test directly with resolved-path inputs, no fixtures. AC2 (workspace validation) needs `exists`/`stat`/`realpath` — unit-test against `InMemoryFileSystem` (the point of the change), not real temp dirs. AC3 (guard) is a pure source-scan test.
- **Test hotspot:** `security.test.ts` is not over threshold, but its `validateWorkspace` tests currently rely on real paths (`/etc`, temp dirs). They should convert to `InMemoryFileSystem` as part of AC2 — that conversion *is* the proof the I/O is now injectable.

## Value / Effort

- **Value:** The domain layer becomes pure — its boundary rules (`isWithinWorkspace`, sensitive-file checks, workspace validation) become unit-testable without touching disk or depending on host realpath behaviour (the macOS `/etc → /private/etc` quirk currently leaks into module-load). It makes the ports-and-adapters boundary real instead of aspirational, and the guard prevents silent regression. This is the keystone slice: the "resolve at the boundary, keep the core pure" pattern it establishes is what slice 2 (operations core) copies.
- **Effort:** Small, contained blast radius. `isWithinWorkspace` has 2 production callers (both hold a scope); `validateWorkspace` has 1 (daemon startup). No new port methods. One new guard test. The relocation of `validateWorkspace` + its tests is the largest single piece.

## Behaviour

- [ ] **AC1 — `isWithinWorkspace` is pure.** Given an absolute file path and an absolute workspace root, returns `true`/`false` from `path.relative` math alone, with **no** `node:fs` call. Symlink resolution is no longer its responsibility. *Laziest wrong impl:* keep the `existsSync`/`realpathSync` branch "just in case" — caught by AC3 (no `node:fs` in domain) and by a test asserting the function returns correctly for a path that does not exist on disk. The realpath-resolution behaviour it used to perform is preserved by AC1's companion change in `WorkspaceScope` (below), verified by an existing-symlink boundary test through `scope.contains()`.
- [ ] **AC2 — workspace validation does no in-domain or module-load I/O.** Workspace validation (existence, is-a-directory, restricted-root check including symlink-resolved form) runs through an injected `FileSystem`, and `RESTRICTED_WORKSPACE_ROOTS` canonicalization happens on demand via that `FileSystem` rather than at import time. Given an `InMemoryFileSystem` seeded with a directory, validation passes; given a missing path, it returns the not-found error; given a path that resolves (via the injected `realpath`) to a restricted root, it returns the restricted error. *Laziest wrong impl:* inject the fs but still read the module-level realpath'd set — caught by a test that seeds only the in-memory fs and asserts a symlinked-into-`/etc` case is rejected without any real disk.
- [ ] **AC3 — guard against domain I/O.** A unit test fails if any file under `src/domain/**` imports `node:fs` or `node:os`. Given the current tree (post-AC1/AC2), it passes; given a reintroduced `import * as fs from "node:fs"` in any domain file, it fails. *Laziest wrong impl:* check only `security.ts` — the test must scan the whole `src/domain/` directory.

## Interface

No public CLI/socket surface changes. Internal signature changes only:

- **`isWithinWorkspace(filePath: string, workspace: string): boolean`** — unchanged signature, but now requires callers to pass already-absolute paths and owns no symlink resolution. Contains: lexical containment result. Bounds: any two path strings. Zero case: identical path → within (`rel === ""`). Adversarial: `..`-prefixed relative result → outside.
- **`WorkspaceScope.contains(filePath)`** — unchanged signature; gains the symlink-resolution step internally (resolve `filePath` and `root` via `this.fs.realpath` when they exist, then call the pure `isWithinWorkspace`). This is where the prior `realpathSync` behaviour now lives.
- **Workspace validation** — relocated out of `domain/` (see Open decisions). New signature takes a `FileSystem`: `validateWorkspace(workspacePath: string, fs: FileSystem): { ok: true; workspace: string } | { ok: false; error: string }`. `daemon.ts` passes its `NodeFileSystem`. Error strings unchanged (no new error codes).

## Open decisions

**1. Where does `validateWorkspace` live? — RESOLVED: relocate to the daemon boundary.**
- Options: (a) relocate out of `domain/security.ts` to a boundary module near its only caller (`daemon/`); (b) keep it in `domain/` but inject `FileSystem`.
- Tradeoffs: (a) keeps the domain genuinely pure — it depends on *no* port, even an abstract one; validation is external-input checking at startup, which is a boundary concern, and the only caller is already at the boundary. (b) is a smaller diff but leaves a domain function that needs a filesystem, which is the weaker design and complicates the AC3 guard (the domain would still transitively depend on the port).
- **Chosen:** (a). Move `validateWorkspace` and `RESTRICTED_WORKSPACE_ROOTS` to a boundary module (e.g. `src/daemon/validate-workspace.ts`); move its tests with it. Consequence: `domain/security.ts` ends up containing only pure functions + constants, making AC3 a clean invariant. Watch for: any non-daemon caller (none found — only `daemon.ts`).

**2. Where does the symlink-resolution orchestration for `isWithinWorkspace` live? — RESOLVED: `WorkspaceScope` owns it.**
- Options: (a) a `WorkspaceScope` method that resolves realpaths then calls the pure check, reused by the dispatcher site; (b) duplicate the resolve-then-check at both call sites.
- **Chosen:** (a). `WorkspaceScope.contains()` performs the resolution via `this.fs`; the dispatcher site (`dispatcher.ts:273`) routes through a scope rather than re-resolving. Consequence: single home for the TOCTOU-accepting symlink logic. Watch for: the dispatcher site must have a scope in hand at that point — confirm during implementation; if it does not, pass one in rather than re-importing raw fs.

## Security

- **Workspace boundary:** This change *refactors* the boundary check itself. The pure `isWithinWorkspace` must produce identical verdicts to today for all current cases; the symlink-resolution that catches a symlinked path escaping the workspace moves to `WorkspaceScope.contains()` and must be preserved (regression test: an existing symlink pointing outside the workspace is still rejected). No code path may call the pure `isWithinWorkspace` on an unresolved path *expecting* symlink protection — that protection now lives in `contains()`.
- **Sensitive file exposure:** N/A — `isSensitiveFile` is unchanged and stays pure.
- **Input injection:** N/A — no new string parameters reach the filesystem; `validateFilePath` (control-char/URI guard) is unchanged.
- **Response leakage:** N/A — error strings unchanged; no file content added to responses.

## Edges

- The macOS `/etc → /private/etc` symlink coverage for restricted roots must still hold after canonicalization moves off module-load (regression: a workspace at `/etc` and at its resolved form are both rejected).
- `isWithinWorkspace` must still return `true` for a path that does not exist on disk (lexically inside) — the prior code only ran realpath when the path existed; the pure version must not regress non-existent-path handling.
- `WorkspaceScope.contains()` behaviour for symlinked workspace roots must be unchanged (it is exercised today via write-path boundary tests).

## Done-when

- [ ] All three ACs verified by tests
- [ ] Mutation score ≥ threshold for `src/domain/security.ts` and the relocated workspace-validation file
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] `security.test.ts` workspace-validation tests run against `InMemoryFileSystem`, not real disk
- [ ] Docs: note the domain-purity invariant + the I/O-confined-to-adapters classification in `docs/architecture.md`; no CLI/command/error-code surface changed
- [ ] Slice-2 follow-up (operations core + `readdir` port method) is present in handoff.md as a `[needs design]` entry
- [ ] Non-obvious gotchas (e.g. dispatcher scope availability, macOS realpath coverage) recorded in `docs/architecture.md` or alongside the code
- [ ] Spec moved to `docs/specs/archive/` with an Outcome section appended

## Outcome

**Shipped:** the three ACs. `src/domain/security.ts` is now pure (imports only `node:path`); `isWithinWorkspace` is pure path math and the symlink-resolution it used to do lives in `WorkspaceScope.contains()`. `validateWorkspace` + `RESTRICTED_WORKSPACE_ROOTS` relocated to `src/daemon/validate-workspace.ts` with an injected `FileSystem`, killing the module-load `realpathSync`. `domain/domain-purity.test.ts` scans all of `src/domain/` and fails on any `node:fs`/`node:os` import. The dispatcher's boundary check routes through a per-invoke `WorkspaceScope`, consistent with how operations construct scopes.

**Tests added:** +18 (1053 → 1071). New `validate-workspace.test.ts` (23 cases, `InMemoryFileSystem` + a `Proxy` to simulate `realpath` symlink mappings, plus 2 real-disk regression smokes); the `isWithinWorkspace` symlink case moved from `security.test.ts` to `workspace-scope.test.ts`; a fail-closed `contains()` case added.

**Mutation:** `security.ts` 100%, `workspace-scope.ts` 100%, `validate-workspace.ts` 94.44%. The 2 remaining `validate-workspace.ts` survivors are genuine equivalents: the `real === p` Set-dedup branch (adds a duplicate either way) and the defensive build-set `catch` (only changes an error-message variant on an already-rejected unresolvable base path).

**Reflection:**
- *Went well:* the blast-radius check up front (`isWithinWorkspace` had 2 callers, `validateWorkspace` 1) confirmed the relocation was low-risk before any code moved. Constructor/parameter injection from the boundary (not a global) kept the domain genuinely pure rather than "pure but depends on a port."
- *Review caught a real gap the agent mis-classified as noise:* the execution agent's tests asserted `expect.stringMatching(/restricted/i)` for *both* the direct-restricted and the resolves-to-restricted cases — so the security-meaningful "is" vs "resolves to" message distinction went untested and two mutants survived. Tightening to exact-message assertions killed them. Lesson for the next reviewer: a loose regex assertion on an error string is a classic mutation blind spot — when two code paths return different messages, pin both exactly.
- *The `Proxy`-over-`InMemoryFileSystem` pattern* is the clean way to simulate `realpath` symlink resolution in-memory (the base `InMemoryFileSystem.realpath` is identity). Reusable for slice 2.
- *For the next agent (slice 2):* the operations core still reads disk directly (`findReferences`/`getDefinition`/`findImporters` `existsSync` guards, `replaceText` `realpathSync`, `moveDirectory` `readdir`/`stat`). The read-only ops take no `scope` today — deciding how they receive a `FileSystem` is the open design question. The port needs a `readdir` method (3 callers). The engine/Vue plugins are adapters and stay on `node:fs` — do not migrate them.
