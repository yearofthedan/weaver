# Agent Memory

Cross-cutting principles, gotchas, and hard-won decisions that apply across multiple features.

**What belongs here:** Architectural patterns, API quirks, conventions that aren't obvious from the code. Things you'd tell a new contributor before they touch any file.

**What does NOT belong here:** Feature-specific behaviour, parameter semantics, or implementation details — those belong in `docs/features/`. If the entry only matters for one tool or operation, it goes in that tool's feature doc.

---

## VolarCompiler: `.vue` inputs require explicit `toVirtualLocation` before every language service call

Volar registers `.vue` files internally as `App.vue.ts` (virtual TypeScript path). Every call to the Volar proxy language service must translate the real `.vue` path + offset to the virtual coordinate space first using `toVirtualLocation`. This is true for `findRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` — none of them auto-translate. For non-`.vue` paths, `toVirtualLocation` is a passthrough, so calling it unconditionally is safe.

The output side is handled by `translateLocations`, which maps virtual `.vue.ts` paths back to real `.vue` paths. Input and output translations are independent.

---

## MCP naming: tool names use camelCase

The MCP tool names (`rename`, `findReferences`, `getDefinition`, etc.) use camelCase, not kebab-case. This is intentional — agents read tool names and camelCase matches TypeScript naming conventions.

---

## Specs: don't frame internal changes as "backward-compatible"

"Backward-compatible" implies external consumers. All interfaces in this codebase (`Compiler`, `LanguagePlugin`, etc.) are internal with a fixed set of implementers — BC language is noise. Say *why* a parameter is optional (e.g. "so the Vue compiler doesn't need changes"), not that it's "backward-compatible".

---

## `workspace` parameter is read-only

Operations receive `workspace` as a string path for security boundary checks. They must never write to it as a config object or mutate it. The boundary check is `isWithinWorkspace(file, workspace)` in `src/security.ts`.

---

## Specs must say *what* to move, not *how*

When a spec says "move function X to file Y", do not prescribe manual steps (create file, copy code, update imports). That competes with the light-bridge skill guidance and causes agents to ignore `moveSymbol`/`moveFile`. Describe the *what* and *where* — the execution agent's refactoring skill handles the *how*.

---

## Each AC must leave the codebase in a working state

Every AC should be a functional unit — the build passes and tests pass after it lands. Splitting work into ACs where one deliberately breaks the codebase ("move files now, fix imports later") is almost never correct. If the natural tool does X+Y atomically, that's one AC, not two. Non-functional AC splits (e.g. "rename files" separate from "fix references") should be extremely rare and require explicit justification.

---

## After compiler-aware renames, batch the textual cleanup

`mcp__light-bridge__rename` follows the compiler's reference graph — it renames the definition and all type-checked references. But derived names (`tsProviderSingleton`, `pluginProviders`, `stubProvider`) are just strings that happen to contain the old name; the compiler doesn't link them. After the `rename` calls, do **one** `replaceText` pass with a pattern to catch remaining occurrences — don't edit them individually. During the providers→compilers rename, doing this one-by-one instead of batching ballooned AC2 to 126 tool calls for what should have been ~10.

---

## Colocate test helpers with their domain, not in a generic folder

`makeMockCompiler` mocks the `Compiler` interface — it belongs in `tests/compilers/__helpers__/`, not `tests/helpers/`. Place test doubles near the concept they mock, using `__helpers__/` subfolders per code-standards.md.

---

## Test layer must match the code layer

When restructuring tests, audit every test file: does its test target match the directory it lives in? A test in `tests/operations/` should call the operation function; a test in `tests/compilers/` should call the compiler method directly. If a test in `tests/operations/` is really exercising compiler logic through the operation, it belongs in `tests/compilers/`. "Stays as-is" in a spec is a decision that needs justification, not a default.

---

## Fix discovered tech debt in the same session

If you discover misplaced tests, incorrect docs, or small structural problems during a migration, fix them now. Don't defer to handoff — that turns a 10-minute fix into a task that takes a full session to pick up, spec, and execute. The girl guides principle: leave the campsite cleaner than you found it.

---

## `assertFileExists` bypasses the `FileSystem` port

`assertFileExists` (`src/utils/assert-file.ts`) calls `fs.existsSync` directly — it is not yet behind the `FileSystem` port. Unit tests using `InMemoryFileSystem` must pass a path that physically exists on disk (e.g. `import.meta.url`) to satisfy this guard. This will resolve when `assertFileExists` is migrated in a future architecture slice.

---

## Domain services must not know about file formats

`ImportRewriter` operates on script content only. The plugin layer (Vue, Svelte, etc.) is responsible for extracting script blocks from SFCs before calling the domain service and splicing results back. If a framework name (`.vue`, `.svelte`, `.astro`) appears in an import or condition outside the `plugins/` directory, the abstraction is leaking. This principle applies to all domain services, not just `ImportRewriter`.

---

## Don't fix pre-existing mutation scores by adding tests at the wrong layer

If mutation survivors are in code you didn't change, note them and move on. Adding integration tests to kill unit-level mutants is test duplication — the fix belongs in unit tests for the unchanged code, as a separate task. Only add tests at the layer where the logic lives.

---

## Where gotchas belong: code first, docs second, agent-memory last

1. **Clear code** -- if the pattern is visible in the source (comments, naming, consistent usage), that's sufficient. Don't document what the code already says.
2. **Feature / architecture / tech docs** (`docs/features/`, `docs/architecture.md`, `docs/tech/`) -- if the gotcha is isolated to one feature or technology area, put it in the relevant doc so agents working on that area find it.
3. **agent-memory.md** -- only for cross-cutting constraints and conventions that affect how you work across the whole codebase. Things that contradict reasonable default assumptions regardless of which feature you're touching.

---

## `scope.modified` returns a new array on every call

`WorkspaceScope.modified` creates a fresh array each invocation. Snapshot it before a loop (`const alreadyModified = new Set(scope.modified)`) to avoid O(n^2) behaviour when checking membership repeatedly inside an iteration.
