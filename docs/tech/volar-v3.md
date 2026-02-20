# Volar v3 Architecture

Hard-won research findings for the Vue engine. Do not re-derive — read this first.

## The core problem

TypeScript's program builder silently ignores non-`.ts`/`.tsx` filenames in `getScriptFileNames`. Even if you pre-load `.vue` files into Volar's script registry, TypeScript's `findRenameLocations` never traverses into their content.

## The fix: virtual `.vue.ts` filename mapping

Three coordinated changes in `buildService`:

**1. Expose `.vue` files as `.vue.ts` in `getScriptFileNames`**

Replace each `App.vue` entry with `App.vue.ts` in the list served to TypeScript. TypeScript now includes the Vue SFC in its program.

**2. Intercept host reads for `.vue.ts` and serve Volar's generated TypeScript**

When TypeScript calls `getScriptSnapshot('App.vue.ts')` or `readFile('App.vue.ts')`, intercept it. Look up the real Vue file (`App.vue`) in `language.scripts`, call `getServiceScript(sourceScript.generated.root)` to get the Volar-generated TypeScript snapshot, and return that.

`getServiceScript` is on the language plugin at `sourceScript.generated.languagePlugin.typescript?.getServiceScript(root)`. It finds the embedded code with id matching `/script_(js|jsx|ts|tsx)/` (e.g. `script_ts`) and returns `{ code: VirtualCode, extension: '.ts', scriptKind }`.

**3. After `findRenameLocations`, translate virtual coordinates back to `.vue`**

Use `language.maps.get(serviceScript.code, sourceScript)` to get a `Mapper` for the embedded code against the source script. Then `mapper.toSourceLocation(generatedOffset)` (a Generator) yields the corresponding position in the real `.vue` file.

## `moveFile` and the virtual map

`getEditsForFileRename` returns edits with `fileName: 'App.vue.ts'` (the virtual name). These can't be written to disk. Skip them with `if (vueVirtualToReal.has(edit.fileName)) continue`. The `updateVueImportsAfterMove` scan handles `.vue` import rewrites directly via regex — safe here because it's rewriting import path strings, not AST symbols.

## Package versions (confirmed clean install)

```
@vue/language-core       3.2.4
@volar/typescript        2.4.28
@volar/language-core     2.4.28
@volar/source-map        2.4.28
typescript               5.9.3
```

If these look mismatched: `pnpm store prune && rm -rf node_modules && pnpm install`.

## Key Volar v3 types

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

## What `decorateLanguageServiceHost` does and does NOT do

It patches `getScriptSnapshot` and `getScriptKind` so that when TypeScript asks for a registered source script (e.g. `App.vue`) it gets the generated TypeScript snapshot back. It also decorates module resolution.

**It does NOT modify `getScriptFileNames`.** That is why the virtual `.vue.ts` trick is necessary — the decorator alone does not make TypeScript include Vue files in its program.
