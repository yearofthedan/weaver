# ts-morph API decisions

## `sourceFile.move()` — not used for import rewriting

**Decision:** Use the TS language service (`ls.getEditsForFileRename`) for import specifier rewriting. Use ts-morph's project graph only for tracking file locations.

**Verified with ts-morph 27.0.2.**

### What `sourceFile.move()` does

1. **Resolution** — finds dependents via `_referenceContainer` (AST-based)
2. **Specifier generation** — writes new import strings via `getRelativePathAsModuleSpecifierTo()`
3. **Graph update** — moves the source file in the in-memory project
4. **Physical move** — renames on disk (with `moveImmediatelySync`) or queues for `project.save()`

Steps 3–4 work correctly. Steps 1–2 have two bugs that make the API unsuitable for import rewriting.

### Bug 1: `.js` extensions stripped

`sourceFile.move()` strips `.js`-family extensions from import specifiers.

```
before:  import { hello } from "./foo.js"
after:   import { hello } from "./subdir/foo"    ← .js stripped
```

This breaks ESM/nodenext projects where `.js` extensions are mandatory.

### Bug 2: extensionless imports not rewritten

`sourceFile.move()` does not resolve extensionless specifiers to `.ts` files.

```
before:  import { hello } from "./foo"
after:   import { hello } from "./foo"            ← not rewritten, still points to old path
```

The TS language service resolves these correctly using the project's `moduleResolution` setting.

### Alternatives considered and rejected

#### Custom `resolutionHost`

ts-morph accepts a `resolutionHost` option on `new Project()` that controls module resolution. This could fix bug #2 (extensionless imports not found) by providing a resolver that matches TypeScript's full `moduleResolution` algorithm.

**Why it doesn't work:** `resolutionHost` controls resolution (step 1 — which file does a specifier point to?) but not specifier generation (step 2 — what string to write). Even with a perfect custom resolver, `getRelativePathAsModuleSpecifierTo()` still strips `.js` extensions. Bug #1 remains. Both steps would need to be pluggable, and step 2 is not.

#### Write back extensions after move

Snapshot specifiers before the move (or infer from tsconfig), let `sourceFile.move()` rewrite them, then post-process dirty files to restore stripped extensions. The extension mapping is deterministic (`.ts`→`.js`, `.cts`→`.cjs`, `.mts`→`.mjs`).

**Why it doesn't work:** Bug #2 means some specifiers are never rewritten at all — they still point to the old path. You can't post-process a specifier that wasn't touched. You'd still need the TS language service (or equivalent) to catch missed rewrites, which puts you back where you started.

#### ESLint `--fix` post-processing

Bundle ESLint with an import-extensions rule; run `--fix` after every move.

**Why it doesn't work:**
- Huge dependency to ship with a refactoring tool
- Requires the user's project to have the right ESLint config (or bundling a fixed config that may conflict)
- `eslint --fix` touches all files matching the rules, not just move-affected imports — `filesModified` would include unrelated lint fixes
- Adds seconds of ESLint startup to every move operation
- Breaks the tool's correctness contract: "move succeeded but code is broken until a third-party tool runs"

### Correct approach

Use `ls.getEditsForFileRename(oldPath, newPath)` from the TS language service for all import rewriting. This delegates to TypeScript's own module resolution, which correctly handles:
- `.js`/`.cjs`/`.mjs` extension preservation
- Extensionless specifiers under all `moduleResolution` modes
- Path aliases (`paths`, `baseUrl`)
- Barrel re-exports
- `rootDirs` mappings

For project graph management, use ts-morph's incremental APIs (`project.removeSourceFile()`, `project.addSourceFileAtPath()`) to keep the graph in sync without rebuilding it.

### Impact on `moveDirectory`

`dir.move()` uses the same `sourceFile.move()` pipeline internally — same two bugs apply. The `moveDirectory` implementation (which currently uses `dir.move()`) has a latent `.js` extension-stripping bug. The fix should follow the same pattern: TS language service for rewriting, ts-morph for graph/physical move. Tracked separately.

---

## Full API audit (2026-03-18)

Audited all operations against ts-morph docs and Volar API surface. Goal: find cases where we hand-roll something the library already provides correctly.

### `deleteFile` — `sourceFile.delete()` does NOT clean up importers

ts-morph's `SourceFile.delete()` removes the file from the in-memory project graph and queues a physical delete. It does **not** iterate other source files to remove their import/export declarations pointing at the deleted file. Our 5-phase implementation (in-project import removal, out-of-project walkFiles scan, Vue SFC regex scan, physical unlink, cache invalidation) is the correct approach — there is no simpler library API.

### `extractFunction` — already uses the right API

`extractFunction` delegates to the TypeScript language service's built-in "Extract Symbol" refactor via `ls.getApplicableRefactors()` + `ls.getEditsForRefactor()`. ts-morph does not add higher-level abstractions over this — `project.getLanguageService().compilerObject` is the intended access path. No hand-rolled reimplementation here.

### Import rewriting (`ImportRewriter`) — no native ts-morph alternative

ts-morph has no API for "rewrite imports of symbol X from file A to file B". The closest is `sourceFile.move()` (rewrites all imports of the file, not a specific symbol), which is broken for our use cases (see above). `ImportRewriter` uses throwaway in-memory ts-morph Projects for AST parsing and mutation — this is appropriate given that no library API exists for symbol-level import rewriting.

### Summary

| Area | Library API exists? | Our approach correct? |
|------|--------------------|-----------------------|
| `moveFile` | `getEditsForFileRename` ✓ | Yes — already using it |
| `moveDirectory` | `dir.move()` — buggy | Yes — per-file `getEditsForFileRename` |
| `deleteFile` | `sourceFile.delete()` — incomplete | Yes — manual importer cleanup |
| `extractFunction` | TS LS `getEditsForRefactor` ✓ | Yes — already using it |
| Import rewriting | None for symbol-level | Yes — `ImportRewriter` with in-memory AST |

### What ts-morph actually provides

ts-morph's value in this codebase is:
1. **LanguageServiceHost management** — `Project` eliminates ~100 lines of `LanguageServiceHost` boilerplate per project type
2. **AST mutation ergonomics** — `sf.getImportDeclarations()`, `decl.remove()`, `addImportDeclaration()` etc. vs raw `ts.factory.update*()` + `ts.createPrinter()`
3. **Project graph lifecycle** — `removeSourceFile()`, `addSourceFileAtPath()`, `refreshFromFileSystemSync()`

Its heavy-lifting APIs (`sourceFile.move()`, `dir.move()`) are bypassed due to bugs. We use ts-morph as infrastructure, not as a feature provider.
