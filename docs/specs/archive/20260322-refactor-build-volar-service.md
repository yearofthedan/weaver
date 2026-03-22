# Refactor `buildVolarService` — fix duplicate parse, extract LS host

**type:** change
**date:** 2026-03-22
**tracks:** handoff.md # `buildVolarService` refactoring

---

## Context

`src/plugins/vue/service.ts` contains a single 218-line async factory function `buildVolarService`. It has two structural problems: the tsconfig is parsed twice (once for `compilerOptions` on lines 69–79, and again for `fileNames` on lines 93–99, using identical `readConfigFile` + `parseJsonConfigFileContent` calls); and the TypeScript `LanguageServiceHost` object literal spans ~48 lines inline (157–204), making the function's overall shape impossible to see at a glance. Extracting named sub-functions fixes both smells without changing behaviour.

## User intent

*As a contributor to light-bridge, I want `buildVolarService` broken into named, single-purpose helpers, so that the file is readable at a glance and the duplicate tsconfig parse is visibly gone.*

## Relevant files

- `src/plugins/vue/service.ts` — the target; read it before starting
- `src/plugins/vue/engine.ts` — imports `buildVolarService` and `CachedService`; must keep compiling
- `src/plugins/vue/provider.test.ts` — integration tests that exercise the full service; verify they still pass unchanged

### Red flags

- **Duplicate tsconfig parse** — `ts.readConfigFile` + `ts.parseJsonConfigFileContent` called twice with the same arguments. This is the primary smell to fix.
- **48-line anonymous object literal** — `host: import("typescript").LanguageServiceHost = { … }` is too long to scan; a named constructor function would let the reader skip past it.
- `provider.test.ts` is 517 lines. No new tests are added by this spec (pure refactoring), so it does not need splitting here.

## Value / Effort

- **Value:** A contributor reading `buildVolarService` can now understand the high-level phases in one screen rather than scrolling 200 lines. The duplicate tsconfig parse is gone — a future reader won't be confused about which result to use or worry about consistency between the two.
- **Effort:** Two file changes: `service.ts` (extract two functions, eliminate duplicated block) and nothing else — `engine.ts` imports only `buildVolarService` and `CachedService`, which are unchanged.

## Behaviour

- [ ] **AC1: Parse tsconfig once.** Extract a module-private helper `parseTsConfig(tsConfigPath: string | null, ts: typeof import("typescript")): { compilerOptions: import("typescript").CompilerOptions; fileNames: string[] }`. It calls `readConfigFile` + `parseJsonConfigFileContent` once and returns both pieces. `buildVolarService` calls `parseTsConfig` once; the two separate parse blocks (lines 69–79 and 93–99) are gone.

- [ ] **AC2: Extract `buildLanguageServiceHost` as a named function.** The `host` object literal (currently ~48 lines inline) becomes a module-private function `buildLanguageServiceHost(params: { compilerOptions, scriptFileNames, vueVirtualToReal, languageRef, tsConfigPath, readFile, ts }): import("typescript").LanguageServiceHost`. `buildVolarService` calls it in one line. The function's parameter object must be typed (no `any`).

- [ ] **AC3: Rename `provider.test.ts` → `engine.test.ts`.** The file tests `VolarEngine` (imported from `engine.ts`) but retains the name of the old `provider.ts` file. Rename it to match the convention used everywhere else in the codebase.

## Interface

Internal change only. `buildVolarService(tsConfigPath, rootFilePath)` signature and `CachedService` return type are unchanged. `parseTsConfig` and `buildLanguageServiceHost` are module-private (not exported).

## Open decisions

(none)

## Security

- **Workspace boundary:** N/A — no new file read/write paths introduced; existing `readFile` closure is unchanged.
- **Sensitive file exposure:** N/A — same files are read as before.
- **Input injection:** N/A — no new string parameters.
- **Response leakage:** N/A — internal refactoring only.

## Edges

- `provider.test.ts` must pass unchanged — this is a pure structural refactoring with no logic changes.
- The `languageRef` mutable variable (assigned after `createLanguage` returns, used inside the lazy callback) must remain in `buildVolarService`'s closure scope; `buildLanguageServiceHost` receives it as a parameter.

## Done-when

- [x] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files (Stryker blocked by pre-existing pnpm store ENOENT)
- [x] `pnpm check` passes — 775 + 29 tests green
- [x] Docs updated if public surface changed — N/A (internal refactoring)
- [x] handoff.md entry removed
- [x] Tech debt discovered during implementation — none new
- [x] Non-obvious gotchas — see Outcome
- [x] Spec moved to docs/specs/archive/ with Outcome section appended

---

## Outcome

**Tests:** 775 + 29 unchanged — pure structural refactoring, no logic changes, no new tests needed.

**Mutation score:** Blocked by pre-existing Stryker pnpm store ENOENT.

**What changed:**
- `parseTsConfig(tsConfigPath, ts)` extracted — parses tsconfig once, returns `{ compilerOptions, fileNames }`. Eliminates the duplicate `readConfigFile` + `parseJsonConfigFileContent` block.
- `buildLanguageServiceHost(params)` extracted — the ~48-line anonymous `LanguageServiceHost` object literal is now a named typed function. `buildVolarService` calls it in one line.
- `provider.test.ts` renamed to `engine.test.ts` — matches the convention used everywhere else.
- `service.ts` is now scannable in one screen; `buildVolarService` reduced to ~100 lines of high-level orchestration.

**Architectural decisions:**
- `languageRef` changed from a bare `let` variable to `{ current: Language<string> | undefined }` (ref object pattern) to preserve mutable-reference semantics when passing it as a parameter to `buildLanguageServiceHost`. The optional chain (`?.`) in the `createLanguage` callback is a safe improvement over the original — silent no-op if the callback fires during construction, rather than throwing on an uninitialized variable.

**Reflection:**
- Clean and fast. The `{ current }` ref pattern was the only non-obvious decision — the execution agent handled it correctly without prompting.
- The `provider.test.ts` → `engine.test.ts` rename was overdue; the stale name was navigation friction.
- Whether `service.ts` needs direct unit tests, and whether `VolarEngine` should be split like `TsMorphEngine` (standalone action functions), are open questions — noted for the next spec.
