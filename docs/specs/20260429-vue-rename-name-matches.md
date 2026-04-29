# nameMatches for Vue renames

**type:** change
**date:** 2026-04-29
**tracks:** handoff.md # nameMatches for Vue renames → docs/features/rename.md

---

## Context

`VolarEngine.rename` omits the `nameMatches` field that TypeScript renames provide. After renaming a symbol in a Vue project, agents receive no signal that derivative identifiers (e.g. `useCounterSingleton` after renaming `useCounter`) may need manual follow-up. The constraint was documented in `docs/features/rename.md` as a v1 exclusion; this spec lifts it.

## User intent

*As an agent using `rename` in a Vue project, I want `nameMatches` returned after the operation, so that I can identify derivative identifiers that weren't automatically updated.*

## Relevant files

- `src/plugins/vue/engine.ts` — `VolarEngine.rename` method (lines 350–406); this is where nameMatches must be computed and returned
- `src/ts-engine/name-matches.ts` — `scanNameMatches`, `containsName`, `ExcludePosition`; export `containsName` for reuse
- `src/ts-engine/rename.ts` — reference implementation: shows how excludePositions + scanNameMatches integrates with the write loop
- `src/plugins/vue/scan.ts` — existing `parse` usage from `@vue/language-core`; shows the `descriptor.script / descriptor.scriptSetup` pattern and `block.loc.start.offset / end.offset` for slicing block content
- `src/ts-engine/throwaway-project.ts` — `createThrowawaySourceFile`; used for in-memory identifier walking without a real project
- `src/utils/text-utils.ts` — `offsetToLineCol`; converts a byte offset to 1-based `{ line, col }`
- `src/operations/types.ts` — `RenameResult`, `NameMatchSample`; `nameMatches` field must become required and its comment updated
- `src/plugins/vue/engine.test.ts` — integration test home for `VolarEngine`; **478 lines — see Red flags**

### Red flags

**Test hotspot:** `src/plugins/vue/engine.test.ts` is 478 lines, within 22 lines of the 500-line hard flag. Adding AC 1 and AC 2 tests will push it over. Before writing new tests, the implementation agent must assess whether the `deleteFile` describe block (~140 lines, lines 365–478) can be extracted to `engine.deleteFile.test.ts`. Apply the test refactoring hierarchy: push integration tests down → decompose source → extract fixtures → split by area. Do not add new tests without first making this assessment.

**`containsName` is not exported.** Export it from `ts-engine/name-matches.ts` so the new Vue scanning function can reuse it rather than duplicating it.

**Layer-fit check:**
- AC 1 (`.ts` file scanning): pure function of old content + exclude positions → unit-testable with a throwaway source file. One integration smoke test to confirm it is wired into `VolarEngine.rename`.
- AC 2 (`.vue` script block scanning): the offset-to-real-position translation is a pure function → extract and unit-test it directly. One integration smoke test for the full wiring.

## Value / Effort

- **Value:** Agents using `rename` in TS-only projects already get `nameMatches`. Vue-project renames are a silent gap — agents must do a separate `searchText` pass to find derivatives. Closing this removes a manual follow-up step with no change to the call interface.
- **Effort:** Moderate. One new file (`src/plugins/vue/name-matches.ts`), one export added to `ts-engine/name-matches.ts`, and a small addition to `VolarEngine.rename`. No new public interface, no new error codes, no schema changes.

## Behaviour

- [ ] **AC 1 — Scans modified `.ts` files; renamed locations excluded even when `newName ⊇ oldName`.**
  Given a Vue project where renaming `useCounter → useCounterValue` modifies `useCounter.ts` (which also contains `const useCounterHelper = ...`): `result.nameMatches` includes `useCounterHelper` with correct `file`, `line`, `col` (1-based), `name`, and `kind`. The renamed `useCounter` call sites are absent from `nameMatches`. `result.nameMatches` is always an array.
  *Test layer:* integration (one test). The "excluded even when newName ⊇ oldName" clause kills the lazy bug of skipping excludePositions — without it both Option A and the buggy Option B pass green.

- [ ] **AC 2 — Scans modified `.vue` files' script blocks with real file coordinates, `kind`, and both block types.**

  Given a `.vue` file whose `<template>` block comes first (so `<script setup>` is not at line 1) and whose `<script setup>` block contains `const useCounterRef = useCounter(0)`:
  - `result.nameMatches` includes `useCounterRef` with `file` = real `.vue` path, `line`/`col` = 1-based position in the **full** `.vue` file (not block-relative — verified by the `<template>`-first layout), and `kind` = the ts-morph SyntaxKind name of the parent node (e.g. `VariableDeclaration`).
  - A `.vue` file with both `<script>` and `<script setup>` present: derivative identifiers in both blocks appear in `nameMatches`.
  - A template-only `.vue` file (no script block) contributes nothing to `nameMatches`.
  - `result.nameMatches` is always an array.
  *Test layer:* the block-offset → real-position translation is a pure function; extract and unit-test it directly. One integration smoke test verifies the full wiring through `VolarEngine.rename`.

> **Type matrix check:** The rename source may be a `.ts` file (modifying both `.ts` and `.vue` files) — both are exercised. `.vue`-sourced renames are out of scope for this spec. Template identifiers are not TS identifiers and are not scanned.

## Interface

`nameMatches` becomes required in `RenameResult`. Update `src/operations/types.ts`:

```typescript
/** Present on TS renames; absent on Vue renames. Complete list — not sampled. */
nameMatches?: NameMatchSample[];
```

→ becomes:

```typescript
/** Complete list of derivative identifiers in modified files — not sampled. */
nameMatches: NameMatchSample[];
```

## Open decisions

**Decision 1 — Old content capture (correctness requirement, not a tradeoff)**

**Resolved: capture `original` before `scope.writeFile`.**

Option B (scan new content after writes, no excludePositions) is a correctness bug: renaming to an extended name (`foo → fooBar`) is extremely common; Option B silently returns false positives because the renamed sites still match `containsName`. This rules it out.

Implementation: in the `VolarEngine.rename` write loop, `original = this.readFile(fileName)` is already computed before `scope.writeFile`. Save it into `oldContents: Map<string, string>` before writing. After the loop, scan from `oldContents`.

For `.ts` files: `this.readFile(fileName)` reads from the Volar service cache, which holds old content before writes. For `.vue` files: same — service cache is only updated by `service.fileContents.set(fileName, updated)` which runs after `scope.writeFile`, so `readFile` returns old content at capture time.

**Decision 2 — New function: `scanVueNameMatches` in `src/plugins/vue/name-matches.ts`**

**Resolved: new file, new function, cannot reuse `scanNameMatches` wholesale.**

`scanNameMatches` in `ts-engine/name-matches.ts` takes a ts-morph `Project` and uses `project.getSourceFile(filePath)` — this works for `.ts` files in a real project but returns `undefined` for `.vue` files (they are not part of any ts-morph project).

The new `scanVueNameMatches(oldName, oldContents, excludePositions)` function:
- Takes `oldContents: Map<string, string>` (file path → old content)
- For `.ts` files: call `createThrowawaySourceFile(filePath, content)`, walk `SyntaxKind.Identifier` nodes, apply `containsName` + exclude check, convert offset → line/col via the source file's own `getLineAndCharacterOfPosition`
- For `.vue` files: call `parse(content)` from `@vue/language-core`, scan both `descriptor.scriptSetup` and `descriptor.script` if present; for each block, slice `content.slice(block.loc.start.offset, block.loc.end.offset)`, create a throwaway source file with that slice, walk identifiers, then translate block-relative offset to real file offset by adding `block.loc.start.offset`, then use `offsetToLineCol(content, realOffset)` to get 1-based line/col in the full `.vue` file

Adding `@vue/language-core` to `src/plugins/vue/name-matches.ts` is correct coupling — the function lives in the Vue plugin.

**Decision 3 — One throwaway project per modified file**

**Resolved: one project per file; no batching.**

Each modified file gets its own `createThrowawaySourceFile` call (one in-memory `Project` with one file). For typical renames (2–10 files) this is fast enough. Batching all blocks into a single project is a future optimisation if profiling shows it matters.

## Security

- **Workspace boundary:** `nameMatches` only scans `scope.modified` — files already boundary-checked and written by `VolarEngine.rename`. No new filesystem reads beyond those already performed.
- **Sensitive file exposure:** Identifiers are returned by name and position, not by file content. N/A.
- **Input injection:** No new parameters; `oldName` is derived from file content at a compiler-verified position. N/A.
- **Response leakage:** `nameMatches` entries contain identifier names from source files. These are no more sensitive than `filesModified` already returned. N/A.

## Edges

- Skipped files (`scope.skipped`) are not scanned — matches `tsRename` behaviour.
- If `oldName` is a short common substring (e.g. a single character), `nameMatches` may be large. This is consistent with the TS behaviour and is not capped.
- Identifiers in Vue `<template>` blocks are not TS identifiers and are not scanned.
- Line endings: assume LF. The throwaway source file is created from the raw content slice; `offsetToLineCol` handles LF correctly. CRLF is not a supported input format.

## Done-when

- [ ] All ACs verified by tests
- [ ] Unit test for block-offset → real-position translation (the pure sub-function extracted from AC 3 logic)
- [ ] Integration smoke test: `VolarEngine.rename` returns `nameMatches` with correct entries for a `.ts` source rename that modifies both `.ts` and `.vue` files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] No touched source or test file exceeds the 500-line hard flag. If `engine.test.ts` is pushed over, extract the `deleteFile` describe block first (see Red flags).
- [ ] Docs updated:
  - `docs/features/rename.md`: remove "absent on Vue renames" constraint from the Constraints section; update the Response section to note `nameMatches` is now present for all renames
  - `src/operations/types.ts`: update `nameMatches` comment (see Interface section)
  - `docs/handoff.md`: remove the task entry
- [ ] `containsName` is exported from `src/ts-engine/name-matches.ts`
- [ ] Tech debt discovered during implementation added to `docs/handoff.md` as `[needs design]`
- [ ] Non-obvious gotchas added to `docs/features/rename.md` or `.claude/MEMORY.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
