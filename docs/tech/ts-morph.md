# ts-morph internals

**Purpose:** Implementation gotchas for working with ts-morph and the TypeScript compiler object.
**Audience:** Engineers touching `src/compilers/ts.ts`, `src/utils/ts-project.ts`, or any operation that calls into ts-morph directly.
**See also:** [volar-v3.md](volar-v3.md) for the Vue/Volar layer, [architecture.md](../architecture.md) for the compiler/operation design.

---

**ts-morph bundles its own TypeScript instance — use `{ ts }` from `ts-morph`, not `import * as ts from "typescript"`.**
`project.getLanguageService().compilerObject` returns TypeScript objects typed against ts-morph's bundled TypeScript (`@ts-morph/common`). If you import `typescript` directly and annotate with its types, TypeScript rejects the assignment: `SyntaxKind.SourceFile` from one instance is not assignable to the other. Use `import { ts } from "ts-morph"` for any types that touch the compiler object's return values. The standalone `typescript` import is fine for utilities that don't interact with ts-morph project objects (e.g. `ts.sys.readDirectory` in `ts-project.ts`).

**`TsMorphCompiler.getProjectForDirectory(dir)` vs `getProjectForFile(file)` — use the right one.**
`getProjectForFile(file)` calls `findTsConfigForFile(file)`, which walks up from `path.dirname(file)` — passing a directory path gives the parent's config (wrong). `getProjectForDirectory(dir)` calls `findTsConfig(dir)` directly, which starts from the directory itself. Use `getProjectForDirectory` when you have a workspace root, not a specific file.

**Module-level caches in `ts-project.ts` survive across tests — use unique `mkdtempSync` paths per test.**
`findTsConfig` and `isVueProject` store results in module-level `Map`s that persist for the process lifetime. Tests that exercise the cache must use unique temporary directories (from `fs.mkdtempSync`) so earlier test runs don't pre-populate the cache for later ones. To test that the cache is *used*, mutate the filesystem between the two calls (delete the tsconfig or `.vue` file after the first call) — the second call should still return the cached value.

**ts-morph source files never carry `impliedNodeFormat`, so NodeNext diagnostics are wrong — do not ask a ts-morph project for type errors.**
`@ts-morph/common`'s `DocumentRegistry` passes a bare `ScriptTarget` where `ts.createLanguageServiceSourceFile` accepts either that or a `CreateSourceFileOptions`; only the object form carries `impliedNodeFormat`. Every ts-morph source file therefore has it `undefined`, and under `module: NodeNext` TypeScript judges the whole project as CommonJS. That fabricates errors (TS1470 on `import.meta` in an ESM package) and — the dangerous direction — silently misses real ones (TS2835 on an extensionless relative import). It also flows into **module resolution**: a dual-published dependency resolves to its `require` condition where `tsc` picks `import`, so the module graph points at the wrong declaration file. Diagnostics are served from a host-TypeScript program (`src/ts-engine/diagnostic-service.ts`) for this reason; find-references and rename still walk ts-morph's graph and still carry the resolution half.
There is no supported override — `ProjectOptions` exposes nothing that reaches source-file creation, and setting `impliedNodeFormat` after the fact makes things worse: the format changes but resolution does not, turning a wrong-member error into "cannot find module".

**`ts.createLanguageService` and `ts.createProgram` do not always agree, given identical options and file list.**
Measured on this repository: driving the same `compilerOptions` and root file list through each, on a vanilla `ts.sys`-backed host, `createProgram` reports 0 errors (matching `tsc -p tsconfig.json --noEmit`) while `createLanguageService` reports 15 — TS7006 and TS2532, concentrated in files using ts-morph's own heavily overloaded, conditionally-typed declarations. If the goal is parity with `tsc`, use `createProgram`. This is a TypeScript-level divergence, not something about the host implementation.

**`oldProgram` reuse broke a moved file, mechanism not isolated.**
Observed: passing `oldProgram` to `ts.createProgram` after adding a root made `getSourceFile` return `undefined` for a file just added, surfacing as "Could not find source file" on a moved file. The `moveFile` scenario *two out-of-project files move in turn* goes red with it and green without it, nothing else changed. A later attempt to reproduce the same shape in isolation, under minimal compiler options, did **not** trigger it — so the trigger is narrower than "roots changed" and has not been pinned. Treat the reproduction as the evidence, not any story about structure reuse. `src/ts-engine/diagnostic-service.ts` builds cold and leans on a host-side parse cache instead.
