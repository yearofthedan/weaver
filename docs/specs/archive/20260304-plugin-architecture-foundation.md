# Plugin architecture foundation — language plugin contract

**type:** change
**date:** 2026-03-04
**tracks:** handoff.md # plugin architecture foundation → docs/architecture.md

---

## Context

The codebase already separates operations from providers, but language provider selection is hardcoded in `makeRegistry` (`isVueProject()` branching) and invalidation directly references provider singletons. As more framework support is added (Svelte, Angular), each new framework would require editing `dispatcher.ts` internals rather than registering a plugin. This slice introduces the `LanguagePlugin` contract and registry so new frameworks plug in without touching dispatch logic.

Scope is deliberately narrow: language plugin selection and invalidation only. Operations are not being pluggable-ised — they're core-owned and stable. The existing `LanguageProvider` interface (which is already a good typed contract) stays as-is.

## Value / Effort

- **Value:** Defines a stable contract for adding framework support (Vue, Svelte, Angular). Replaces hardcoded `isVueProject()` branching with a registry pattern. Isolates invalidation failures across plugins. Signals to consumers/contributors exactly where new language support belongs.
- **Effort:** Small-medium. New interface + registry, migrate Vue behind it, update invalidation. No new compiler behavior, no operation changes.

## Behaviour

- [ ] Given a `LanguagePlugin` registered with the registry, `makeRegistry(filePath)` resolves `projectProvider()` by iterating registered plugins and calling `supportsProject(tsconfigPath)`, returning the first match's provider. TS provider is the default fallback when no plugin matches.
- [ ] Given the Vue `LanguagePlugin` is registered with `supportsProject` checking for `.vue` files in the project, all existing Vue project dispatch behavior is preserved — same projects get VolarProvider, same get TsProvider.
- [ ] Given multiple language plugins are registered, `invalidateFile` iterates all plugins and calls their invalidation. A thrown error in one plugin's invalidation does not prevent other plugins from invalidating.
- [ ] Given multiple language plugins are registered, `invalidateAll` iterates all plugins and calls their invalidation. A thrown error in one plugin does not prevent others.
- [ ] Given an operation with no path params (`searchText`, `replaceText`), dispatch does not consult the language plugin registry — workspace-scoped operations remain unchanged.

## Interface

The `LanguageProvider` interface (in `src/types.ts`) is unchanged. The new contracts:

```ts
interface LanguagePlugin {
  id: string;
  supportsProject(tsconfigPath: string): boolean;
  createProvider(): Promise<LanguageProvider>;
  invalidateFile?(filePath: string): void;
  invalidateAll?(): void;
}
```

Field semantics:

- `id`: stable identifier, e.g. `"vue-volar"`. ASCII, unique among registered plugins.
- `supportsProject(tsconfigPath)`: project-level detection (not file-level). Receives the resolved tsconfig path. Returns true if this plugin should provide the `projectProvider` for operations targeting this project.
- `createProvider()`: lazy factory. Called once, result cached by the registry.
- `invalidateFile?`: selective cache refresh (watcher `change` events).
- `invalidateAll?`: full cache drop (watcher `add`/`unlink` events).

Resolution rules:

- Plugins are checked in registration order (first match wins).
- If no plugin matches, the built-in TS provider is used (always available).
- `registry.tsProvider()` is not subject to plugin resolution — it always returns TsProvider for operations needing direct AST access.

Zero/empty cases:

- No plugins registered → TS provider used for everything (pure TS project).
- `supportsProject` called with `null` tsconfig → plugin should return false (no tsconfig = plain TS).

## Edges

- `LanguageProvider` interface is unchanged — no type-safety regression.
- `ProviderRegistry` interface is unchanged — operations see no difference.
- Existing MCP tool names, params, and response envelopes are backward-compatible.
- Workspace boundary and sensitive-file checks remain in the dispatcher, not in plugins.
- Static built-in registration is sufficient; dynamic/third-party loading is out of scope.
- Watcher extension set (`.ts` vs `.ts`+`.vue`) is still determined at daemon startup — not changed in this slice.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (deferred — running next)
- [x] `pnpm check` passes (lint + build + test)
- [x] Docs updated:
      - `docs/architecture.md` (LanguagePlugin contract, registry, resolution flow)
      - `docs/handoff.md` (entry removed, follow-up added for feature folder restructuring)
- [x] Tech debt discovered during implementation added to handoff.md as [needs design]
- [x] Agent insights captured in docs/agent-memory.md
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

## Outcome

**Tests added:** 16 new tests in `tests/daemon/language-plugin-registry.test.ts` covering plugin resolution (first-match, fallback, caching, no-tsconfig), invalidation fan-out (error isolation for both `invalidateFile` and `invalidateAll`), and Vue integration (VolarProvider for Vue projects, TsProvider for non-Vue).

**Architecture decisions:**
- `LanguagePlugin.supportsProject()` is project-level (receives tsconfig path), not file-level. This preserves the pattern where VolarProvider claims the entire project — even `.ts` file operations go through Volar in a Vue project because Volar sees `.vue` importers.
- The original spec proposed operation plugins + language plugins. Narrowed to language plugins only — operations are core-owned, stable, and don't benefit from pluggability. The `requires`/`capabilities` model was dropped because operations have heterogeneous provider needs (some need `tsProvider`, some need `projectProvider`, `moveSymbol` needs both).
- `LanguageProvider` interface is unchanged — no type-safety regression from a `capabilities: Record<string, unknown>` map.
- Dispatcher decomposed: `language-plugin-registry.ts` (registry + resolution + invalidation), `vue-language-plugin.ts` (Vue plugin factory), `dispatcher.ts` (operation dispatch only, re-exports registry functions for backward compatibility).

**Follow-up added to handoff.md:**
- Move Vue provider files into `src/plugins/vue/` feature folder — co-locate VolarProvider, vue-scan, vue-service, and vue-language-plugin as a template for adding Svelte/Angular plugins.
