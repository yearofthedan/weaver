# Internals: find-importers

User-facing reference: [docs/commands/find-importers.md](../commands/find-importers.md).

## How it works

`findImporters` wraps the TypeScript language service's `getFileReferences(fileName)` API, which returns all import/re-export statements that reference the file. For Vue projects, the Volar engine queries the virtual `.vue.ts` path and translates results back to real `.vue` file coordinates.

```
tool call
  │
  ▼ dispatcher (src/daemon/dispatcher.ts)
  │   validates file against workspace boundary; selects TS or Vue engine
  ▼ findImporters() (src/operations/findImporters.ts)
  │   ├─ TsMorphEngine path
  │   │     ls.getFileReferences(file) → spans in TS/TSX files
  │   └─ VolarEngine path (Vue project)
  │         baseService.getFileReferences(file or file.ts) → spans including virtual .vue.ts refs
  │         translateLocations() → real .vue line/col via Volar source-map
  ▼ result { status, fileName, references[] }
```

## Technical decisions

**Why a separate tool instead of overloading `findReferences`?**
A new `findImporters` tool with just `{ file }` is self-describing. Overloading `findReferences` with optional `line`/`col` creates a hidden mode — the name suggests symbol-level work and "omit line and col" is easy to miss. The cost of a dedicated tool is ~2 lines of tool description.

**Why `baseService.getFileReferences` in VolarEngine instead of the proxy?**
Volar's proxy language service (`createProxyLanguageService`) does not expose `getFileReferences`. The base TypeScript language service (pre-proxy) does. `CachedService` now exposes `baseService` for callers that need APIs not forwarded by the Volar proxy.
