# Agent Memory

Cross-cutting principles, gotchas, and hard-won decisions that apply across multiple features.

**What belongs here:** Architectural patterns, API quirks, conventions that aren't obvious from the code. Things you'd tell a new contributor before they touch any file.

**What does NOT belong here:** Feature-specific behaviour, parameter semantics, or implementation details — those belong in `docs/features/`. If the entry only matters for one tool or operation, it goes in that tool's feature doc.

---

## VolarProvider: `.vue` inputs require explicit `toVirtualLocation` before every language service call

Volar registers `.vue` files internally as `App.vue.ts` (virtual TypeScript path). Every call to the Volar proxy language service must translate the real `.vue` path + offset to the virtual coordinate space first using `toVirtualLocation`. This is true for `findRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` — none of them auto-translate. For non-`.vue` paths, `toVirtualLocation` is a passthrough, so calling it unconditionally is safe.

The output side is handled by `translateLocations`, which maps virtual `.vue.ts` paths back to real `.vue` paths. Input and output translations are independent.

---

## MCP naming: tool names use camelCase

The MCP tool names (`rename`, `findReferences`, `getDefinition`, etc.) use camelCase, not kebab-case. This is intentional — agents read tool names and camelCase matches TypeScript naming conventions.

---

## Specs: don't frame internal changes as "backward-compatible"

"Backward-compatible" implies external consumers. All interfaces in this codebase (`LanguageProvider`, `LanguagePlugin`, etc.) are internal with a fixed set of implementers — BC language is noise. Say *why* a parameter is optional (e.g. "so the Vue provider doesn't need changes"), not that it's "backward-compatible".

---

## `workspace` parameter is read-only

Operations receive `workspace` as a string path for security boundary checks. They must never write to it as a config object or mutate it. The boundary check is `isWithinWorkspace(file, workspace)` in `src/security.ts`.

---

## `assertFileExists` bypasses the `FileSystem` port

`assertFileExists` (`src/utils/assert-file.ts`) calls `fs.existsSync` directly — it is not yet behind the `FileSystem` port. Unit tests using `InMemoryFileSystem` must pass a path that physically exists on disk (e.g. `import.meta.url`) to satisfy this guard. This will resolve when `assertFileExists` is migrated in a future architecture slice.
