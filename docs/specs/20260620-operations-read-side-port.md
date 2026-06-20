# Route the operations core through the FileSystem port (read-side migration, slice 2)

**type:** change
**date:** 2026-06-20
**tracks:** handoff.md # read-side FileSystem-port migration → docs/architecture.md

---

## Context

Slice 1 made `src/domain/` pure. The application/operations core still reads disk directly: the read-only ops (`findReferences`/`getDefinition`/`findImporters`) re-implement an existence guard inline with `fs.existsSync`, `replaceText` uses `realpathSync`, and `moveDirectory` + the `file-walk.ts` walkers use `readdirSync`/`statSync`. This slice routes those reads through the `FileSystem` port so the operations core is substitutable in tests and the "I/O at adapters / injected port" invariant holds for the core. The compiler adapters (`ts-engine/`, `plugins/vue/`) and `utils/ts-project.ts` are explicitly out of scope (see Red flags).

## User intent

*As a maintainer of a hexagonal codebase, I want the operations core to read files only through the injected `FileSystem` port, so that operation logic is unit-testable in memory and the ports-and-adapters boundary holds on the read side as it already does on the write side.*

## Relevant files

- `src/operations/findReferences.ts`, `getDefinition.ts`, `findImporters.ts` — read-only ops; each does inline `path.resolve` + `fs.existsSync` + throw `FILE_NOT_FOUND`, duplicating `assertFileExists`.
- `src/utils/assert-file.ts` — the canonical, already-port-based existence check (`assertFileExists(file, fs)`); the read-only ops should call it instead of duplicating it.
- `src/operations/replaceText.ts` — uses `realpathSync`; already holds a `scope`, so `scope.fs.realpath`.
- `src/operations/moveDirectory.ts` — uses `readdirSync`/`statSync`; already holds a `scope`.
- `src/utils/file-walk.ts` — `walkFiles`/`walkWorkspaceFiles` use `readdirSync`; called by `searchText`/`replaceText` (which hold a scope).
- `src/ports/filesystem.ts` + `node-filesystem.ts` + `in-memory-filesystem.ts` + `__testHelpers__/filesystem-conformance.ts` — `readdir` is added here. `stat` (isDirectory) and `realpath` already exist.
- `src/daemon/dispatcher.ts` — constructs `NodeFileSystem` already (for the boundary check); the injection point for the read-only ops.
- `src/domain/domain-purity.test.ts` — the guard pattern to extend to `src/operations/**`.

### Red flags

- **`utils/ts-project.ts` is excluded by design.** Its `isVueProject` reads via `ts.sys` (the TypeScript compiler's own filesystem, not our port), and both `findTsConfig`/`isVueProject` sit on process-lifetime module-level caches that are the subject of the separate "Daemon discovery cache invalidation" handoff item. Migrating it means untangling that cache and the `ts.sys` dependency — out of scope here; it stays as compiler-adapter-adjacent infra.
- **`ts-engine/` and `plugins/vue/` are adapters** (they wrap ts-morph / Volar and legitimately do I/O, e.g. `ts-engine/move-directory.ts`'s `readdirSync`). Do not migrate them; the guard (AC4) must not cover them.
- **Layer-fit per AC:** AC1 is a pure port addition — unit-test each implementation via the conformance suite. AC2/AC3 are pure functions of an injected `FileSystem` — unit-test with `InMemoryFileSystem`, no real disk. AC4 is a source-scan test.

## Value / Effort

- **Value:** the operations core becomes unit-testable in memory (today these ops force real temp dirs for their existence/walk paths), and the read side of the port boundary stops being aspirational. It also removes a genuine duplication: three ops re-implement `assertFileExists` inline.
- **Effort:** moderate, mostly mechanical once the injection decision is fixed (it is — see Open decisions). One new port method (+ two impls + conformance), three read-only ops gain a parameter and lose duplicated code, two scope-holding ops + the walkers swap calls, one guard test. No `Engine` contract change.

## Behaviour

- [ ] **AC1 — `readdir` on the `FileSystem` port.** `readdir(path)` returns the directory's entry names. Given a directory seeded in `InMemoryFileSystem`, returns its immediate children; given a non-directory or missing path, throws (matching `NodeFileSystem`'s `readdirSync` behaviour). Added to the interface, `NodeFileSystem`, `InMemoryFileSystem`, and the shared conformance suite. *Laziest wrong impl:* return full paths instead of basenames, or recurse — the conformance test pins immediate-children basenames.
- [ ] **AC2 — scope-holding reads go through `scope.fs`.** `replaceText` uses `scope.fs.realpath`; `moveDirectory` uses `scope.fs.readdir`/`scope.fs.stat`; `file-walk.ts`'s `walkFiles`/`walkWorkspaceFiles` take a `FileSystem` and use `readdir`, with `searchText`/`replaceText` passing `scope.fs`. Given an `InMemoryFileSystem`-backed scope, each op produces identical results to today with no `node:fs` call. *Laziest wrong impl:* leave `file-walk` on `node:fs` and only swap the operation's own call — caught by AC4 scanning `file-walk.ts`.
- [ ] **AC3 — read-only ops validate via the injected port.** `findReferences`/`getDefinition`/`findImporters` take a `FileSystem` parameter and call `assertFileExists(file, fs)` instead of inline `fs.existsSync`; the dispatcher passes the `FileSystem` it already constructs. Given a missing file, still throws `FILE_NOT_FOUND` with the original message; given an existing file (seeded in memory), proceeds. The inline `path.resolve`/`existsSync`/throw block is deleted in all three. *Laziest wrong impl:* keep the inline check and ignore the param — caught by AC4 (no `node:fs` in `operations/`) and by a test seeding only the in-memory fs.
- [ ] **AC4 — guard extends to the operations core.** A unit test fails if any file under `src/operations/**` or `src/utils/file-walk.ts` imports `node:fs`. Passes after AC1–AC3; fails on a reintroduced import. Must NOT flag `ts-engine/`, `plugins/`, or `ts-project.ts`.

## Interface

No public CLI/socket surface changes. Internal signature changes:

- **`FileSystem.readdir(path: string): string[]`** — returns immediate child entry names (basenames), not full paths. Bounds: any directory; empty dir → `[]`. Adversarial: missing path / file path → throws (consistent with `readdirSync`). `InMemoryFileSystem` derives children from its key set.
- **`findReferences`/`getDefinition`/`findImporters`** — gain a trailing `fs: FileSystem` parameter. Contains: the filesystem used for the existence pre-check. The dispatcher supplies `new NodeFileSystem()` (or a shared instance). No change to return shapes or error codes.
- **`walkFiles`/`walkWorkspaceFiles`** — gain a `FileSystem` parameter (position to match existing call style). Callers pass `scope.fs`.

## Open decisions

**How do the read-only ops obtain a `FileSystem`? — RESOLVED: inject the port as a parameter; reuse `assertFileExists`.**
- Options: (1) pass a `FileSystem` parameter to the ops and call the existing `assertFileExists`; (2) widen the `Engine` port so the engine reports `FILE_NOT_FOUND` for files it can't load.
- Tradeoffs: (1) reuses the single canonical existence check (removing real inline duplication), keeps the `Engine` port focused on compiler work, depends only on the small stable `FileSystem` port, and is fully in-memory testable — at the cost of one extra parameter. (2) would spread the `FILE_NOT_FOUND` contract unevenly across engine methods and *both* engine implementations (and their tests), and does not even fit `findImporters`, which takes no position and never calls `resolveOffset`. Larger surface, more risk, less focused port.
- **Chosen:** (1). Consequence: read-only ops depend on `Engine` + `FileSystem` (write ops already depend on `WorkspaceScope`, which bundles `FileSystem`); existence policy stays explicit in the operation via one shared helper. Watch for: the dispatcher must pass the same `FileSystem` it uses elsewhere; do not construct ad-hoc instances per call if a shared one is available at that point.

## Security

- **Workspace boundary:** N/A to the boundary check itself (unchanged — that is `WorkspaceScope`/dispatcher). These ops are read-only; no new write path. The existence check moving to `assertFileExists` preserves `FILE_NOT_FOUND` semantics.
- **Sensitive file exposure:** N/A — no change to what content is read or returned; `isSensitiveFile` unaffected.
- **Input injection:** N/A — no new string parameters reach the filesystem beyond the already-validated path.
- **Response leakage:** N/A — error messages unchanged.

## Edges

- `assertFileExists` returns the resolved absolute path; the read-only ops currently compute `absPath` themselves — after the swap they must use the helper's return value so downstream `compiler.*` calls receive the same resolved path as before.
- `walkWorkspaceFiles` results (ordering, skip-dirs, extension filtering) must be unchanged after moving to `readdir` — existing search/replace tests are the regression guard.
- `InMemoryFileSystem.readdir` must agree with its `exists`/`stat` directory semantics (directory markers / key prefixes) so walks behave consistently in tests.

## Done-when

- [ ] All four ACs verified by tests
- [ ] Mutation score ≥ threshold for every touched source file (`findReferences.ts`, `getDefinition.ts`, `findImporters.ts`, `replaceText.ts`, `moveDirectory.ts`, `file-walk.ts`, `in-memory-filesystem.ts`, `node-filesystem.ts`)
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [ ] Read-only-op tests run against `InMemoryFileSystem`, not real disk
- [ ] `docs/architecture.md` updated: the read-side bypass note in principle #3 is narrowed/removed to reflect the operations core now going through the port (only `ts-project.ts` + adapters remain)
- [ ] Any tech debt discovered added to handoff.md as `[needs design]`
- [ ] Spec moved to `docs/specs/archive/` with an Outcome section appended
