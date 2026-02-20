# Tech Debt

Known issues to address before they compound. Reference the relevant source files before starting any of these.

---

## Engine layer: Vue awareness leaking into TsEngine

`src/engines/ts-engine.ts` imports and calls `updateVueImportsAfterMove` from `vue-scan.js`. A TypeScript engine should have no knowledge of Vue.

The same function is also called by `VueEngine.moveFile`. It is a shared post-processing concern — a regex scan that patches `.vue` import paths after any file move — and belongs at the router level, not inside individual engines.

**Fix:** remove the `updateVueImportsAfterMove` call from both engines. Call it in the router after any `moveFile` operation. Engines become pure: each knows only about its own language.

---

## Engine layer: `applyTextEdits` is private to VueEngine

`applyTextEdits` (bottom of `src/engines/vue-engine.ts`) is a pure text utility with no Vue-specific logic. It is only accessible to `VueEngine` today but is likely needed by any engine that applies raw text edits.

**Fix:** move to a shared `src/utils.ts` or similar.

---

## Missing provider/engine separation

Both `TsEngine` and `VueEngine` collapse two distinct responsibilities into one class:

- **Provider** — assembles and owns the language service (`ts-morph` Project, Volar `buildService`). Computes rename locations and file move edits. No file I/O.
- **Engine** — calls the provider, applies edits to disk, returns structured results.

The provider work is the hard, language-specific part. The engine work (apply edits, collect modified files, return JSON-shaped results) is mechanical and largely identical between the two engines.

Separating these would reduce duplication, make each layer independently testable, and make it easier to add new language providers without re-implementing the dispatch logic.

**Note:** this is a meaningful structural change. Do it as a dedicated refactor session after the daemon and MCP transport are stable — not incrementally alongside feature work.
