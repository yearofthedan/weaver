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
