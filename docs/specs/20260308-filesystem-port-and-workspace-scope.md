# FileSystem port + WorkspaceScope: strangler proof on `rename`

**type:** change
**date:** 2026-03-08
**tracks:** handoff.md # Target architecture → docs/target-architecture.md

---

## Context

The codebase has no I/O abstraction. Every operation and provider calls `node:fs` directly, making unit testing impossible without real temp directories and fixture copying. Workspace boundary tracking (`Set<modified>` + `Set<skipped>` + `isWithinWorkspace` loops) is reimplemented in every mutating operation.

This is the first slice of the target architecture migration (see `docs/target-architecture.md`). It introduces the two foundational abstractions — `FileSystem` port and `WorkspaceScope` — and proves them by migrating the `rename` operation. Subsequent slices migrate the remaining operations using the same pattern.

## User intent

*As a contributor, I want file I/O and workspace boundary tracking behind injectable abstractions, so that operations can be unit-tested without the filesystem and new operations get consistent boundary enforcement for free.*

## Relevant files

- `src/operations/rename.ts` — the strangler target (69 lines). Uses `fs.writeFileSync` directly and reimplements the modified/skipped pattern.
- `src/security.ts` — `isWithinWorkspace()` (lines 132-148). The logic moves into `WorkspaceScope`.
- `src/utils/assert-file.ts` — `assertFileExists()` uses `fs.existsSync`. Needs a `FileSystem`-aware variant.
- `src/types.ts` — `LanguageProvider` interface; `readFile` and `notifyFileWritten` are proto-filesystem methods.
- `src/daemon/dispatcher.ts` — creates the registry and calls operations. Will need to construct `WorkspaceScope` and pass it.
- `tests/operations/rename.test.ts` — 150 lines, well under threshold. The strangler proof adds new tests using `InMemoryFileSystem` alongside existing integration tests.
- `docs/target-architecture.md` — the target architecture reference.

### Red flags

- `isWithinWorkspace` resolves symlinks via `fs.realpathSync` for security. `WorkspaceScope.contains()` must preserve this behaviour — it cannot be a naive path prefix check. The `FileSystem` port needs a `realpath` method.
- `LanguageProvider.readFile` and `notifyFileWritten` overlap with `FileSystem`. This slice does NOT refactor the provider interface — that's a later slice. The `rename` operation currently calls both `provider.readFile` and `fs.writeFileSync`; the migration replaces only the `fs.writeFileSync` call.

## Value / Effort

- **Value:** Foundational. Every subsequent architecture slice depends on these two abstractions. Without them, each operation keeps reimplementing workspace tracking and testing stays expensive. The `rename` proof validates the pattern before committing to a full migration.
- **Effort:** Moderate. Three new files (`FileSystem` interface + `NodeFileSystem`, `InMemoryFileSystem`, `WorkspaceScope`), one operation refactored, dispatcher change to construct scope. No changes to external interfaces — MCP responses are identical.

## Behaviour

- [ ] **AC1: `FileSystem` port exists with `NodeFileSystem` and `InMemoryFileSystem` implementations.** `FileSystem` is an interface in `src/ports/filesystem.ts` with methods: `readFile`, `writeFile`, `exists`, `mkdir`, `rename`, `unlink`, `realpath`, `resolve`, `stat`. `NodeFileSystem` wraps `node:fs` and `node:path`. `InMemoryFileSystem` is backed by a `Map<string, string>` and supports all methods. Both pass the same conformance test suite.

- [ ] **AC2: `WorkspaceScope` tracks modifications and enforces workspace boundaries.** `WorkspaceScope` is a class in `src/domain/workspace-scope.ts`. Constructor takes `(root: string, fs: FileSystem)`. Methods: `contains(path)` (returns boolean, preserves symlink-resolution security from current `isWithinWorkspace`), `recordModified(path)`, `recordSkipped(path)`, `writeFile(path, content)` (writes via `FileSystem` and records as modified; throws if outside workspace). Properties: `modified: string[]`, `skipped: string[]`, `fs: FileSystem` (read-only).

- [ ] **AC3: `rename` operation uses `WorkspaceScope` instead of manual boundary tracking.** The `rename` function signature changes from `(provider, filePath, line, col, newName, workspace)` to `(provider, filePath, line, col, newName, scope: WorkspaceScope)`. The `Set<modified>` / `Set<skipped>` / `isWithinWorkspace` pattern is replaced by `scope.contains()` / `scope.recordModified()` / `scope.recordSkipped()`. The `fs.writeFileSync` call is replaced by `scope.writeFile()`. Return value uses `scope.modified` / `scope.skipped`. Behaviour is identical — existing integration tests pass unchanged (apart from the call signature).

- [ ] **AC4: Dispatcher constructs `WorkspaceScope` and passes it to `rename`.** The dispatcher's `rename` entry in the `OPERATIONS` table creates a `WorkspaceScope` from the workspace string and a `NodeFileSystem` instance, passing it to the operation. Other operations are unchanged — they still receive `workspace: string`.

- [ ] **AC5: `rename` has unit tests using `InMemoryFileSystem`.** At least one test exercises `rename` with an `InMemoryFileSystem`-backed `WorkspaceScope` and a mock `LanguageProvider`, verifying: (a) files outside workspace are skipped, (b) modified files are tracked, (c) file content is written correctly. These tests do not touch the real filesystem.

## Interface

**No external interface changes.** MCP tool signatures, response shapes, and error codes are identical. This is a pure internal refactoring.

**Internal signature change — `rename`:**

```typescript
// Before
rename(provider, filePath, line, col, newName, workspace: string): Promise<RenameResult>

// After
rename(provider, filePath, line, col, newName, scope: WorkspaceScope): Promise<RenameResult>
```

The dispatcher adapts: it constructs the `WorkspaceScope` from the `workspace` string before calling.

**New types:**

```typescript
// src/ports/filesystem.ts
interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  rename(oldPath: string, newPath: string): void;
  unlink(path: string): void;
  realpath(path: string): string;
  resolve(...segments: string[]): string;
  stat(path: string): { isDirectory(): boolean };
}

// src/domain/workspace-scope.ts
class WorkspaceScope {
  constructor(root: string, fs: FileSystem);
  readonly fs: FileSystem;
  contains(filePath: string): boolean;
  recordModified(filePath: string): void;
  recordSkipped(filePath: string): void;
  writeFile(filePath: string, content: string): void;
  get modified(): string[];
  get skipped(): string[];
}
```

## Security

- **Workspace boundary:** `WorkspaceScope.contains()` must preserve the symlink-resolution behaviour from `isWithinWorkspace`. The existing `isWithinWorkspace` function stays in `security.ts` for now — `WorkspaceScope.contains()` delegates to it. `isWithinWorkspace` is not removed in this slice; other operations still call it directly.
- **Sensitive file exposure:** N/A — `rename` does not read file content through the new FileSystem path (it reads via `provider.readFile`). No new exposure surface.
- **Input injection:** N/A — no new user-supplied strings introduced. File paths are validated upstream by the dispatcher.
- **Response leakage:** N/A — no change to response shape.

## Edges

- **`InMemoryFileSystem.realpath`** must behave sanely for tests — return the input path unchanged (no symlinks in memory). `WorkspaceScope.contains()` must still work correctly with this simplified behaviour.
- **`assertFileExists` is NOT migrated in this slice.** It still calls `fs.existsSync` directly. Migrating it requires threading `FileSystem` through every operation that calls it — too wide for this strangler proof. It becomes a follow-up.
- **`provider.readFile` / `provider.notifyFileWritten` are NOT migrated.** The `LanguageProvider` interface changes are a separate slice. In this slice, `rename` still calls `provider.readFile` for reading and uses `scope.writeFile` for writing. This is intentionally asymmetric — the strangler migrates one concern at a time.
- **Other operations are unchanged.** `moveFile`, `moveSymbol`, `deleteFile`, `extractFunction` still receive `workspace: string` and call `fs` directly. They are migrated in subsequent slices.
- **`NodeFileSystem` is a singleton.** The daemon creates one instance at startup. All `WorkspaceScope` instances share it. There is no per-request filesystem state.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Existing `rename` integration tests pass with unchanged assertions (only call signature adapted)
- [ ] No coverage regression: run `pnpm exec vitest --coverage` before and after. Line/branch coverage for `src/operations/rename.ts` and `src/security.ts` must not decrease. `isWithinWorkspace` retains its dedicated tests in `tests/security/workspace.test.ts`; `WorkspaceScope.contains()` delegates to it rather than reimplementing.
- [ ] `docs/architecture.md` updated to document `FileSystem` port and `WorkspaceScope`
- [ ] `docs/handoff.md` current-state section updated (new files in directory layout)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
