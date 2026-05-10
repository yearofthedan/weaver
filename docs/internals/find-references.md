# Internals: find-references

User-facing reference: [docs/commands/find-references.md](../commands/find-references.md).

## How it works

`findReferences` is a thin wrapper around the compiler's reference API. The same virtual-path translation used by `rename` applies here for Vue files.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; selects TS or Vue compiler
  ▼ findReferences() (src/operations/findReferences.ts)
  │   ├─ TsMorphCompiler path
  │   │     ls.getReferencesAtPosition(file, offset) → spans in TS/TSX files
  │   └─ VolarCompiler path (Vue project)
  │         ls.getReferencesAtPosition(virtualFile, offset) → spans in virtual .vue.ts coords
  │         translateLocations() → real .vue line/col via Volar source-map
  ▼ result { ok, references[] }
```

Results reflect the in-memory project graph. The daemon watcher keeps it fresh, but there can be a short debounce window (~200ms) before out-of-band file changes are visible.

## Technical decisions

**Why no workspace filtering on output?**
Mutating operations filter output writes to the workspace boundary because writing outside the workspace is the threat. `findReferences` only reads and returns data — there is no write risk. Filtering results would silently hide valid references in shared/sibling packages, which is worse than showing them.

**Why the same `file, line, col` interface as `rename`?**
Consistent with the LSP convention and with how agents invoke rename. An agent that locates a symbol for rename can reuse the same position for `findReferences` without translation.
