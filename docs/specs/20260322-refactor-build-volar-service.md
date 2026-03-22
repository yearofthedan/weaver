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

- [ ] All ACs verified by tests
- [ ] Mutation score ≥ threshold for touched files
- [ ] `pnpm check` passes (lint + build + test)
- [ ] Docs updated if public surface changed — N/A (internal refactoring)
- [ ] handoff.md entry removed
- [ ] Tech debt discovered during implementation added to handoff.md as [needs design]
- [ ] Non-obvious gotchas added to docs or `.claude/MEMORY.md` if cross-cutting
- [ ] Spec moved to docs/specs/archive/ with Outcome section appended
