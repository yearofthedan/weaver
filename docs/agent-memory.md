# Agent Memory

Implementation gotchas, hard-won decisions, and non-obvious discoveries.

---

## VolarProvider: `.vue` inputs require explicit `toVirtualLocation` before every language service call

Volar registers `.vue` files internally as `App.vue.ts` (virtual TypeScript path). Every call to the Volar proxy language service must translate the real `.vue` path + offset to the virtual coordinate space first using `toVirtualLocation`. This is true for `findRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` — none of them auto-translate. For non-`.vue` paths, `toVirtualLocation` is a passthrough, so calling it unconditionally is safe.

The output side is handled by `translateLocations`, which maps virtual `.vue.ts` paths back to real `.vue` paths. Input and output translations are independent.

---

## MCP naming: tool names use camelCase

The MCP tool names (`rename`, `findReferences`, `getDefinition`, etc.) use camelCase, not kebab-case. This is intentional — agents read tool names and camelCase matches TypeScript naming conventions.

---

## `workspace` parameter is read-only

Operations receive `workspace` as a string path for security boundary checks. They must never write to it as a config object or mutate it. The boundary check is `isWithinWorkspace(file, workspace)` in `src/security.ts`.
