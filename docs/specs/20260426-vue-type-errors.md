# getTypeErrors Vue SFC support

**type:** change
**date:** 2026-04-26
**tracks:** handoff.md # getTypeErrors Volar support → docs/features/getTypeErrors.md

---

## Context

`getTypeErrors` currently only checks `.ts`/`.tsx` files via `TsMorphEngine`. The dispatcher always calls `registry.tsEngine()`, bypassing the Vue plugin entirely. Agents working in Vue projects cannot verify whether their refactoring changes broke `.vue` SFC type correctness.

## User intent

*As an agent working in a Vue project, I want `getTypeErrors` to report type errors in `.vue` files, so that I can verify refactoring changes didn't break Vue component types.*

## Relevant files

- `src/operations/getTypeErrors.ts` — current operation; takes `TsMorphEngine`, needs to change to `Engine`
- `src/operations/getTypeErrors.test.ts` — 227 lines; Vue tests belong here (same operation, same layer) — will grow to ~310 lines, past "review at 300"; assess existing tests for the refactoring hierarchy before adding new ones
- `src/ts-engine/types.ts` — `Engine` interface; add `getTypeErrors` method; `GetTypeErrorsResult` already defined
- `src/ts-engine/engine.ts` — `TsMorphEngine`; implement `getTypeErrors` wrapping existing logic
- `src/plugins/vue/engine.ts` — `VolarEngine` at 391 lines; add `getTypeErrors`; extract to standalone file if it pushes past 450
- `src/plugins/vue/service.ts` — `CachedService.baseService` (raw `ts.LanguageService`) used for `getSemanticDiagnostics`; `vueVirtualToReal` used for file enumeration in project-wide mode
- `src/daemon/dispatcher.ts` — change `getTypeErrors` entry to use `registry.projectEngine()` instead of `registry.tsEngine()`
- `src/daemon/post-write-diagnostics.ts` — out of scope; `.vue` post-write diagnostics are a separate enhancement
- `src/utils/text-utils.ts` — `offsetToLineCol` used to convert real `.vue` byte offset to 1-based line/col
- `docs/features/getTypeErrors.md` — update Constraints section and How it works diagram
- `src/__testHelpers__/fixtures/fixtures.ts` — may need a new Vue-errors fixture

### Red flags

- **`engine.test.ts` at 478 lines** — at the 500-line hard flag. Vue `getTypeErrors` tests belong at the operation layer (`getTypeErrors.test.ts`), not here. Do not add tests to `engine.test.ts` for this feature.
- **`VolarEngine` at 391 lines** — already past "review at 300". If the `getTypeErrors` implementation adds more than ~50 lines, extract to `src/plugins/vue/get-type-errors.ts` (following the `ts-engine/` standalone action pattern) and call it from `VolarEngine`.

**Layer-fit:**
- AC1–AC4: All require a real Volar service → integration layer. Tests go in `src/operations/getTypeErrors.test.ts` alongside the existing TS tests (same operation, same layer).
- Position translation logic (virtual offset → real `.vue` line/col) is a pure function of its inputs — if extracted to a standalone helper, add a focused unit test for it directly rather than covering it only through the integration path.

## Value / Effort

- **Value:** Agents in Vue projects can verify type correctness after refactoring. Without this, `getTypeErrors` silently skips all `.vue` files — a false "no errors" response that misleads agents into committing broken code.
- **Effort:** Medium. Four files to modify (operation, Engine interface, TsMorphEngine, VolarEngine) plus dispatcher. The Volar machinery (source maps, virtual path mapping) already exists in `VolarEngine`; this reuses it. A new test fixture is needed. Estimated 5–8 touched files including tests.

## Behaviour

- [ ] **AC1** — Single-file, Vue with SFC errors: Given `file` pointing to a `.vue` file whose SFC contains a type error (anywhere: script block, template binding, prop mismatch), `getTypeErrors` returns a diagnostic with `file` set to the real `.vue` path (not the virtual `.vue.ts`), `line` and `col` as 1-based positions in the actual `.vue` source, the correct TS error code, and the top-level message. Virtual-position-only diagnostics (Volar glue code with no source mapping) are excluded.
  - *Layer: integration. Laziest wrong impl: return the virtual `.vue.ts` path or virtual positions — pin exact file, line, col in the assertion.*

- [ ] **AC2** — Single-file, Vue with no errors: Given `file` pointing to a `.vue` file with no type errors, `getTypeErrors` returns `{ diagnostics: [], errorCount: 0, truncated: false }`.
  - *Layer: integration. Laziest wrong impl: always return the TS project's errors regardless of file — use a clean Vue fixture.*

- [ ] **AC3** — Project-wide in a Vue project: Given no `file` argument in a project that has type errors in both `.ts` files and `.vue` files, `getTypeErrors` returns errors from both. `.vue` errors have `file` pointing to the real `.vue` path (not virtual). The 100-error cap and `truncated` flag apply across the combined set.
  - *Layer: integration. Laziest wrong impl: skip `.vue` files entirely (current behavior) — assert that a `.vue` error appears in results.*

- [ ] **AC4** — `.ts` file in Vue project (regression guard): Given `file` pointing to a `.ts` file in a Vue project (routed through `VolarEngine`), `getTypeErrors` returns the same type errors as it would in a pure TS project with the same file.
  - *Layer: integration. One smoke test; covers the delegation path in `VolarEngine`.*

## Interface

No new parameters or response fields. The existing `GetTypeErrorsResult` shape is unchanged:

```typescript
interface GetTypeErrorsResult {
  diagnostics: TypeDiagnostic[];
  errorCount: number;   // true total, may exceed diagnostics.length when truncated
  truncated: boolean;   // true when capped at MAX_DIAGNOSTICS (100)
}

interface TypeDiagnostic {
  file: string;    // absolute path to the real .vue file (never the virtual .vue.ts path)
  line: number;    // 1-based line in the real .vue source
  col: number;     // 1-based column in the real .vue source
  code: number;    // TS diagnostic code (e.g. 2322)
  message: string; // top-level message text only (no chain)
}
```

`getTypeErrors` continues to accept an optional `file` (absolute path, `.ts` or `.vue`) and no-arg project-wide mode. No schema changes needed.

**Adversarial cases:**
- `.vue` file with only a `<template>` block (no `<script>`) — Volar generates no TypeScript service script; `getServiceScript` returns null; result is empty diagnostics (graceful, not an error).
- Volar glue code positions (no source map entry) — excluded from results, consistent with `translateSingleLocation` returning null.
- More than 100 errors across the combined TS + Vue set — truncated at 100; `errorCount` reflects the true total.

## Open decisions

All decisions resolved during spec:

**Engine interface extension:** Add `getTypeErrors(file: string | undefined, scope: WorkspaceScope): Promise<GetTypeErrorsResult>` to the `Engine` interface. `TsMorphEngine` delegates to existing `getForFile`/`getForProject` helpers. `VolarEngine` handles `.vue` files via Volar's `baseService.getSemanticDiagnostics(virtualPath)` and delegates `.ts` files to `this.tsEngine`. Dispatcher changes from `registry.tsEngine()` to `registry.projectEngine()`. This follows the identical pattern used by `extractFunction`.

**Position translation:** Virtual offset → real `.vue` offset via `mapper.toSourceLocation()` (same source-map machinery as `translateSingleLocation`). Real `.vue` offset → 1-based line/col via `offsetToLineCol()` from `text-utils.ts`. No need to construct a full TS `SourceFile` from the real content.

**Project-wide Vue file enumeration:** `VolarEngine.getTypeErrors(undefined, scope)` calls `this.tsEngine.getTypeErrors(undefined, scope)` to get TS errors, then builds/reuses a Volar service for the workspace root, iterates `service.vueVirtualToReal.keys()` to enumerate virtual `.vue.ts` paths, calls `baseService.getSemanticDiagnostics(virtualPath)` per file, translates positions, and merges. The 100-cap applies to the combined total.

**Template vs script-only:** Include all type errors from the virtual `.vue.ts` (matching `vue-tsc` and IDE behavior). Filtering to script-block-only would produce false negatives when a template references a renamed variable. The added complexity of SFC block-range filtering is not justified.

## Security

- **Workspace boundary:** `file` (when provided) is validated against the workspace in the operation layer before the engine is called — unchanged from current behavior. Project-wide mode iterates files registered in the Volar service for the workspace tsconfig; no files outside the project graph are checked.
- **Sensitive file exposure:** Diagnostics are read-only; no file content is written or returned. Same as existing TS behavior.
- **Input injection:** No new string parameters. `file` path already validated.
- **Response leakage:** Diagnostic messages come from the TypeScript compiler, same as existing behavior.

## Edges

- `.vue` files with no `<script>` block (template-only) return empty diagnostics — no error.
- Warnings and suggestions are excluded; only `DiagnosticCategory.Error`. Same policy as TS path.
- `errorCount` is the true total across both TS and `.vue` files combined.
- The dispatcher creates `makeRegistry(workspace, workspace)` for `getTypeErrors` (pathParams is empty). `projectEngine()` calls `findTsConfigForFile(workspace)` — this correctly detects Vue projects since the workspace root contains the tsconfig.
- Post-write type checking (`getTypeErrorsForFiles`) is out of scope; it still skips `.vue` files. A separate `[needs design]` entry covers that.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds 500 lines (hard flag). `VolarEngine` must stay under 500; extract `src/plugins/vue/get-type-errors.ts` if needed.
- [ ] Docs updated:
  - `docs/features/getTypeErrors.md` — remove `.vue` not-supported constraint; update How it works diagram to show the Volar path; update Constraints section
  - `handoff.md` current-state section if layout changed
  - Skill files in `.claude/skills/` — check if any reference `getTypeErrors`; update if `.vue` support needs to be discoverable
- [ ] Tech debt discovered during implementation added to `handoff.md` as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/tech/volar-v3.md` or `docs/features/getTypeErrors.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
