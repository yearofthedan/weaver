# Contain ts-morph types behind the compiler boundary

**type:** change
**date:** 2026-03-18
**tracks:** handoff.md # contain-ts-morph-types → docs/tech/ts-morph-apis.md

---

## Context

ts-morph types (`Project`, `SourceFile`, `Node`) leak into 6+ domain and operation files outside `src/compilers/`. The `Compiler` interface is clean — no ts-morph types on it — but the boundary is undermined by `getProjectForFile()` returning a raw `Project` and by domain files importing `Project` directly to create throwaway in-memory instances. A ts-morph major version bump currently touches 8+ files; it should touch 1–2. See the full audit in [`docs/tech/ts-morph-apis.md`](../tech/ts-morph-apis.md).

## User intent

*As a maintainer, I want ts-morph types confined to `src/compilers/`, so that a ts-morph version bump is a localised change and operations/domain code depends only on project-owned interfaces.*

## Relevant files

- `src/compilers/ts.ts` — `TsMorphCompiler`: owns `Project` cache, exposes `getProjectForFile()` escape hatch
- `src/compilers/ts-move-symbol.ts` — uses `getProjectForFile()` + `SourceFile` type; already in `compilers/`, no change needed
- `src/domain/import-rewriter.ts` — throwaway `new Project()` for script parsing/mutation
- `src/domain/rewrite-own-imports.ts` — throwaway `new Project()` for script parsing/mutation
- `src/domain/rewrite-importers-of-moved-file.ts` — throwaway `new Project()` for script parsing/mutation
- `src/domain/symbol-ref.ts` — imports `Node`, `SourceFile` from ts-morph; only consumer is `ts-move-symbol.ts`
- `src/operations/deleteFile.ts` — `getProjectForFile()` + throwaway `Project` + direct AST manipulation (does compiler-level work)
- `src/operations/extractFunction.ts` — `getProjectForFile()` to reach raw TS language service
- `src/operations/getTypeErrors.ts` — `import { ts } from "ts-morph"` + `getProjectForFile()`/`getProjectForDirectory()`

### Red flags

- `deleteFile.ts` does compiler-level work (iterating project source files, AST import removal) that parallels `afterFileRename()` in `TsMorphCompiler`. This is a design inconsistency, not just a containment issue — `moveFile` delegates to the compiler; `deleteFile` reaches into the compiler's internals.
- The throwaway-project pattern (`new Project({ useInMemoryFileSystem: true })`) appears 4 times with identical setup. DRY violation.

## Value / Effort

- **Value:** Reduces the blast radius of a ts-morph major version bump from 8+ files across 3 layers to 2–3 files in `compilers/`. Makes the ports-and-adapters boundary real — operations and domain code stop depending on a third-party library's types. Fixes a design inconsistency in `deleteFile` that was already flagged during the API audit.
- **Effort:** 5 files touched substantively, 1 new utility function, 1 new compiler method, 1 file moved. No new concepts or infrastructure — this is plumbing through existing patterns (matching what `moveFile` already does). Tests follow mechanically.

## Behaviour

- [ ] **AC1: Throwaway-project utility.** A shared function (in `compilers/`) wraps `new Project({ useInMemoryFileSystem: true })` + `createSourceFile()`. The 4 domain/operation files that use this pattern (`import-rewriter`, `rewrite-own-imports`, `rewrite-importers-of-moved-file`, `deleteFile` Phase 2) call the utility instead of importing `Project` from ts-morph. The utility returns a ts-morph `SourceFile` — this is a DRY extraction, not a full abstraction over ts-morph's AST API.

- [ ] **AC2: Direct TypeScript import.** `getTypeErrors.ts` replaces `import { ts } from "ts-morph"` with `import ts from "typescript"`. No behaviour change — ts-morph re-exports the same namespace.

- [ ] **AC3: LS accessor methods on TsMorphCompiler.** `extractFunction` and `getTypeErrors` call `getProjectForFile()` solely to reach `project.getLanguageService().compilerObject` (and a few project-graph methods like `getSourceFile`, `addSourceFileAtPath`, `getSourceFiles`). Add methods to `TsMorphCompiler` that expose what these callers actually need without returning `Project`. After this AC, `extractFunction.ts` and `getTypeErrors.ts` have no ts-morph imports and do not reference the `Project` type.

- [ ] **AC4: Refactor `deleteFile` to delegate importer cleanup to the compiler.** Add a method to `TsMorphCompiler` (e.g. `removeImportersOf(targetFile, scope)`) that handles both Phase 1 (in-project: iterate source files, remove import/export declarations via compiler-backed resolution) and Phase 2 (out-of-project: walk workspace, match specifiers, remove declarations). `deleteFile.ts` becomes thin like `moveFile.ts`: call the compiler, call Vue cleanup, unlink, invalidate. After this AC, `deleteFile.ts` has no ts-morph imports.

- [ ] **AC5: Move `symbol-ref.ts` to `compilers/`.** `symbol-ref.ts` imports `Node` and `SourceFile` from ts-morph and is only consumed by `ts-move-symbol.ts` (already in `compilers/`). Move it to `src/compilers/symbol-ref.ts` and update imports. Use `moveFile` tool to dogfood.

## Interface

No public interface changes. All changes are internal — the `Compiler` interface, MCP tools, CLI commands, and operation return types are unchanged. The new methods on `TsMorphCompiler` are internal compiler API, not exposed to consumers.

## Open decisions

### AC3: What methods to expose on TsMorphCompiler

**Chosen approach: Option 1 — expose a raw `ts.LanguageService` accessor.**

Add `getLanguageServiceForFile(path: string): ts.LanguageService`, `ensureSourceFile(path: string): void`, `refreshSourceFile(path: string): void`, and `getProjectSourceFilePaths(workspace: string): string[]` to `TsMorphCompiler`.

`extractFunction` and `getTypeErrors` call these helpers instead of reaching for `Project`. The `ts.LanguageService` type comes from TypeScript itself (not ts-morph), so exposing it doesn't create ts-morph coupling. The additional helpers are small and stable.

**What this enables:** `extractFunction.ts` and `getTypeErrors.ts` drop all ts-morph imports.
**What it rules out:** callers can't reach other `Project` APIs without a new method.
**Watch for:** the `getProjectSourceFilePaths` helper is needed by `getForProject` to iterate source files — it must return actual paths, not source file objects.

### AC4: Scope of the new compiler method

**Chosen approach: Option 1 — TS/JS only, Vue cleanup stays in `deleteFile`.**

The new `removeImportersOf(targetFile: string, scope: WorkspaceScope): Promise<void>` method handles Phase 1 (in-project AST removal) and Phase 2 (out-of-project walkFiles scan). `deleteFile.ts` continues to call `removeVueImportsOfDeletedFile` separately, matching the `moveFile` pattern where `compiler.afterFileRename()` is called and then Vue cleanup runs independently.

**What this enables:** compiler stays focused on TS/JS; no coupling to Vue plugin internals.
**What it rules out:** a single-call "delete everything" API — callers must still orchestrate Vue cleanup.
**Watch for:** `scope` boundary checks must be preserved exactly as in the current `deleteFile.ts` implementation.

## Security

- **Workspace boundary:** N/A — no change to file read/write paths; `scope.contains()` checks are preserved as-is in the new compiler method.
- **Sensitive file exposure:** N/A — no change to what files are read.
- **Input injection:** N/A — no new string parameters; all paths come from existing validated inputs.
- **Response leakage:** N/A — no change to response fields or error messages.

## Test layer changes

AC4 changes the testing surface for `deleteFile`. Currently `deleteFile.test.ts` (436 lines) tests two concerns tangled together: import-removal logic (compiler work) and orchestration (operation work). After the refactor:

- **Push import-removal tests down to the compiler.** The new `removeImportersOf()` method gets focused unit tests covering: in-project declaration removal, out-of-project walkFiles scan, specifier matching (bare, .js, .ts variants), workspace boundary enforcement, scope tracking. These use in-memory projects — lighter setup, faster runs, easier to mutate.
- **Thin `deleteFile.test.ts` to orchestration only.** Verify: calls compiler method, calls Vue cleanup, unlinks file, invalidates cache, returns correct result shape. Import-removal edge cases are no longer this file's concern.
- **No changes to domain utility tests.** `import-rewriter`, `rewrite-own-imports`, and `rewrite-importers-of-moved-file` tests stay as-is — those utilities are used by `afterFileRename`/`afterSymbolMove`, not affected by this spec.

Net: total test count stays similar, but layer fit improves. The compiler tests run with lighter fixtures and the operation test becomes a straightforward orchestration check.

## Edges

- `moveFile` pattern must remain working — the refactored `deleteFile` follows the same compiler-delegates pattern; verify both work after changes.
- `ts-move-symbol.ts` continues to use `getProjectForFile()` — it lives in `compilers/` and needs deep AST access. This is intentional, not a leak.
- The throwaway-project utility returns a ts-morph `SourceFile` — domain files still use ts-morph's AST API through it. The containment goal is: no `import ... from "ts-morph"` outside `compilers/`, not zero ts-morph types in the call chain.
- Mutation score for touched files must not regress.

## Done-when

- [ ] All ACs verified by tests
- [ ] Zero `import ... from "ts-morph"` in `src/domain/` and `src/operations/` (grep check)
- [ ] `getProjectForFile()` / `getProjectForDirectory()` not called outside `src/compilers/`
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - `docs/tech/ts-morph-apis.md` updated with containment approach
      - `docs/handoff.md` current-state section updated (file moves)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
