# findReferences by file path

**type:** change
**date:** 2026-03-29
**tracks:** handoff.md # findReferences by file path → docs/features/findReferences.md

---

## Context

`findReferences` currently requires `file + line + col` to locate a symbol, then returns every reference to that symbol. Agents frequently need the simpler question: "who imports this file?" — e.g. before deleting, moving, or understanding a file's dependents. Today the only way to answer that is `searchText` with a guessed import path pattern, which misses path aliases, barrel re-exports, and extensionless imports.

## User intent

*As an AI coding agent, I want to ask "who imports this file?" by providing just a file path, so that I can understand a file's dependents before modifying, moving, or deleting it — without guessing import specifier patterns.*

## Relevant files

- `src/operations/findReferences.ts` — current symbol-based findReferences; will gain file-path mode
- `src/operations/findReferences.test.ts` — existing tests; new tests go here
- `src/operations/types.ts` — `FindReferencesResult` type; may need a new result type or reuse
- `src/ts-engine/engine.ts` — `TsMorphEngine`; needs `getFileReferences` wrapper
- `src/ts-engine/types.ts` — `Engine` interface; needs new method signature
- `src/plugins/vue/engine.ts` — `VolarEngine`; needs to implement the new method
- `src/plugins/vue/service.ts` — `VolarLanguageService` interface; needs `getFileReferences` added
- `src/adapters/schema.ts` — `FindReferencesArgsSchema`; line/col become optional
- `src/adapters/mcp/tools.ts` — tool description; update to mention file-path mode
- `src/daemon/dispatcher.ts` — `findReferences` descriptor; pass through optional line/col
- `src/adapters/cli/operations.ts` — CLI registration; line/col become optional

### Red flags

- `src/operations/findReferences.test.ts` is 99 lines — well under threshold, safe to extend.

## Value / Effort

- **Value:** Agents restructuring a project (moving/deleting/refactoring files) need to know dependents. Today they must guess import specifier patterns with `searchText`, which misses path aliases, barrel re-exports, index file imports, and extensionless specifiers. This gives them a single compiler-accurate call that answers "who imports this file?" — the same question `deleteFile` and `moveFile` answer internally but don't expose as a read-only query.
- **Effort:** Low. TypeScript's LS already has `getFileReferences(fileName)` returning `ReferenceEntry[]`. The work is: (1) add an engine method wrapping it, (2) make line/col optional in the schema/operation, (3) branch in the operation to call the file-level path when line/col are omitted. ~5 files touched, all plumbing through existing patterns.

## Behaviour

- [ ] **AC1: File-path mode returns importers.** Given `findReferences({ file: "/path/to/utils.ts" })` (no `line`, no `col`), returns `{ references: [{file, line, col, length}, ...] }` listing every import/re-export statement that references the given file. Each reference points to the import specifier string (the `"./utils"` part), not the imported symbol name. `symbolName` is the basename of the queried file (e.g. `"utils.ts"`).

- [ ] **AC2: File with no importers returns empty references.** Given a file that exists but is not imported by anything, returns `{ symbolName: "leaf.ts", references: [] }` (empty array, no error thrown). This differs from symbol-mode which throws `SYMBOL_NOT_FOUND` — a file always "exists" as a reference target even if nothing imports it.

- [ ] **AC3: Symbol mode unchanged.** Given `findReferences({ file, line, col })` with all three present, behaviour is identical to the current implementation (returns symbol references, throws `SYMBOL_NOT_FOUND` for no-symbol positions).

- [ ] **AC4: Vue — `.ts` target imported by `.vue` files.** Given a `.ts` file imported by both `.ts` and `.vue` files in a Vue project, file-path mode returns references from both file types with correct line/col positions (virtual-path translation applied for `.vue` output locations).

- [ ] **AC5: Vue — `.vue` target imported by other files.** Given a `.vue` file imported by `.ts` or other `.vue` files, file-path mode returns references with correct positions. The engine queries the virtual `.vue.ts` path internally and translates results back to real `.vue` coordinates.

## Interface

### Parameters (updated `findReferences` tool)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | `string` | yes | Absolute path to the file |
| `line` | `number` | no | Line number (1-based). Omit with `col` for file-path mode. |
| `col`  | `number` | no | Column number (1-based). Omit with `line` for file-path mode. |

Validation: `line` and `col` must be both present or both absent. If one is provided without the other, return `VALIDATION_ERROR`.

### Response shape (both modes)

```typescript
{
  status: "success",
  symbolName: string,      // symbol name (symbol mode) or file basename (file mode)
  references: Array<{
    file: string,           // absolute path
    line: number,           // 1-based
    col: number,            // 1-based
    length: number          // span length
  }>
}
```

File-path mode: `references` may be empty (no importers). Symbol mode: empty references still throws `SYMBOL_NOT_FOUND` (no change).

### Error codes

No new error codes. Existing codes apply:
- `FILE_NOT_FOUND` — file doesn't exist
- `SYMBOL_NOT_FOUND` — symbol mode only, no symbol at position
- `VALIDATION_ERROR` — line without col or vice versa

### Tool description update

The `findReferences` tool description should be updated to mention both modes:

> "Before modifying, moving, or deleting a symbol, use this to see every file that depends on it. Omit line and col to find every file that imports a given file instead. The compiler tracks references through re-exports, barrel files, type-only imports, and Vue SFCs — scope-aware, so it ignores unrelated identifiers with the same name. Returns a references array of {file, line, col, length} including the declaration site."

## Open decisions

None. The key design choices are resolved:

**Same tool vs new tool:** Overload the existing `findReferences` tool. Rationale: a new tool adds to the agent's tool description context budget. The two modes are semantically the same question at different granularity ("who uses this symbol?" vs "who uses this file?"). Making `line`/`col` optional is a natural extension — agents already know `findReferences`, and the tool description tells them to omit line/col for the file-level query.

**Engine interface:** Add `getFileReferences(file: string): Promise<SpanLocation[] | null>` to the `Engine` interface. TsMorphEngine delegates to `ls.getFileReferences(fileName)`. VolarEngine: Volar's proxy LS does not expose `getFileReferences`, so VolarEngine must query the underlying TS language service directly (via the proxy or the base service) using the virtual `.vue.ts` path for `.vue` targets, then translate results back through `translateLocations`. Add `getFileReferences` to the hand-typed `VolarLanguageService` interface in `service.ts`. The operation layer branches based on whether `line`/`col` are provided.

## Security

- **Workspace boundary:** Read-only — same as existing `findReferences`. The `file` parameter is already validated against the workspace boundary by the dispatcher. Output references may include files outside the workspace (consistent with symbol-mode behaviour; no write risk).
- **Sensitive file exposure:** N/A — returns reference locations (file/line/col), not file contents. Does not read or return content of sensitive files.
- **Input injection:** N/A — `file` path is already validated by `validateFilePath` + `isWithinWorkspace` in the dispatcher.
- **Response leakage:** N/A — response contains only file paths and positions, no file content.

## Edges

- `getFileReferences` may return references from files outside the workspace (e.g. node_modules if in the project graph). These are returned as-is, consistent with symbol-mode.
- The TS LS `getFileReferences` returns spans pointing at the module specifier string literal. The line/col in results should point at the start of that string (after the opening quote), matching how agents would locate the import to modify it.
- If the file exists on disk but is not in the ts-morph project graph (e.g. a `.json` or `.css` file), `getFileReferences` returns empty results — this is correct, as the TS compiler only tracks TS/JS imports.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - Feature doc updated: `docs/features/findReferences.md` (add file-path mode section, update constraints)
      - Skill file updated: `.claude/skills/code-inspection/SKILL.md` (add "Find all importers of a file" section with CLI example)
      - handoff.md current-state section (no layout change needed)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
