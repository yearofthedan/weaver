# Handoff Notes

This document captures context that isn't in the feature docs — things you need to know before picking up the work.

## Start here

Read the docs in this order:
1. `docs/vision.md` — what this is and where it's going
2. `docs/features/engines.md` — understand the engine boundary before touching anything
3. `docs/features/mcp-transport.md` — the primary next feature
4. `docs/quality.md` — testing and reliability expectations

---

## Current state (as of last session)

**20/20 tests passing.** All previously known issues are resolved.

### What was completed

- **Router fixed** (`src/router.ts`) — now detects project type by scanning the project directory for `.vue` files (via `ts.sys.readDirectory`) rather than dispatching on the starting file's extension. VueEngine is used for all operations in any project containing `.vue` files. TsEngine is used for pure TypeScript projects only.

- **`@vue/language-core` upgraded to v3.2.4** — `package.json` declares `^3.2.4`. After upgrade, run `pnpm install` with a clean cache (`pnpm store prune && rm -rf node_modules && pnpm install`). The v2 package may linger in the pnpm store and produce confusing version mismatches if you skip the prune.

- **Cross-boundary rename fixed** (`src/engines/vue-engine.ts`) — uses virtual filename mapping (Option A) to make TypeScript's program builder analyse `.vue` files. See the "Volar v3 architecture" section below for the full technical picture.

---

## Volar v3 architecture — key research findings

This is the most complex part of the codebase. Document these findings so the next session doesn't have to re-derive them.

### The core problem

TypeScript's program builder silently ignores non-`.ts`/`.tsx` filenames in `getScriptFileNames`. Even if you pre-load `.vue` files into Volar's script registry, TypeScript's `findRenameLocations` never traverses into their content.

### The fix: virtual `.vue.ts` filename mapping

Three coordinated changes in `buildService`:

**1. Expose `.vue` files as `.vue.ts` in `getScriptFileNames`**

Replace each `App.vue` entry with `App.vue.ts` in the list served to TypeScript. TypeScript now includes the Vue SFC in its program.

**2. Intercept host reads for `.vue.ts` and serve Volar's generated TypeScript**

When TypeScript calls `getScriptSnapshot('App.vue.ts')` or `readFile('App.vue.ts')`, intercept it. Look up the real Vue file (`App.vue`) in `language.scripts`, call `getServiceScript(sourceScript.generated.root)` to get the Volar-generated TypeScript snapshot, and return that.

`getServiceScript` is on the language plugin at `sourceScript.generated.languagePlugin.typescript?.getServiceScript(root)`. It finds the embedded code with id matching `/script_(js|jsx|ts|tsx)/` (e.g. `script_ts`) and returns `{ code: VirtualCode, extension: '.ts', scriptKind }`.

**3. After `findRenameLocations`, translate virtual coordinates back to `.vue`**

Use `language.maps.get(serviceScript.code, sourceScript)` to get a `Mapper` for the embedded code against the source script. Then `mapper.toSourceLocation(generatedOffset)` (a Generator) yields the corresponding position in the real `.vue` file.

### `moveFile` and the virtual map

`getEditsForFileRename` now returns edits with `fileName: 'App.vue.ts'` (the virtual name). These can't be written to disk. Skip them with `if (vueVirtualToReal.has(edit.fileName)) continue`. The `updateVueImportsAfterMove` scan handles `.vue` import rewrites directly via regex — safe here because it's rewriting import path strings, not AST symbols.

### Package versions (confirmed clean install)

```
@vue/language-core       3.2.4
@volar/typescript        2.4.28
@volar/language-core     2.4.28
@volar/source-map        2.4.28
typescript               5.9.3
```

### Key Volar v3 types

```typescript
// SourceScript<T>.generated shape (NOT .code — it's .root)
generated?: {
  root: VirtualCode;                        // root of the virtual code tree
  languagePlugin: LanguagePlugin<T>;
  embeddedCodes: Map<string, VirtualCode>;  // keyed by embedded code id
}

// VirtualCode
interface VirtualCode {
  id: string;           // e.g. "main" (root), "script_ts" (embedded TS)
  languageId: string;   // e.g. "typescript", "html"
  snapshot: IScriptSnapshot;
  mappings: CodeMapping[];
  embeddedCodes?: VirtualCode[];
}

// Language.maps
maps: {
  get(virtualCode: VirtualCode, sourceScript: SourceScript<T>): Mapper;
}

// Mapper.toSourceLocation — Generator, take .next().value[0] for the offset
toSourceLocation(generatedOffset: number): Generator<readonly [number, Mapping<CodeInformation>]>
```

### What `decorateLanguageServiceHost` does and does NOT do

It patches `getScriptSnapshot` and `getScriptKind` so that when TypeScript asks for a registered source script (e.g. `App.vue`) it gets the generated TypeScript snapshot back. It also decorates module resolution.

**It does NOT modify `getScriptFileNames`.** That is why the virtual `.vue.ts` trick is necessary — the decorator alone does not make TypeScript include Vue files in its program.

---

## Still to do (in order)

1. **Add unit tests for the engine layer** — direct engine tests (not via CLI subprocess). See `docs/quality.md` for expectations. Complement the existing CLI integration tests in `tests/rename.test.ts`, `tests/move.test.ts`, `tests/vue.test.ts`.
2. **Implement MCP server transport** (`passed-on serve`) — see `docs/features/mcp-transport.md`
