# Vue SFC imports through a path alias

**type:** bug
**date:** 2026-08-29
**tracks:** handoff.md # Moving a file silently breaks Vue SFC imports written through a path alias

---

## Symptom

Moving a file in a Vue project leaves any SFC import written through a path alias pointing at the file's old location. Nothing in the response says so: the SFC is never written, so it never enters `filesModified`, and the post-write type check only inspects the files that array names — the one broken file is the one file excluded from the check.

```
input:    moveFile { oldPath: src/composables/useCounter.ts, newPath: src/utils/useCounter.ts }
          tsconfig maps "@/*" -> ["src/*"]; src/App.vue imports "@/composables/useCounter"
actual:   src/App.vue still imports "@/composables/useCounter"
          response: status success, filesModified [src/utils/useCounter.ts], typeErrorCount 0
expected: src/App.vue imports "@/utils/useCounter"
```

Pinned by `leaves an SFC's aliased import pointing at the composable's old location` (`src/operations/moveFile.scenarios.yaml:385`), alongside the TS scenario at line 345 showing the behaviour it should have had. An `@/*` alias onto `src/*` is what the Vue and Vite scaffolds generate, so this is the default Vue project shape.

`moveDirectory` carries the same defect by a different route, and is scoped out — see Root cause.

## Value / Effort

- **Value:** A developer restructures a Vue project and their SFCs silently stop compiling, with weaver reporting success. There is no workaround short of hand-checking every SFC after every move, and no signal telling them to. The two sibling defects on the other axes were fixed in `dc1b8ea`; this is the one the pattern matcher structurally cannot reach, because matching `@/*` means honouring `baseUrl`, `paths` globs with multiple candidates, and `extends` chains.
- **Effort:** One source file modified (`src/plugins/vue/engine.ts`), one helper made shared (`isCoexistingJsFileEdit`, currently module-private in `src/ts-engine/engine.ts`). No new resolution logic and no new dependency — the correct edits are already computed and discarded. The measured cost is a Volar service build on Vue-project moves; see Edges.

## Expected

```
input:    moveFile { oldPath: src/composables/useCounter.ts, newPath: src/utils/useCounter.ts }
          tsconfig maps "@/*" -> ["src/*"]; src/App.vue imports "@/composables/useCounter"
output:   src/App.vue imports "@/utils/useCounter"   (alias preserved, not rewritten to a relative path)
          response: filesModified includes src/App.vue
```

Unchanged — this is what proves the fix did not overreach:

```
input:    moveFile { oldPath: src/composables/useCounter.ts, newPath: src/utils/useCounter.ts }
          a hand-written src/composables/useCounter.js sits beside it
          src/App.vue imports "./composables/useCounter.js"
output:   src/App.vue is not modified
```

## Root cause

Confirmed 2026-08-29 by driving `buildVolarService` directly against the failing fixture.

**The correct edit is already computed.** `getEditsForFileRename` on the Volar service returns, for the scenario above:

```
src/main.ts      span 28+24  -> "@/utils/useCounter"
src/App.vue.ts   span 381+24 -> "@/utils/useCounter"
```

The alias is preserved by TypeScript's own module-specifier generation. The virtual offset maps back through `language.maps` to source offset 53 in the real `App.vue`, where the text is exactly `"@/composables/useCounter"` — the same mechanism `VolarEngine.translateSingleLocation` (`src/plugins/vue/engine.ts:106`) already uses for rename, references and definitions.

**Two lines discard it.**

1. `VolarEngine.getEditsForFileRename` (`src/plugins/vue/engine.ts:216`) filters out every edit whose `fileName` is a virtual `.vue.ts`:
   `.filter((e) => e.textChanges.length > 0 && !service.vueVirtualToReal.has(e.fileName))`.
   The exclusion is defensible as written — `applyRenameEdits` writes to `edit.fileName`, so returning a raw `App.vue.ts` edit would create a junk file — but it drops the answer rather than translating it.

2. `VolarEngine.moveFile` (`src/plugins/vue/engine.ts:259`) never calls that method at all. It delegates to `tsMoveFile(this.tsEngine, …)` — the plain ts-morph engine, which genuinely cannot see inside SFC script blocks — then patches up with `updateVueImportsAfterMove`, whose regex (`src/plugins/vue/scan.ts:64`) matches `/\bfrom\s+(['"])(\.\.?\/[^'"]+)\1/g` and so never considers a non-relative specifier.

`moveDirectory` carries the same defect but **not** through this filter, which is why it is not fixed here. `engine.ts:285` filters its mappings to `.vue` files before querying Volar at all, so a `.ts` file moving inside a directory goes to `this.tsEngine.moveDirectory` and never reaches the Vue engine's edit path. Repairing it needs a Volar query per moved file rather than one per operation — a different cost decision, logged as its own handoff entry.

**The `.js`-coexistence rule is weaver's, not TypeScript's.** `resolveModuleName` was run on `./utils.js` with a real `utils.js` beside a `utils.ts`, under three configs — no `moduleResolution` (the `a-ts-project` fixture), `bundler` (the `a-vue-project` fixture), and `nodenext`. All three resolve to `utils.ts` and all three rewrite the specifier. Weaver overrides that in `isCoexistingJsFileEdit` (`src/ts-engine/engine.ts:417`), applied at line 350 inside `TsMorphEngine.getEditsForFileRename`. The Vue engine's equivalent has no such filter, so routing SFC edits through it without porting the rule regresses `moveFile.scenarios.yaml:255`.

## Fix

1. **Translate virtual edits instead of dropping them, in `VolarEngine.getEditsForFileRename`.** For an edit whose `fileName` is a virtual `.vue.ts`, emit the real `.vue` path and map each `textChange.span.start` through `service.language.maps` to a source offset. An edit whose span has no source mapping is Volar glue code and is still excluded — `translateSingleLocation` already makes that call and returns `null`; reuse that judgement rather than restating it. Spans keep their original `length`: the mapped source text is the specifier itself, so length carries across.

2. **Port the `.js`-coexistence suppression to the Vue path.** Make `isCoexistingJsFileEdit` shared rather than module-private in `src/ts-engine/engine.ts`, and apply it to translated edits against the real `.vue` path and the SFC's own source offsets. Without this, `moveFile.scenarios.yaml:255` regresses.

3. **Have `VolarEngine.moveFile` ask its own service for the SFC half.** Mirror the shape `moveDirectory` already uses: compute the edits before the physical move, keep only those that came from `.vue` files, apply them via `applyRenameEdits`, then delegate to `tsMoveFile` for the TS half. Nothing is rewritten twice — ts-morph owns `.ts` importers, Volar owns SFC importers, and the two sets are disjoint by file extension.

4. **Leave `updateVueImportsAfterMove` in place.** Once the Volar edits have landed, the old specifier is gone, so the scan matches nothing and is inert on the fixed cases. It still covers any `.vue` file the service does not register. Removing it is a separate subtraction with its own evidence requirement — logged as a follow-up handoff entry.

**Confirm before extending.** Moving a `.vue` *file* (as opposed to a `.ts` file) is a suspected sibling, not a confirmed one. Probing showed `moveFile` queries the real `.vue` path and gets no edits back, while the virtual `.vue.ts` query returns edits to both `src/main.ts` and `src/App.vue` — the asymmetry `moveDirectory` comments on at `engine.ts:292` and `moveFile` does not know about. Neither remaining mechanism can match an aliased specifier, so the inference is that aliased importers of a moved `.vue` go stale, but that has not been observed end to end. **Write the scenario for it first.** If it fails, fix it here by having `moveFile` query the virtual path for `.vue` moves, as `moveDirectory` does. If it passes, record that in the Outcome and change nothing.

**Adjacent inputs.** Seven SFC shapes were probed through the Volar service and all produced correct edits with correct offsets: a relative specifier; an extensionless specifier shadowed by a same-named directory; plain `<script lang="ts">`; `<script setup>` with no `lang` attribute; an SFC with both a `<script>` and a `<script setup>` block, where the import sits in the second; the `@` alias; and an SFC outside the tsconfig `include`. The last matters — it is the territory the scan was assumed to be uniquely able to reach. These are the regression cases; they need to keep passing, not to each gain a scenario.

## Security

- **Workspace boundary:** The fix changes which files are written, not how. Translated edits become ordinary `FileTextEdit`s carrying a real `.vue` path, so they flow through `applyRenameEdits`, which checks `scope.contains(edit.fileName)` and records a skip otherwise before writing via `scope.writeFile`. This strengthens the boundary rather than weakening it: today a virtual `.vue.ts` path reaching that check would either be recorded as skipped or write a file that does not correspond to anything on disk.
- **Sensitive file exposure:** N/A — the fix reads `.vue` files the Volar service has already loaded to build the project graph, and adds no new read of a file weaver was not already opening.
- **Input injection:** N/A — no new string parameter. The specifier text comes from TypeScript's own edit output, not from a caller.
- **Response leakage:** The only response change is that `filesModified` now names SFCs that were previously written by the scan or not at all. No file content enters the response.

## Edges

- **Cost lands only on Vue projects, and only through the Vue engine.** `VolarEngine` is constructed only when `createVueLanguagePlugin().supportsProject(tsconfigPath)` — that is, `isVueProject` — returns true (`src/plugins/vue/plugin.ts:10`, `src/domain/language-plugin-registry.ts`). A project with no `.vue` files routes `moveFile` to `TsMorphEngine` and never reaches this code. No new detection is added; `isVueProject` is memoised per project root and already runs once per dispatch.
- **Measured cost, for the record.** On this repo (262 TS/JS files): `buildVolarService` 1035 ms cold, `getEditsForFileRename` 734 ms on a warm service, against 22 ms for the `walkFiles([".vue"])` the scan pays today. `moveFile` calls `this.invalidateService(oldPath)`, so the service does not stay warm across successive moves. This is accepted: correctness through the compiler beats a pattern matcher that cannot be made complete. A measured narrowing is recorded as a separate handoff entry.
- **`moveFile` of a `.vue` file** — see the confirm-before-extending note in Fix.
- **Existing relative-import scenarios must keep passing unchanged.** The scan and the Volar path both now run for `moveFile`; the fixed cases must not be double-rewritten, and `moveFile.scenarios.yaml`'s existing `moved`/`changed`/`unchanged` assertions are what proves it.
- **The diagnostics gap outlives this fix.** A file weaver declines to write is a file the post-write type check never inspects, because that check iterates `filesModified`. This fix removes one cause of a missed rewrite; it does not make a future missed rewrite visible. Not in scope.

## Done-when

- [ ] `leaves an SFC's aliased import pointing at the composable's old location` (`src/operations/moveFile.scenarios.yaml:385`) is rewritten to assert the corrected behaviour and passes
- [ ] A scenario covers `moveFile` of a `.vue` file whose importers use an alias; either it passes as written, or the fix is extended to make it pass
- [ ] The `moveDirectory` sibling and the `.ts`-importing-`.vue` diagnostics defect are logged as handoff entries
- [ ] `leaves an SFC's .js specifier alone when a real .js file sits beside the moved one` (line 255) still passes
- [ ] Mutation score ≥ threshold for `src/plugins/vue/engine.ts`
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed (`docs/internals/` for the Vue engine's edit path)
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to the relevant `docs/internals/` or `docs/tech/` doc
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
