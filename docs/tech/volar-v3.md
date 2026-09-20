**Purpose:** Deep technical reference for how the Vue engine integrates Volar v3 with TypeScript, required reading before modifying Vue-related code.
**Audience:** Engineers working on Vue engine, anyone debugging Vue-specific issues.
**Status:** Current (matches installed versions in package.json)
**Related docs:** [get-definition internals](../internals/get-definition.md) (example of virtual translation)

---

# Volar v3 Architecture

Hard-won research findings for the Vue engine. Do not re-derive — read this first.

## Package ecosystem

Two separate repos with a layered relationship:

**[volarjs/volar.js](https://github.com/volarjs/volar.js)** — language-agnostic framework for bridging virtual languages into TypeScript. Publishes `@volar/*` packages:
- `@volar/language-core` — virtual code abstraction, source maps
- `@volar/typescript` — decorates TS language service host to understand virtual files
- `@volar/source-map` — position mapping between virtual and real code (transitive dep)

**[vuejs/language-tools](https://github.com/vuejs/language-tools)** — Vue-specific tooling built on top of Volar.js. Publishes `@vue/*` packages:
- `@vue/language-core` — SFC parsing + virtual code generation (Vue → TypeScript)
- `@vue/language-server`, `@vue/language-service` — full LSP (not needed here)
- `vue-tsc` — CLI type checker
- `vue-component-meta` — component metadata extraction for docs (not needed here)

We use the **core layers only** — `@vue/language-core` to understand SFCs, `@volar/typescript` to feed virtual code to TS, and `@volar/language-core` for the type abstractions. The higher-level LSP/IDE packages add nothing for headless refactoring.

### Extra APIs in `@vue/language-core` we don't use yet

- **`parse()`** — wraps `@vue/compiler-sfc` internally. Returns an `Sfc` type with `script`, `scriptSetup`, `template`, `styles` blocks, each with offset info and a `ts.SourceFile` AST for script blocks. Useful for `moveSymbol` on `.vue` sources — no new dependency needed.
- **`parseScriptSetupRanges` / `parseScriptRanges`** — extracts `defineProps`, `defineEmits`, `defineSlots`, `defineModel`, `defineExpose` declarations with text ranges.

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

**A `.vue` import resolves only when the virtual path is mapped *and* its script is registered — and registration has to happen while the compiler is resolving.** Decorated module resolution consults the host's `fileExists` for `Foo.vue.ts`, so answering `true` from the virtual map is necessary but not sufficient: `getScriptSnapshot` is what serves the generated TypeScript, and it has nothing to serve for a virtual path whose script was never registered. `buildVolarService` therefore registers from inside the host callbacks — `fileExists`, `getScriptSnapshot` and `readFile` — the first time the compiler asks about a virtual path the service does not hold, reading the real `.vue` from disk. That is how an SFC under a skipped directory (`dist/`, `node_modules`, …) or beyond the tsconfig's own directory joins the program. It works mid-resolution because the snapshot the host returns is what the program builder parses, so the SFC joins in the same build; `scriptFileNames` is left as the service was built with, so the program grows only by what an import pulls in. Only a path ending `.vue.ts` is considered. A `.vue` file owns that name: the seed scan maps every `.vue` it finds at build time, resolution registers one the seeds missed, and an explicit add holds the one a query named — so the name answers with the SFC's generated TypeScript however the file was reached. A real file at the virtual name is a collision the scheme serves one half of: the SFC answers for the name, and a query naming that path returns nothing rather than the SFC's diagnostics at positions past the file's end.

**A per-file refresh needs the content, the version, and the script registration together.**
`CachedService.rereadFile` (`src/plugins/vue/service.ts`) repairs one written file inside a cached
service. All three parts are needed, and any two of them leave a read answered from the text
before the write:

- the host's `readFile`/`fileContents` entry is what `getScriptSnapshot` serves for a plain file;
- the version bump is what makes the TypeScript language service take a fresh snapshot — the
  decorator above wraps `getScriptSnapshot` and `getScriptKind`, and leaves `getScriptVersion` to
  the host, whose map starts empty and returns `"0"` for everything;
- `language.scripts.set(path, snapshot, kind)` is what makes Volar regenerate an SFC's virtual
  TypeScript: the script registry compares snapshot object identity, so replacing the snapshot is
  what invalidates `getServiceScript`'s cached output.

**A version bump for text the service already holds costs a re-parse.** Nothing inside
TypeScript compares the new snapshot's content with the old one, so a bump for identical bytes
discards the source files the previous query parsed. `rereadFile` returns early when the disk
read matches its `fileContents` entry, which is what lets two callers refresh the same path in
one dispatch: the post-write check (`Engine.refreshFile`) and the end-of-dispatch drain
(`Engine.refreshWrittenFile`) both do, and the second read always matches. Measured on a
300-file Vue project writing 30 files, the request after a write costs a median 1.33 ms with
the early return and 3.85 ms without it.

## Implementation notes

**`@volar/language-core` is a direct `devDependency`.**
Added so TypeScript can resolve the `import type { Language }` in `volar.ts`. `@vue/language-core` and `@volar/typescript` currently agree on the same patch version; if they diverge again a `pnpm.overrides` entry will be needed to prevent `Language<string>` becoming a different nominal type in each.

**Template-only `.vue` files (no `<script>` block) exercise `toVirtualLocation` fallback branches.**
A `.vue` file with only a `<template>` block has `sourceScript.generated.languagePlugin.typescript?.getServiceScript()` return null (no TypeScript service script generated). This triggers the `if (!serviceScript) return { fileName: virtualPath, pos }` fallback in `toVirtualLocation`. Useful for mutation testing coverage of those branches. Create via `fs.mkdtempSync` with a minimal tsconfig; the `buildVolarService` directory scan picks up all `.vue` files in the project root automatically.

**Every language service call on a `.vue` file requires `toVirtualLocation` first.**
`findRenameLocations`, `getReferencesAtPosition`, and `getDefinitionAtPosition` all operate on virtual `.vue.ts` paths, not real `.vue` paths. Call `toVirtualLocation(fileName, pos)` before each call to translate the real path + offset to the virtual coordinate space. For non-`.vue` paths `toVirtualLocation` is a passthrough, so calling it unconditionally is safe. The output side is handled by `translateLocations`, which maps virtual `.vue.ts` results back to real `.vue` paths — input and output translations are independent.

**`VolarCompiler.translateLocations` is the shared virtual→real mapping helper.**
Extracted from the inline loop in `rename`; reused by `findReferences` and `getDefinition`. Any future operation that reads positions from a Vue project should call this method rather than duplicating the source-map traversal.

**The language service host must declare `useCaseSensitiveFileNames`.**
TypeScript derives its canonical path form from it and treats a host that omits it as case-insensitive, which lowercases every `SourceFile.path`. Module resolution reads the original-case `fileName` and is unaffected, so only the places the checker uses a canonical path directly are wrong — among them the `fileExists` probe that decides whether an extensionless relative import gets a "Did you mean './x.js'?" suggestion (TS 2835) or the bare "Consider adding an extension" (TS 2834). A lowercased probe still hits on a case-insensitive filesystem, so a wrong answer here is invisible on macOS and fails on Linux CI; fixture directories from `fs.mkdtempSync` carry a random suffix drawn from `[a-zA-Z0-9]`, which is what makes it land. `buildLanguageServiceHost` declares `() => true`, matching the identity `getCanonicalFileName` on the `TsMorphEngine` host so both engines answer alike.

**`dist/` and other build dirs must be excluded from `readDirectory`.**
The Vue service calls `ts.sys.readDirectory()` to find `.vue` files. Without filtering, it picks up files under `dist/`, `node_modules/`, etc., which breaks type resolution. `SKIP_DIRS` is exported from `src/utils/file-walk.ts` and applied in `buildVolarService()`.

**In-memory `ts-morph` projects return virtual paths with a leading `/`.**
When you create `new Project({ useInMemoryFileSystem: true })` and add a file as `"script.ts"`, the TypeScript LS returns edits with `fileName: "/script.ts"` — an absolute virtual path. Matching with `e.fileName === "script.ts"` silently misses all edits. Use `path.basename(e.fileName)` for matching, which handles both real disk paths and in-memory virtual paths uniformly. See `src/ts-engine/extract-symbol.ts`.
