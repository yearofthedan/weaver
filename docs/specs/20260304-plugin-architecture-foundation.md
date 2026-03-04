# Plugin architecture foundation (operations + language plugins)

**type:** change
**date:** 2026-03-04
**tracks:** handoff.md # plugin architecture foundation → docs/architecture.md, docs/features/mcp-transport.md

---

## Context

The codebase already separates operations from providers, but registration is static (`OPERATIONS` in dispatcher, `TOOLS` in mcp). As feature count grows (workspace text tools, TS refactors, Vue-specific behavior), adding capabilities by editing central tables increases coupling and makes extension paths implicit rather than contract-driven.

## Value / Effort

- **Value:** Defines a stable plugin contract so workspace-scoped operations and language-aware operations can evolve independently. Prevents "central switchboard churn" and makes it clear where new capabilities belong (`workspace op`, `language capability`, or `hook`), reducing integration mistakes and regressions.
- **Effort:** Medium. Requires introducing plugin contracts, migrating existing built-ins behind those contracts, and updating docs/tool registration flow. No new compiler behavior is required in this slice; this is architecture and wiring.

## Behaviour

- [ ] Given an operation plugin that declares `scope: "workspace"` and no language capability requirements (for example `searchText`), the dispatcher executes it without selecting/initializing a language plugin and preserves existing response shape.
- [ ] Given an operation plugin that declares required capabilities (for example rename/reference/definition primitives), dispatch resolves a language plugin for the input project and invokes those capabilities through a typed contract rather than direct provider class branching.
- [ ] Given no language plugin can satisfy an operation's required capabilities for the target input, the call fails with a deterministic structured error (`NOT_SUPPORTED` or a more specific capability error code), and no filesystem writes occur.
- [ ] Given a mutating operation plugin returns `filesModified`, core boundary checks and post-write diagnostics (`checkTypeErrors !== false`) are applied consistently, regardless of which plugin implemented the operation.
- [ ] Given file watcher invalidation events (`invalidateFile`, `invalidateAll`), all registered language plugins receive invalidation callbacks; a failure in one plugin does not prevent other plugins from invalidating.

## Interface

Public MCP method names remain unchanged in this slice. The new interface is internal and should be explicit in `docs/architecture.md`.

Proposed internal contracts:

```ts
type OperationScope = "workspace" | "file" | "project";

interface OperationPlugin<TParams = unknown, TResult = unknown> {
  name: string;                     // MCP/daemon method name, e.g. "rename"
  scope: OperationScope;            // determines provider resolution strategy
  pathParams: string[];             // workspace boundary validation inputs
  schema: z.ZodType<TParams>;       // socket-boundary validation
  requires?: string[];              // capability keys, e.g. ["renameLocations"]
  invoke(ctx: OperationContext, params: TParams): Promise<TResult>;
}

interface LanguagePlugin {
  id: string;                       // stable identifier: "ts", "vue-volar"
  supports(inputFile: string): boolean;
  capabilities: Record<string, unknown>;
  invalidateFile?(path: string): void;
  invalidateAll?(): void;
}
```

Field semantics and bounds:

- `name`: exact daemon method key; unique among operations; ASCII identifier, max practical length ~40 chars.
- `scope`: small enum; drives whether language selection is required.
- `pathParams`: 0..N param keys; zero for workspace-global operations.
- `requires`: optional list of capability keys; typical size 0..4.
- `capabilities`: keyed handler map; only declared keys are callable by operations.

Zero/empty cases:

- `pathParams: []` means workspace-root validation path.
- `requires: undefined` means operation is self-contained and language-agnostic.
- `filesModified: []` still returns `ok: true`; diagnostics are omitted when no writes occur.

Adversarial cases:

- Multiple plugins claim support for the same file: resolution must be deterministic (priority ordering documented and test-covered).
- Capability drift: operation requests a key not provided by chosen language plugin; must fail cleanly with structured code, not throw raw exceptions.

## Edges

- Workspace boundary and sensitive-file checks remain non-bypassable core logic; plugins cannot disable them.
- Existing MCP tool names, params, and success/error response envelopes remain backward-compatible.
- Pluginization must not regress daemon warm-cache behavior or watcher-triggered invalidation semantics.
- Vue virtual path translation remains encapsulated in the Vue language plugin; operations never handle `.vue.ts` paths directly.
- Static built-in registration is sufficient for this slice; external/dynamic third-party loading is explicitly out of scope.

## Done-when

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed:
      - `docs/architecture.md` (plugin contracts + dispatch flow)
      - `docs/features/mcp-transport.md` (tool registration source of truth if it changes)
      - `docs/handoff.md` (entry status and links)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Agent insights captured in docs/agent-memory.md
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
