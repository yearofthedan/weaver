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
