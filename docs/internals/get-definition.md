# Internals: get-definition

User-facing reference: [docs/commands/get-definition.md](../commands/get-definition.md).

## How it works

`getDefinition` follows the same basic pattern as `findReferences`, with one important difference: Volar's proxy does **not** auto-translate `.vue` paths for `getDefinitionAtPosition`. An explicit pre-translation step is required for Vue files.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; selects TS or Vue compiler
  ▼ getDefinition() (src/operations/getDefinition.ts)
  │   ├─ TsMorphCompiler path
  │   │     ls.getDefinitionAtPosition(file, offset) → definition spans
  │   └─ VolarCompiler path (Vue project)
  │         toVirtualLocation(file, offset) — explicit .vue → .vue.ts coordinate translation
  │         ls.getDefinitionAtPosition(virtualFile, virtualOffset) → spans in virtual coords
  │         translateLocations() → real .vue line/col via Volar source-map
  ▼ result { ok, definitions[] }
```

Definition locations may point into `node_modules` or sibling packages — this is correct for a read-only operation.

## Technical decisions

**Why does VolarCompiler need explicit `.vue` → `.vue.ts` translation for `getDefinition` but not for `rename` or `findReferences`?**
`findRenameLocations` and `getReferencesAtPosition` are wrapped at the Volar proxy layer and auto-translate real `.vue` paths to their virtual `.vue.ts` equivalents before calling TypeScript's internal implementation. `getDefinitionAtPosition` is not wrapped the same way — it calls TypeScript directly, which throws when it cannot find the source file by the `.vue` name. The fix (`toVirtualLocation` before the call) is applied in `VolarCompiler.getDefinitionAtPosition`. Any future read-only operation that hits `Could not find source file: *.vue` likely needs the same treatment.

**Why return all definitions including those in `node_modules`?**
Filtering to workspace-only definitions would silently hide the actual definition of a symbol imported from a library — which is exactly what an agent might want to inspect. The read-only nature of the operation means cross-boundary results carry no security risk.
