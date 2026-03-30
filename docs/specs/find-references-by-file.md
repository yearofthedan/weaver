# findImporters — "who imports this file?"

**type:** change
**date:** 2026-03-29
**tracks:** handoff.md # findReferences by file path

---

## Context

`findReferences` currently requires `file + line + col` to locate a symbol, then returns every reference to that symbol. Agents frequently need the simpler question: "who imports this file?" — e.g. before deleting, moving, or understanding a file's dependents. Today the only way to answer that is `searchText` with a guessed import path pattern, which misses path aliases, barrel re-exports, and extensionless imports.

## User intent

*As an AI coding agent, I want to ask "who imports this file?" by providing just a file path, so that I can understand a file's dependents before modifying, moving, or deleting it — without guessing import specifier patterns.*

## Relevant files

- `src/operations/findImporters.ts` — **new** operation file for file-level references
- `src/operations/findImporters.test.ts` — **new** test file
- `src/operations/types.ts` — `FindReferencesResult` type; reuse for `FindImportersResult` or add a new type
- `src/ts-engine/engine.ts` — `TsMorphEngine`; needs `getFileReferences` wrapper
- `src/ts-engine/types.ts` — `Engine` interface; needs new method signature
- `src/plugins/vue/engine.ts` — `VolarEngine`; needs to implement the new method
- `src/plugins/vue/service.ts` — `VolarLanguageService` interface; needs `getFileReferences` added
- `src/adapters/schema.ts` — new `FindImportersArgsSchema` (just `{ file }`)
- `src/adapters/mcp/tools.ts` — new `findImporters` tool definition
- `src/daemon/dispatcher.ts` — new `findImporters` operation descriptor
- `src/adapters/cli/operations.ts` — new `find-importers` CLI subcommand

## Value / Effort

- **Value:** Agents restructuring a project (moving/deleting/refactoring files) need to know dependents. Today they must guess import specifier patterns with `searchText`, which misses path aliases, barrel re-exports, index file imports, and extensionless specifiers. This gives them a single compiler-accurate call that answers "who imports this file?" — the same question `deleteFile` and `moveFile` answer internally but don't expose as a read-only query.
- **Effort:** Low. TypeScript's LS already has `getFileReferences(fileName)` returning `ReferenceEntry[]`. The work is: (1) add an engine method wrapping it, (2) new operation + schema + tool definition + dispatcher entry, all following existing patterns. ~10 files touched but each change is small plumbing.

## Behaviour

- [ ] **AC1: `findImporters` returns importers.** Given `findImporters({ file: "/path/to/utils.ts" })`, returns `{ fileName: "utils.ts", references: [{file, line, col, length}, ...] }` listing every import/re-export statement that references the given file. Each reference points to the import specifier string (the `"./utils"` part), not the imported symbol name. `fileName` is the basename of the queried file.

- [ ] **AC2: File with no importers returns empty references.** Given a file that exists but is not imported by anything, returns `{ fileName: "leaf.ts", references: [] }` (empty array, no error thrown).

- [ ] **AC3: Vue — `.ts` target imported by `.vue` files.** Given a `.ts` file imported by both `.ts` and `.vue` files in a Vue project, `findImporters` returns references from both file types with correct line/col positions (virtual-path translation applied for `.vue` output locations).

- [ ] **AC4: Vue — `.vue` target imported by other files.** Given a `.vue` file imported by `.ts` or other `.vue` files, `findImporters` returns references with correct positions. The engine queries the virtual `.vue.ts` path internally and translates results back to real `.vue` coordinates.

## Interface

### New `findImporters` tool

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | `string` | yes | Absolute path to the file |

### Response shape

```typescript
{
  status: "success",
  fileName: string,         // basename of the queried file
  references: Array<{
    file: string,           // absolute path of the importing file
    line: number,           // 1-based
    col: number,            // 1-based
    length: number          // span length
  }>
}
```

`references` may be empty (no importers) — this is not an error.

### Error codes

- `FILE_NOT_FOUND` — file doesn't exist

### `findReferences` tool — unchanged

No modifications to the existing `findReferences` tool. It continues to require `file`, `line`, `col`.

### `findImporters` tool description

> "Before moving, deleting, or understanding a file's dependents, use this to find every file that imports it. Provide just a file path — no line/col needed. The compiler tracks through re-exports, barrel files, type-only imports, and Vue SFCs. Returns { fileName, references: [{file, line, col, length}] }. Empty references means nothing imports this file."

## Open decisions

None. The key design choices are resolved:

**Separate tool, not an overload.** A new `findImporters` tool with just `{ file }`. Rationale: overloading `findReferences` with optional `line`/`col` creates a hidden mode that agents won't discover — the name suggests symbol-level work, and "omit line and col" is easy to miss. A dedicated tool is self-describing: the agent sees `findImporters` in the tool list and immediately knows what it does. The context cost is ~2 lines of tool description.

**Engine interface:** Add `getFileReferences(file: string): Promise<SpanLocation[] | null>` to the `Engine` interface. TsMorphEngine delegates to `ls.getFileReferences(fileName)`. VolarEngine: Volar's proxy LS does not expose `getFileReferences`, so VolarEngine must query the underlying TS language service directly (via the proxy or the base service) using the virtual `.vue.ts` path for `.vue` targets, then translate results back through `translateLocations`. Add `getFileReferences` to the hand-typed `VolarLanguageService` interface in `service.ts`.

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
      - Feature doc created: `docs/features/findImporters.md`
      - Feature index updated: `docs/features/README.md` (add findImporters entry)
      - Skill file updated: `.claude/skills/code-inspection/SKILL.md` (add `findImporters` section with CLI example)
      - handoff.md current-state section updated (new operation file, new test file)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/features/` or `docs/tech/` doc, or `.claude/MEMORY.md` if cross-cutting (skip if nothing worth recording)
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
