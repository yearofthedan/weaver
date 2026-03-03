# deleteFile operation

**type:** change
**date:** 2026-03-03
**tracks:** handoff.md # deleteFile → docs/features/deleteFile.md

---

## Context

Agents frequently need to delete files during refactoring — removing dead code, pruning stale modules, collapsing a barrel. Without compiler-aware deletion, the agent must manually find all importers with `searchText` and remove each import with `replaceText`, risking missed references. `deleteFile` collapses that workflow into one compiler-backed call that removes the file and cleans its import footprint in one step.

## Value / Effort

- **Value:** Saves a multi-step search-and-edit workflow for every file deletion involving imports. More importantly, it prevents silent breakage: a text-based approach can miss re-exports in barrel files, `export * from` chains, out-of-project test files, or Vue SFC script blocks that import the deleted module. The compiler tracks TS/JS references; the regex scan (same approach as `vue-scan.ts`) handles Vue SFCs.
- **Effort:** Medium. One new operation file, one new result type, schema entry, dispatcher entry, MCP tool entry, and feature doc. The TS/JS cleanup follows the `afterFileRename` pattern already in `TsProvider`. The Vue cleanup adds one new function to `vue-scan.ts` — simpler than `updateVueImportsAfterMove` because deletion removes the line rather than rewriting the path.

## Behaviour

- [ ] **AC1 — In-project TS/JS cleanup (imports and re-exports):** Given a file `foo.ts` that is imported or re-exported by other TS/JS files in the project (`import { x } from './foo'`, `export { x } from './foo'`, `export * from './foo'`), the operation removes those declarations, writes the affected files, and returns `filesModified` listing them and `importRefsRemoved` with the count of removed declarations. The deleted file itself is absent from `filesModified`.

  *Laziness test:* "only remove `import` declarations, ignore `export … from`" — fails because barrel files with `export * from './foo'` would not be cleaned.

- [ ] **AC2 — Physical deletion:** After the operation, the target file no longer exists on disk. This holds even when the file has no importers (zero-importer case).

  *Laziness test:* "only remove importers but leave the file" — fails because the file must be gone.

- [ ] **AC3 — Out-of-project TS/JS file cleanup:** TS/JS files in the workspace that are not included in the tsconfig (e.g. test files outside `src/`) and that import the deleted file are also cleaned. Their import/re-export declarations are removed and they appear in `filesModified`.

  *Laziness test:* "only scan project source files via ts-morph, skip unlisted files" — fails for test fixtures outside `tsconfig.include`.

- [ ] **AC4 — Vue SFC cleanup:** `.vue` files in the workspace whose `<script>` or `<script setup>` blocks contain any import or re-export of the deleted file (`import { x } from './foo'`, `import * as x from './foo'`, `import './foo'`, `export * from './foo'`, etc.) have those lines removed. Modified `.vue` files appear in `filesModified`; `.vue` files outside the workspace boundary appear in `filesSkipped`.

  *Laziness test:* "only clean TS/JS files, skip .vue files entirely" — fails because a `.vue` importer would be silently left broken.

- [ ] **AC5 — Workspace boundary on outputs:** If any file (TS, JS, or Vue) that imports the deleted target lies outside the workspace boundary, it is not written and its path appears in `filesSkipped`. In-workspace importers are still cleaned normally.

  *Laziness test:* "error out when any importer is outside the workspace" — fails because in-workspace importers must still be cleaned and the out-of-boundary file returned in `filesSkipped`, not as an error.

- [ ] **AC6 — FILE_NOT_FOUND error:** If the target file does not exist, the operation returns `{ ok: false, error: "FILE_NOT_FOUND", message: "…" }` without touching any other files.

  *Laziness test:* "throw an unstructured exception" — fails because a structured error code is required so the agent can branch on it.

## Interface

### Input

```typescript
// Zod schema: DeleteFileArgsSchema
{
  file: string;            // Absolute path to the file to delete
  checkTypeErrors?: boolean; // Default on; pass false to suppress post-write type check
}
```

**`file`:** Absolute path to the `.ts`, `.tsx`, `.js`, `.jsx`, or `.vue` file to delete. Must be within the workspace (enforced by dispatcher `pathParams`). Example: `/project/src/utils/old-helper.ts`. Cannot be a directory.

**`checkTypeErrors`:** Optional boolean. When true (default), runs type-error diagnostics on all `filesModified` after the deletion and includes `typeErrors`, `typeErrorCount`, `typeErrorsTruncated` in the response. Pass `false` to suppress. Agents will almost always want type errors — after deleting a file, callers that used its exports will break.

### Output

```typescript
interface DeleteFileResult {
  deletedFile: string;       // Absolute path of the file that was deleted
  filesModified: string[];   // Files whose import/re-export declarations were cleaned
  filesSkipped: string[];    // Importers outside the workspace boundary — not written
  importRefsRemoved: number; // Total number of import/export declarations removed
  // + typeErrors / typeErrorCount / typeErrorsTruncated when checkTypeErrors is true (injected by dispatcher)
}
```

**`deletedFile`:** Echo of the absolute path deleted. Useful for the agent to confirm the right file was targeted.

**`filesModified`:** List of absolute paths written. Does not include `deletedFile` itself. May be empty if no file imported the deleted file.

**`filesSkipped`:** Absolute paths of files the operation found but did not write because they are outside `workspace`. Agents should surface this to the user.

**`importRefsRemoved`:** Count of individual `import`/`export` declarations removed across all modified files. Zero is valid (file had no importers). Maximum realistically ~hundreds for a widely-used utility; no hard cap needed since we're removing, not returning the declarations.

### Error codes

| Code | When |
|------|------|
| `FILE_NOT_FOUND` | Target file does not exist on disk |
| `WORKSPACE_VIOLATION` | Target path is outside the workspace (dispatcher layer, before invoke) |
| `VALIDATION_ERROR` | Schema validation failed (e.g. empty `file` string) |

### MCP tool description (draft)

> "When deleting a file, use this instead of shell rm — it removes every import and re-export of the file from other project files before deleting it. Covers in-project source files, out-of-project files (tests, scripts), and Vue SFC script blocks. Returns filesModified (imports cleaned), filesSkipped (outside workspace, not written — surface to user), and importRefsRemoved. Type errors in modified files are returned automatically (typeErrors, typeErrorCount, typeErrorsTruncated); pass checkTypeErrors:false to suppress."

## Edges

- **Deletion order:** The target file is deleted from disk only after all importer edits have been written. ts-morph needs the file present to resolve module specifiers during the TS/JS scan.
- **Self-reference:** The target file is excluded from the import scan (a file cannot import itself in normal code).
- **Vue SFC scan scope:** `vue-scan.ts` uses regex against the raw SFC source — it covers `<script>` and `<script setup>` but does not parse template-level `import()` expressions. Consistent with how `updateVueImportsAfterMove` works today.
- **Workspace boundary on input:** Enforced by the dispatcher via `pathParams: ["file"]` before `invoke` is called.
- **Provider cache after deletion:** After a file is deleted, `tsProvider.invalidateProject(file)` is called so the next request rebuilds the project. The file-system watcher will also trigger `invalidateAll` independently via the `unlink` event, but the operation must not rely on that.
- **Side-effect imports:** `import './foo'` (no bindings) must be removed — covered by AC1/AC4.
- **Type-only imports:** `import type { Foo } from './foo'` must be removed — covered by AC1/AC4.
- **Must not touch files outside workspace** — even if the compiler graph references them.
- **Idempotency on retry:** If the file is already gone, return `FILE_NOT_FOUND`. Do not attempt to scan importers when the target is missing — module specifier resolution would be unreliable.

## Done-when

- [ ] All 6 ACs verified by tests (unit tests using a fixture project)
- [ ] Mutation score ≥ threshold for `src/operations/deleteFile.ts` and `src/providers/vue-scan.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated:
  - [ ] `docs/features/deleteFile.md` created
  - [ ] `README.md` tool table updated
  - [ ] `handoff.md` current-state section updated (operation count, layout)
- [ ] Tech debt discovered during implementation added to handoff.md as `[needs design]`
- [ ] Agent insights captured in `docs/agent-memory.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
