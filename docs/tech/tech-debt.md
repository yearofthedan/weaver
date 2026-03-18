**Purpose:** Known structural issues, bugs, and their proposed fixes.
**Audience:** Engineers deciding what to work on next, anyone hitting one of these issues in practice.
**Status:** Current (as of last session)
**Related docs:** [Handoff](../handoff.md) (next work)

---

# Tech Debt

Known issues to address before they compound. Reference the relevant source files before starting any of these.

---

## Watcher: own-writes trigger redundant invalidation

The daemon's own operations (`rename`, `moveFile`, `moveSymbol`) write files to disk. Those writes emit inotify/FSEvents events that the watcher picks up, firing `invalidateFile` or `invalidateAll` ~200ms after the write — by which time the operation has already performed its own invalidation. The redundant callbacks are currently no-ops (refreshing a project that is already dropped), so there is no correctness issue.

The risk is latency: if a second tool call arrives within the 200ms debounce window after an operation, the debounce timer will fire mid-call and null out the engine. The promise-chain mutex means this cannot interleave with an in-flight request, and nulling the engine only affects the *next* `getEngine()` call, so it is still safe — but it adds an unnecessary cold-rebuild to the call that follows.

**Fix:** maintain an in-memory skip-set of file paths the daemon itself just wrote. Before writing a file, add the path to the set; in the watcher callback, skip paths in the set and drain them after a short grace period. The skip-set is populated and drained entirely within the mutex-serialised operation, so no concurrency guard is needed.

**Priority:** low. The current behaviour is safe. The overhead is one extra project rebuild on the call immediately following a write-heavy operation — noticeable only for large projects.

---

## Security: TOCTOU race in symlink checks

`isWithinWorkspace` resolves symlinks at check-time, but the actual write happens later. Between the check and the write, a symlink could be swapped to point outside the workspace.

**Impact:** Low in practice — the tool is local-only with no multi-tenant exposure.

**Mitigation options:**
- Use `O_NOFOLLOW` on write operations (Unix-specific, non-trivial in Node.js)
- Add a second symlink re-check immediately before write (shrinks the window, doesn't close it)
- Accept the race as reasonable risk given the use case

**Decision:** accepted risk for now. Revisit if the tool ever runs in a shared or networked environment.

**Priority:** low.

---

## Daemon: process-lifetime discovery caches have no invalidation

`src/utils/ts-project.ts` caches `findTsConfig` and `isVueProject` results in module-level `Map`s for the daemon's entire lifetime. The file watcher calls `invalidateAll()` on providers but never clears these discovery caches.

If a `tsconfig.json` is created, deleted, moved, or `.vue` files are added to a previously non-Vue project while the daemon is running, the daemon will serve stale project-type decisions until it is restarted.

**Fix:** hook the watcher's `onFileAdded`/`onFileRemoved` callbacks to clear the relevant cache entries when a `tsconfig.json` or `.vue` file changes.

**Priority:** low. `tsconfig.json` is usually static. Most likely to surface during monorepo restructuring.

---

## VolarLanguageService interface is hand-typed

`src/plugins/vue/compiler.ts` manually narrows the TypeScript LanguageService surface used by the Vue compiler. If an upstream API changes signature, this can compile but fail at runtime.

**Fix:** `Pick<ts.LanguageService, 'findRenameLocations' | 'getReferencesAtPosition' | 'getEditsForFileRename'>`. Compile-time safety against upstream changes.

**Priority:** low. Will be resolved as part of further compiler refactoring since `VolarCompiler` should type its dependency on the real `ts.LanguageService`.

---

## `rewriteSpecifier` in `src/compilers/ts.ts` has elevated cyclomatic complexity

The module-level `rewriteSpecifier` function (introduced with the import-rewrite fallback scan) has CC ~6: a bare-match branch, a pair loop, two branches per pair, and a coexisting-file `existsSync` guard. It is correct and tested, but harder to extend safely than it should be.

**Candidate fix:** replace the pair-loop dispatch with a lookup map from specifier suffix to rewrite rule, collapsing the two per-pair branches into a single handler. The `existsSync` guard would become a predicate attached to the JS-family rule.

**Priority:** low. The function is pure, fully covered by tests, and does not contribute to the hot path.

---

## `assertFileExists` bypasses the `FileSystem` port

`assertFileExists` (`src/utils/assert-file.ts`) calls `fs.existsSync` directly — it is not behind the `FileSystem` port. Unit tests using `InMemoryFileSystem` must pass a path that physically exists on disk (e.g. `import.meta.url`) to satisfy this guard. Will resolve when `assertFileExists` is migrated to use the port.

**Priority:** low. Workaround is straightforward; affects only unit tests that hit the assertion path.

---

## `ImportRewriter` bypasses the `FileSystem` port for path operations

`import-rewriter.ts` imports `node:path` directly for `dirname` and `resolve`. The `resolve` method already exists on `FileSystem`; `dirname` does not. Adding `dirname` to the port and routing both calls through `scope.fs` would eliminate the domain layer's last direct platform dependency.

**Priority:** low. Both functions are pure string operations that don't affect testability in practice. Architectural hygiene, not a testing blocker.

---

## `moveSymbol` does not add an import back to the source file when the symbol is also consumed there

If a symbol is declared and called in the same file (e.g. an exported helper invoked by a sibling function in the same module), `moveSymbol` removes the declaration and updates all external importers — but does not add a `from './destination.js'` import to the source file for its internal call site. The source file is left with an unresolved reference.

**Fix:** after snapshotting importers and removing the declaration, scan the source file's remaining statements for any call or reference to the moved symbol name. If found, add an import from the destination file before writing.

**Priority:** low. The gap is immediately visible as a type error after the operation. Workaround: add the import manually.

---

## User feedback: rename / findReferences / getDefinition "Could not find source file" (TS path)

External user (working-title workspace) reports tools fail with `PARSE_ERROR: Could not find source file` for `.ts` files. The Vue path (`.vue` inputs) was fixed by calling `toVirtualLocation` before `findRenameLocations` and `getReferencesAtPosition`.

**TS path:** No known cause yet. Investigate: path resolution when workspace differs from process cwd; ts-morph project loading for cross-workspace usage; tsconfig `include` / path alias mismatches.
