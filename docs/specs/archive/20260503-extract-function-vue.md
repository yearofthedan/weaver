# extractFunction Vue support

**type:** change
**date:** 2026-05-03
**tracks:** handoff.md # P3 → docs/features/extractFunction.md

---

## Context

`extractFunction` currently throws `NOT_SUPPORTED` for `.vue` files. Vue SFCs with `<script setup>` blocks contain TypeScript that benefits from the same extract-function capability — an agent refactoring Vue composables hits this wall constantly.

## User intent

*As an agent working on a Vue codebase, I want to extract a block of code inside a `<script setup>` block into a named function, so that I can restructure composable logic without manual cut-paste and import fixup.*

## Relevant files

- `src/plugins/vue/engine.ts` — `VolarEngine.extractFunction()` — currently throws; this is where the guard is removed and the Vue path is wired in
- `src/ts-engine/extract-function.ts` — `tsExtractFunction()` — the TS extraction logic; the Vue path replicates its core steps (refactor lookup, name substitution, edit application) but on the script block content, not the full file
- `src/ts-engine/throwaway-project.ts` — `createThrowawaySourceFile()` — used after extraction to count parameters from the updated script content
- `src/utils/text-utils.ts` — `lineColToOffset()`, `applyTextEdits()` — used for offset conversion and applying refactor edits
- `docs/features/extractFunction.md` — feature doc; the "not supported" constraint must be removed and the Vue behaviour documented
- `src/ts-engine/extract-function.test.ts` — test home for the new Vue cases (the existing `VolarEngine.extractFunction` describe block is here; Vue integration tests go there)
- `docs/tech/volar-v3.md` — architecture reference; read before touching any Vue engine code

### Red flags

- `engine.ts` is 406 lines — approaching the threshold where mixed responsibilities become a concern. The new `extractFunction` path should be extracted to `src/plugins/vue/extract-function.ts` (following the existing pattern: `get-type-errors.ts`, `delete-file.ts`, `scan.ts`). Do NOT add the implementation inline in `engine.ts`.
- `extract-function.test.ts` is 223 lines with an existing `VolarEngine.extractFunction` describe block that has one test. Adding 3 new Vue tests there is fine — no refactoring needed before this work.

**Layer-fit check:**
- AC1 and AC2 exercise the full extraction pipeline (ts-morph project creation, TS LS refactor, file write) — integration tests using a real temp dir, same pattern as the existing `tsExtractFunction` tests.
- AC3 is pure: it only checks that a `.vue` file without `<script setup>` is rejected. This can be a lightweight test that just calls `VolarEngine.extractFunction` with a minimal in-memory `.vue` content (or a temp file with no script setup block) — no full Volar project needed.

## Value / Effort

- **Value:** Agents working on Vue codebases can extract functions from `.vue` files the same way they do from `.ts` files. Today they must work around this by mentally doing the extraction manually; the tool that should help them silently says "not supported."
- **Effort:** One new file (`src/plugins/vue/extract-function.ts`, ~80 lines), a one-line change to `VolarEngine.extractFunction()`, three new integration tests, and a feature doc update. No new infrastructure; the approach reuses `createThrowawaySourceFile`, `lineColToOffset`, `applyTextEdits`, and the existing `parse()` import from `@vue/language-core`.

## Behaviour

- [ ] **AC1 — basic extraction:** Given a `.vue` file with a `<script setup lang="ts">` block and a selection covering extractable statements, `extractFunction` returns `{ filesModified: [file], filesSkipped: [], functionName: givenName, parameterCount: N }`, the `<script setup>` block in the written file contains the extracted function definition and the replacement call site, and all other SFC blocks (`<template>`, `<style>`) are byte-for-byte unchanged.
  - Layer: integration (real temp dir, real ts-morph project on script content).
  - Lazy-wrong check: returning `filesModified: []` fails; replacing only the script block and dropping `<template>` fails.

- [ ] **AC2 — parameter count:** Given a selection inside `<script setup>` that references local variables, `parameterCount` equals the count of parameters the TypeScript compiler infers for the extracted function.
  - Layer: integration (same fixture as AC1, different selection).
  - Lazy-wrong check: hardcoding `parameterCount: 0` fails.

- [ ] **AC3 — no script setup block:** Given a `.vue` file that has no `<script setup>` block (template-only, or has `<script>` without `setup`), `extractFunction` throws with code `NOT_SUPPORTED`.
  - Layer: can use a lightweight temp-file test; no Volar service needed.
  - Lazy-wrong check: silently returning an empty result fails.

## Interface

No change to the public API. `extractFunction` has the same call signature and return shape as before. The only observable difference: `.vue` paths with `<script setup>` now succeed instead of throwing.

## Open decisions

All resolved.

**Decision 1: How to run the TS refactor on a `.vue` file**

Two viable approaches:
- **Option A:** Feed the full `.vue` file through the Volar language service using the virtual `.vue.ts` path, then translate edit coordinates back to the real file using the source-map mapper.
- **Option B:** Extract the `<script setup>` content and its byte offset from the `.vue` file, create an in-memory ts-morph project with just the script content as a standalone `.ts` file, run the TS LS refactor on that, apply the resulting edits to the script content, then reconstruct the full `.vue` file.

**Resolved: Option B (script content extraction).**

Rationale: In the virtual file, the TS language service places the extracted function at "module scope" — which in the virtual `.vue.ts` includes Volar's own glue-code preamble. That insertion point does not map back to the real `.vue` file through the source-map mapper, making Option A unreliable for edit translation. Option B is predictable: refactor edits are in script-local coordinate space and translate to the full file with a fixed `+ contentStartOffset` adjustment. The TS parameter inference works correctly in isolation — it only needs the local closure scope, not full Vue component context.

**Decision 2: How to locate the `<script setup>` block and its content offset**

**Resolved: use `parse()` from `@vue/language-core`.**

API shape confirmed by probing the installed package (v3.2.7):
```typescript
const { descriptor } = parse(vueContent);  // { descriptor, errors }
const ss = descriptor.scriptSetup;          // null if no <script setup>
ss.content                                  // text between the opening and closing tags
ss.loc.start.offset                         // byte offset where content starts (right after `>` of opening tag)
ss.loc.end.offset                           // byte offset of `<` in `</script>` = contentStart + content.length
```

`parse` is already exported by `@vue/language-core` (confirmed). No new dependency needed.

**Decision 3: How to compute `parameterCount` after writing the `.vue` file**

**Resolved: use `createThrowawaySourceFile()` on the updated script content.**

After writing the new `.vue` file, re-read it, extract the `<script setup>` content again via `parse()`, create a throwaway ts-morph project with that content, and call `sf.getFunction(functionName)?.getParameters().length` on it. This mirrors the pattern in `tsExtractFunction` (reload-and-count via fresh AST) and reuses existing infrastructure.

## Security

- **Workspace boundary:** The only file written is the `.vue` file itself, via `scope.writeFile(file, ...)`, which is already boundary-checked. The script content extraction and in-memory refactor produce no additional writes.
- **Sensitive file exposure:** N/A — no new file content is read beyond what `extractFunction` already reads.
- **Input injection:** N/A — no new string parameters; `functionName` is already validated at the MCP input layer.
- **Response leakage:** N/A — no file content reaches the response; only `filesModified`, `functionName`, and `parameterCount` are returned.

## Edges

- A `.vue` file with both `<script>` and `<script setup>` blocks: `parse()` returns both; use only `descriptor.scriptSetup`. `<script>` (Options API block) is not supported.
- A selection that spans outside the `<script setup>` block (e.g., straddles the opening tag): the script-local offset will be negative after subtraction. Treat as `NOT_SUPPORTED` with a clear message.
- The extracted function is placed at the outermost scope in the script content (same as the TS path). It is not exported.
- Template and style blocks are read-only throughout; the only mutation is to the script content slice.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [x] `pnpm check` passes (lint + build + test)
- [x] No touched source or test file exceeds the hard flag in `docs/code-standards.md`
- [x] Docs updated:
  - `docs/features/extractFunction.md` — remove the "`.vue` files are not supported" constraint; add a note that `.vue` files with `<script setup>` are supported, and that files without `<script setup>` return `NOT_SUPPORTED`
  - `.claude/skills/move-and-rename/SKILL.md` — updated Vue constraint
  - `docs/handoff.md` — P3 entry removed
- [x] Non-obvious gotchas added to `docs/tech/volar-v3.md` (in-memory TS LS path gotcha)
- [x] Spec moved to `docs/specs/archive/` with Outcome section appended

## Outcome

**Tests added:** 3 integration tests in `VolarEngine.extractFunction` describe block in `src/ts-engine/extract-function.test.ts`.

**New files:** `src/plugins/vue/extract-function.ts` (87 lines), `src/ts-engine/extract-symbol.ts` (88 lines — extracted shared TS LS logic that both TS and Vue implementations use).

**Mutation score:** Not run in this session (pre-commit hook covers coverage; full mutation run is a separate operation).

### Reflection

**What went well:**
- Option B (in-memory script extraction) worked exactly as predicted in the spec. The `parse()` API from `@vue/language-core` is stable and the offset math is straightforward.
- The spec's resolved decisions eliminated architectural debate during implementation — the executor just coded.
- The code-review step caught real duplication (~55 lines) that the spec hadn't anticipated. Extracting `applyExtractSymbol()` into `src/ts-engine/extract-symbol.ts` was the right call; now both engines share the TS LS interaction logic.

**What did not go well:**
- AC2's initial test design was wrong: the test used module-scope variables (`const a`, `const b` at `<script setup>` top level), but the TS LS does NOT parameterize same-scope variables — they're directly accessible. The extracted function had 0 parameters. The test fixture had to be redesigned to use variables local to a nested function so that the TS LS would create parameters. This was a spec blind spot; the AC said "references local variables" without specifying they must be local to a nested scope.
- The in-memory TS LS path gotcha (virtual paths have a leading `/`) caused a silent failure: `modifiedScriptContent` was never updated because the `path.basename` check was not yet in place. The failure showed up as a test assertion error on file content, not as an obvious "edits not applied" message.

**What took longer than it should:**
- Identifying the root cause of AC1's silent failure (file content unchanged). The TS LS returns `/script.ts` not `script.ts`, so the edit filter never matched. This took debugging time that would have been saved with a defensive assertion in the loop.

**Recommendations for follow-up:**
- AC2 tests for `parameterCount > 0` should always use a nested-function fixture — module-scope extraction never produces parameters in `<script setup>` context.
- The `applyExtractSymbol()` utility is now shared infrastructure. Any future extract-to-function-style refactor (e.g. extract to constant, extract to method) should start by checking whether it can reuse or extend this function rather than re-implementing the TS LS interaction.
