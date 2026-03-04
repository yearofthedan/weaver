# Fix "Could not find source file" for .vue file inputs in rename / findReferences

**type:** bug
**date:** 2026-03-04
**tracks:** handoff.md # rename-findReferences-getDefinition-source-file-not-found

---

## Symptom

`rename` and `findReferences` (and previously `getDefinition`) throw
`PARSE_ERROR: Could not find source file` when the input file is a `.vue` SFC.

```
input:    rename(file: "src/App.vue", line: 2, col: 10, newName: "useTimer")
actual:   { ok: false, error: "PARSE_ERROR", message: "Could not find source file: /abs/src/App.vue" }
expected: { ok: true, filesModified: [...], symbolName: "useCounter", newName: "useTimer" }
```

Same failure for `findReferences` on any `.vue` file path.

## Value / Effort

- **Value:** Users cannot rename or find references for any symbol defined or
  used inside a `.vue` SFC. Hard failure with no workaround.
- **Effort:** Root cause is understood; fix is localised to two methods in
  `src/plugins/vue/provider.ts`. Mirrors a fix already applied to
  `getDefinitionAtPosition`.

## Root cause

`VolarProvider.getRenameLocations` and `getReferencesAtPosition` pass the
caller-supplied `.vue` file path directly to the Volar proxy language service.
The proxy registers `.vue` files internally as `App.vue.ts` (virtual TypeScript
path); calling with the real `.vue` path throws the error.

`getDefinitionAtPosition` was already fixed by calling `toVirtualLocation` first
to translate the real `.vue` path + offset into the virtual `.vue.ts` coordinate
space before calling the language service. The comment in the current code
incorrectly states that `findRenameLocations` and `getReferencesAtPosition`
"auto-translate" — they do not.

## Fix

- [ ] `VolarProvider.getRenameLocations`: call `toVirtualLocation(file, offset, service)`
  before `findRenameLocations`; pass the translated `fileName` and `pos`.
  Output still goes through `translateLocations` for virtual→real path mapping.

- [ ] `VolarProvider.getReferencesAtPosition`: same — call `toVirtualLocation`
  before `getReferencesAtPosition`.

- [ ] Update the misleading comment on both methods (remove the "auto-translate" claim).

- [ ] Regression: operations called from a `.ts` file in a Vue project still
  work (VolarProvider, `.ts` input — currently passing; must not regress).
  `toVirtualLocation` is safe to call unconditionally: for non-`.vue` paths it
  is a passthrough.

- [ ] Regression: `getDefinitionAtPosition` on a `.vue` file still works.

**Narrowest-wrong-fix check:** A fix that only translates on `.vue` inputs via
an `if (file.endsWith(".vue"))` guard would pass these ACs but leave the code
inconsistent with `getDefinitionAtPosition`. Prefer calling `toVirtualLocation`
unconditionally (it already handles the non-`.vue` passthrough).

**Adjacent inputs:**
- Symbol at offset 0 in a `.vue` file
- Template-only `.vue` file (no `<script>` block) — `toVirtualLocation` has a
  `!serviceScript` fallback; calling rename/references from a template-only file
  should return `null` (no symbol), not throw.

## Edges

- **No `.vue.ts` paths in output.** `translateLocations` maps virtual→real;
  translating the input with `toVirtualLocation` must not break this output mapping.

- **`rename.ts` reads `firstLoc.fileName` via `provider.readFile`.** After
  `getRenameLocations` returns translated real paths, `rename.ts` calls
  `provider.readFile(firstLoc.fileName)`. Result must contain real paths only.

- **`.ts` files in Vue projects still route through VolarProvider** (not TsProvider).
  The input translation must not degrade `.ts`-file operations.

## Done-when

- [ ] All fix criteria verified by tests
- [ ] `rename` on a symbol in `App.vue` of the vue-project fixture completes
      without error; `App.vue` appears in `filesModified`
- [ ] `findReferences` on a symbol in `App.vue` returns references including
      the `.vue` path
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] `docs/tech/tech-debt.md` Vue-path entry updated/removed
- [ ] Agent insights captured in `docs/agent-memory.md`
- [ ] Spec moved to `docs/specs/archive/` with Outcome section appended
