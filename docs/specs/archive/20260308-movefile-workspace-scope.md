# Migrate `moveFile` to `WorkspaceScope`

**type:** change
**date:** 2026-03-08
**tracks:** handoff.md # Target architecture step 2 → docs/target-architecture.md

---

## Context

Step 1 of the target architecture migration introduced `FileSystem` port and `WorkspaceScope`, proving the pattern on `rename`. `moveFile` is the next operation to migrate — it has the same symptoms: direct `node:fs` calls (`writeFileSync`, `existsSync`, `mkdirSync`, `renameSync`), manual `Set<modified>` / `Set<skipped>` bookkeeping, and inline `isWithinWorkspace` checks.

The existing test suite (358 lines) is entirely integration tests using real temp dirs and fixture copying. With `WorkspaceScope` + `InMemoryFileSystem`, the orchestration logic (boundary filtering, directory creation, file move, modified/skipped merging) can be covered by fast unit tests with a mock provider.

## User intent

*As a contributor, I want `moveFile` to use `WorkspaceScope` for boundary tracking and `FileSystem` for I/O, so that orchestration logic is unit-testable without the filesystem and the operation follows the same pattern as `rename`.*

## Relevant files

- `src/operations/moveFile.ts` — the migration target (66 lines). Direct `fs` calls and manual Set bookkeeping.
- `src/operations/rename.ts` — the reference pattern. Already migrated to `WorkspaceScope`.
- `src/domain/workspace-scope.ts` — `WorkspaceScope` class.
- `src/ports/filesystem.ts` — `FileSystem` interface.
- `src/daemon/dispatcher.ts` — constructs `WorkspaceScope` for `rename`; needs the same for `moveFile`.
- `src/types.ts` — `LanguageProvider.afterFileRename` signature (NOT changed in this slice).
- `tests/operations/moveFile.test.ts` — 358 lines, all integration tests.
- `tests/operations/rename.test.ts` — reference for unit test pattern with `InMemoryFileSystem`.

### Red flags

- `tests/operations/moveFile.test.ts` at 358 lines — above the 300-line review threshold. Adding unit tests would push it further. The unit tests should go in a separate section or the file should be assessed for extraction opportunities.

## Value / Effort

- **Value:** Continues the strangler migration. Proves the `WorkspaceScope` pattern works for a more complex operation (physical file move + directory creation + afterFileRename merging). Adds fast unit tests for orchestration logic that's currently only testable through slow integration tests.
- **Effort:** Small. One operation refactored (66 lines), one dispatcher entry updated, unit tests added. Same pattern as the `rename` migration.

## Behaviour

- [x] **AC1: `moveFile` uses `WorkspaceScope` instead of manual boundary tracking.** The `moveFile` function signature changes from `(provider, oldPath, newPath, workspace: string)` to `(provider, oldPath, newPath, scope: WorkspaceScope)`. The `Set<modified>` / `Set<skipped>` / `isWithinWorkspace` pattern is replaced by `scope.contains()` / `scope.recordModified()` / `scope.recordSkipped()`. The `fs.writeFileSync` call is replaced by `scope.writeFile()`. The `fs.existsSync` / `fs.mkdirSync` / `fs.renameSync` calls are replaced by `scope.fs.exists()` / `scope.fs.mkdir()` / `scope.fs.rename()`. The `path.resolve` call for `absNew` is replaced by `scope.fs.resolve()`. Return value uses `scope.modified` / `scope.skipped`. `afterFileRename` still receives `workspace: string` (via `scope.root`) and `alreadyModified` is derived from the scope's modified set — the `LanguageProvider` interface is NOT changed. Existing integration tests pass with only the call signature adapted.

- [x] **AC2: Dispatcher constructs `WorkspaceScope` and passes it to `moveFile`.** The dispatcher's `moveFile` entry creates a `WorkspaceScope` from the workspace string and a `NodeFileSystem` instance, passing it to the operation. Same pattern as the `rename` entry.

- [x] **AC3: Extract `makeMockProvider` to shared test helper.** The `makeMockProvider` function in `tests/operations/rename.test.ts` is moved to `tests/providers/__helpers__/mock-provider.ts` (it's a test double for the `LanguageProvider` interface — provider concern, not operation concern). It returns a full `LanguageProvider` with vi.fn() stubs, accepting `Partial<LanguageProvider>` overrides. `rename.test.ts` imports it from the new location. Both `rename.test.ts` and the new `moveFile` unit tests use the shared helper. `moveSymbol` was attempted but returned `SYMBOL_NOT_FOUND` — it only handles exported declarations. Extraction done manually.

- [x] **AC4: `moveFile` has unit tests using `InMemoryFileSystem`.** Unit tests exercise `moveFile` with an `InMemoryFileSystem`-backed `WorkspaceScope` and the shared `makeMockProvider`, verifying: (a) files outside workspace are skipped and tracked in `filesSkipped`, (b) modified files are tracked in `filesModified`, (c) file content is written correctly via scope, (d) destination directory is created when missing, (e) physical file is moved (old path gone, new path exists), (f) results from `afterFileRename` are merged into scope's tracking. These tests do not touch the real filesystem.

## Interface

**No external interface changes.** MCP tool signatures, response shapes, and error codes are identical. This is a pure internal refactoring.

**Internal signature change — `moveFile`:**

```typescript
// Before
moveFile(provider: LanguageProvider, oldPath: string, newPath: string, workspace: string): Promise<MoveResult>

// After
moveFile(provider: LanguageProvider, oldPath: string, newPath: string, scope: WorkspaceScope): Promise<MoveResult>
```

The dispatcher adapts: it constructs the `WorkspaceScope` from the `workspace` string before calling.

**`afterFileRename` bridge:** The operation passes `scope.root` as the `workspace` argument and `new Set(scope.modified)` as `alreadyModified` to `provider.afterFileRename`. Results from `afterFileRename` are merged back into the scope via `scope.recordModified()` / `scope.recordSkipped()`. This is intentionally asymmetric — the provider interface changes are a separate slice.

## Security

- **Workspace boundary:** `WorkspaceScope.contains()` preserves the same symlink-resolution security as `isWithinWorkspace`. No change to boundary enforcement semantics.
- **Sensitive file exposure:** N/A — `moveFile` does not read file content through the new FileSystem path (reads via `provider.readFile`). No new exposure surface.
- **Input injection:** N/A — no new user-supplied strings introduced. File paths validated upstream by dispatcher.
- **Response leakage:** N/A — no change to response shape.

## Edges

- **`assertFileExists` is NOT migrated.** It still calls `fs.existsSync` directly. Unit tests must pass a real-ish path or the mock provider must not trigger this guard. Same constraint as the `rename` migration.
- **`provider.afterFileRename` signature is NOT changed.** The bridge pattern (passing `scope.root` and deriving `alreadyModified` from scope) is temporary — it will resolve when the `LanguageProvider` interface is migrated in a later slice.
- **`provider.readFile` / `provider.notifyFileWritten` are NOT migrated.** Same as `rename` — the strangler migrates one concern at a time.
- **Integration tests remain.** Existing integration tests stay — they verify the full stack (real compiler + real filesystem). The unit tests are additive, not replacements.
- **`node:fs` and `node:path` imports are fully removed from `moveFile.ts`.** After migration, the operation should have zero direct `node:fs` or `node:path` imports.
- **`makeMockProvider` extraction is minimal.** Move the function and its TODO comment to `tests/providers/__helpers__/mock-provider.ts`. Don't redesign it (e.g. into a class) — that's a separate concern if needed later.

## Done-when

- [x] All ACs verified by tests
- [x] Mutation score >= threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] Existing `moveFile` integration tests pass with unchanged assertions (only call signature adapted)
- [x] No coverage regression
- [x] `docs/architecture.md` updated if needed (note `moveFile` now uses `WorkspaceScope`)
- [x] `docs/handoff.md` current-state section updated if layout changes
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Non-obvious gotchas captured in docs/agent-memory.md (skip if nothing worth recording)
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Tests added:** 6 new unit tests in `tests/operations/moveFile.test.ts`:
- skips files outside workspace and records them in filesSkipped
- records modified files in filesModified
- writes updated file content through scope
- creates destination directory when it does not exist
- moves the physical file (old path gone, new path exists)
- merges afterFileRename results into scope tracking

Integration tests split into `moveFile_tsProvider.test.ts` and `moveFile_volarProvider.test.ts` (by provider). Shared `makeMockProvider` extracted to `tests/providers/__helpers__/mock-provider.ts`.

**Mutation scores:** 96.15% overall — `workspace-scope.ts` 100% (11/11 killed), `moveFile.ts` 93.33% (14/15 killed, 1 survivor).

**Architectural decisions:**
- `WorkspaceScope.root` made public to support the `afterFileRename` bridge pattern (passing `scope.root` as the `workspace` argument).
- Test files split by provider: `moveFile.test.ts` (unit tests with InMemoryFileSystem), `moveFile_tsProvider.test.ts` (TsProvider integration), `moveFile_volarProvider.test.ts` (VolarProvider integration).
- `makeMockProvider` extracted to `tests/providers/__helpers__/mock-provider.ts` as a shared test double, colocated with the provider concern it mocks.

**Reflection:**

*What went well:* The refactoring pattern from `rename` transferred cleanly to `moveFile`. The `WorkspaceScope` + `InMemoryFileSystem` combination enabled fast, deterministic unit tests for orchestration logic that previously required real filesystem setup.

*What didn't go well:* Execution agents needed multiple attempts. The first agent got sidetracked on test splitting before completing the core migration. Unit tests had path normalization bugs with trailing slashes -- `URL.pathname` for a directory URL ends with `/`, which caused double-slash issues in constructed paths like `${workspace}/some-file.ts`.

*What would help the next agent:* When writing unit tests with `InMemoryFileSystem`, always normalize paths to avoid trailing-slash issues from URL-derived paths. The `workspaceFromUrl` helper in `moveFile.test.ts` demonstrates the pattern: strip the trailing slash with `.replace(/\/$/, "")`. Also, `assertFileExists` bypasses the `FileSystem` port -- unit tests must pass a path that physically exists on disk (e.g. `import.meta.url`) to satisfy this guard.
